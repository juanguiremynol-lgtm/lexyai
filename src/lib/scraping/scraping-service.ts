/**
 * Scraping Service
 * 
 * Orchestrates the verification, scraping, and milestone detection workflow.
 * This is the main entry point for triggering scraping operations.
 * 
 * UPDATED: Now uses work_items table as the canonical source.
 * Legacy filings/monitored_processes paths have been removed.
 */

import { supabase } from '@/integrations/supabase/client';
import { adapterRegistry } from './adapter-registry';
import { mapActuacionesToMilestones } from './milestone-mapper';
import type { NormalizedActuacion, SupportedWorkflowType } from './adapter-interface';
import { createAlertIdempotent, type AlertEntityType } from '@/lib/alerts';

export interface VerifyAndScrapeResult {
  success: boolean;
  radicadoStatus: string;
  scrapeStatus: string;
  actuacionesFound: number;
  newActuacionesCount: number;
  milestonesSuggested: number;
  errorMessage?: string;
  caseMetadata?: {
    despacho?: string;
    demandante?: string;
    demandado?: string;
    tipoProceso?: string;
    fechaRadicacion?: string;
  };
}

/**
 * Verify radicado and scrape actuaciones for a work_item
 * Uses the adapter registry to get the appropriate scraping adapter
 */
export async function verifyAndScrapeWorkItem(
  workItemId: string,
  radicadoNumber: string,
  ownerId: string,
  organizationId?: string,
  workflowType: SupportedWorkflowType = 'CGP'
): Promise<VerifyAndScrapeResult> {
  // Get adapter based on org/workflow context
  const adapter = await adapterRegistry.getForContext(organizationId || null, workflowType);
  
  console.log(`[ScrapingService] Using adapter: ${adapter.id} for work_item ${workItemId}`);

  try {
    // Update status to in progress
    await supabase
      .from('work_items')
      .update({ 
        radicado_verified: false,
        scrape_status: 'IN_PROGRESS' 
      })
      .eq('id', workItemId);

    // Step 1: Lookup
    const lookupResult = await adapter.lookup(radicadoNumber);

    if (lookupResult.status === 'NOT_FOUND') {
      await supabase.from('work_items').update({ 
        radicado_verified: false,
        scrape_status: 'FAILED' 
      }).eq('id', workItemId);
      
      return {
        success: false,
        radicadoStatus: 'NOT_FOUND',
        scrapeStatus: 'FAILED',
        actuacionesFound: 0,
        newActuacionesCount: 0,
        milestonesSuggested: 0,
        errorMessage: 'Radicado no encontrado',
      };
    }

    if (lookupResult.status === 'UNAVAILABLE' || lookupResult.status === 'ERROR') {
      await supabase.from('work_items').update({ 
        radicado_verified: false,
        scrape_status: 'FAILED' 
      }).eq('id', workItemId);
      
      return {
        success: false,
        radicadoStatus: 'LOOKUP_UNAVAILABLE',
        scrapeStatus: 'FAILED',
        actuacionesFound: 0,
        newActuacionesCount: 0,
        milestonesSuggested: 0,
        errorMessage: lookupResult.errorMessage,
      };
    }

    if (lookupResult.status === 'AMBIGUOUS') {
      await supabase.from('work_items').update({ 
        radicado_verified: false,
        scrape_status: 'NOT_ATTEMPTED' 
      }).eq('id', workItemId);
      
      return {
        success: true,
        radicadoStatus: 'AMBIGUOUS_MATCH_NEEDS_USER_CONFIRMATION',
        scrapeStatus: 'NOT_ATTEMPTED',
        actuacionesFound: 0,
        newActuacionesCount: 0,
        milestonesSuggested: 0,
      };
    }

    // Step 2: Scrape actuaciones
    const match = lookupResult.matches[0];
    const scrapeResult = await adapter.scrapeCase(match);

    if (scrapeResult.status === 'FAILED') {
      await supabase.from('work_items').update({ 
        radicado_verified: true,
        scrape_status: 'FAILED' 
      }).eq('id', workItemId);
      
      return {
        success: false,
        radicadoStatus: 'VERIFIED_FOUND',
        scrapeStatus: 'FAILED',
        actuacionesFound: 0,
        newActuacionesCount: 0,
        milestonesSuggested: 0,
        errorMessage: scrapeResult.errorMessage,
      };
    }

    // Step 3: Normalize and store actuaciones
    const normalized = adapter.normalizeActuaciones(scrapeResult.actuaciones, match.sourceUrl);
    const { count: newActuacionesCount, newActuaciones } = await storeActuaciones(
      workItemId, 
      ownerId, 
      normalized,
      organizationId
    );

    // Step 4: Map to milestones
    const suggestions = await mapActuacionesToMilestones(normalized);
    const autoCreated = await createHighConfidenceMilestones(
      workItemId, 
      ownerId, 
      suggestions
    );

    // Step 5: Create alerts for new actuaciones
    if (newActuacionesCount > 0) {
      await createNewActuacionesAlert(
        workItemId, 
        ownerId, 
        radicadoNumber, 
        newActuacionesCount, 
        workflowType,
        newActuaciones
      );
    }

    // Update final status with case metadata
    const updateData: Record<string, unknown> = {
      radicado_verified: true,
      scrape_status: 'SUCCESS',
      scraped_fields: scrapeResult.caseMetadata || {},
      source_links: [match.sourceUrl],
      last_crawled_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
    };

    // Update additional fields from case metadata
    if (scrapeResult.caseMetadata?.despacho) {
      updateData.authority_name = scrapeResult.caseMetadata.despacho;
    }
    if (scrapeResult.caseMetadata?.demandantes) {
      updateData.demandantes = scrapeResult.caseMetadata.demandantes;
    }
    if (scrapeResult.caseMetadata?.demandados) {
      updateData.demandados = scrapeResult.caseMetadata.demandados;
    }

    await supabase.from('work_items').update(updateData).eq('id', workItemId);

    return {
      success: true,
      radicadoStatus: 'VERIFIED_FOUND',
      scrapeStatus: 'SUCCESS',
      actuacionesFound: normalized.length,
      newActuacionesCount,
      milestonesSuggested: suggestions.length,
      caseMetadata: scrapeResult.caseMetadata ? {
        despacho: scrapeResult.caseMetadata.despacho,
        demandante: scrapeResult.caseMetadata.demandantes,
        demandado: scrapeResult.caseMetadata.demandados,
        tipoProceso: scrapeResult.caseMetadata.tipoProceso,
        fechaRadicacion: scrapeResult.caseMetadata.fechaRadicacion,
      } : undefined,
    };

  } catch (err) {
    console.error('Scraping error:', err);
    await supabase.from('work_items').update({ scrape_status: 'FAILED' }).eq('id', workItemId);
    
    return {
      success: false,
      radicadoStatus: 'PROVIDED_NOT_VERIFIED',
      scrapeStatus: 'FAILED',
      actuacionesFound: 0,
      newActuacionesCount: 0,
      milestonesSuggested: 0,
      errorMessage: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

/**
 * Legacy wrapper for backward compatibility
 * @deprecated Use verifyAndScrapeWorkItem instead
 */
export async function verifyAndScrapeRadicado(
  caseId: string,
  radicadoNumber: string,
  ownerId: string,
  isMonitoredProcess: boolean = false
): Promise<VerifyAndScrapeResult> {
  console.warn('[DEPRECATED] verifyAndScrapeRadicado is deprecated. Use verifyAndScrapeWorkItem instead.');
  
  // Try to resolve work_item_id from the legacy case ID
  // This maintains backward compatibility during migration
  const { data: workItem } = await supabase
    .from('work_items')
    .select('id, organization_id, workflow_type')
    .or(`id.eq.${caseId},legacy_filing_id.eq.${caseId},legacy_process_id.eq.${caseId}`)
    .maybeSingle();

  if (workItem) {
    return verifyAndScrapeWorkItem(
      workItem.id,
      radicadoNumber,
      ownerId,
      workItem.organization_id || undefined,
      (workItem.workflow_type as SupportedWorkflowType) || 'CGP'
    );
  }

  // Fallback: use the caseId as work_item_id directly
  return verifyAndScrapeWorkItem(caseId, radicadoNumber, ownerId);
}

interface StoreActuacionesResult {
  count: number;
  newActuaciones: NormalizedActuacion[];
}

async function storeActuaciones(
  workItemId: string,
  ownerId: string,
  actuaciones: NormalizedActuacion[],
  organizationId?: string
): Promise<StoreActuacionesResult> {
  // BUG FIX: Get existing hashes from work_item_acts (the canonical table) instead of actuaciones
  const { data: existingActs } = await supabase
    .from('work_item_acts')
    .select('hash_fingerprint')
    .eq('work_item_id', workItemId);

  const existingHashes = new Set((existingActs || []).map(a => a.hash_fingerprint));

  const newActuaciones = actuaciones.filter(act => !existingHashes.has(act.hashFingerprint));
  
  // BUG FIX: Insert into work_item_acts (canonical table) instead of legacy actuaciones table
  const newRows = newActuaciones.map(act => ({
    owner_id: ownerId,
    organization_id: organizationId || null,
    work_item_id: workItemId,
    workflow_type: 'CGP', // Default workflow
    description: act.rawText,
    act_date: act.actDate,
    act_date_raw: act.actDateRaw,
    event_date: act.actDate,
    event_summary: act.normalizedText?.slice(0, 500) || act.rawText.slice(0, 500),
    source: 'RAMA_JUDICIAL',
    source_platform: 'CPNU',
    source_url: act.sourceUrl,
    hash_fingerprint: act.hashFingerprint,
    scrape_date: new Date().toISOString().split('T')[0],
    // FIX 2.2: Set date_confidence from date_source
    date_source: act.actDate ? 'api_explicit' : 'inferred',
    date_confidence: act.actDate ? 'high' : 'low',
    // FIX 2.3: Schema versioning for raw payloads
    raw_schema_version: 'cpnu_client_v1',
    raw_data: {
      attachments: act.attachments,
      act_type_guess: act.actTypeGuess,
      confidence: act.confidence,
      act_time: act.actTime,
    },
  }));

  if (newRows.length === 0) return { count: 0, newActuaciones: [] };

  const { error } = await supabase.from('work_item_acts').insert(newRows);

  if (error) {
    console.error('Error storing work_item_acts:', error);
    return { count: 0, newActuaciones: [] };
  }

  return { count: newRows.length, newActuaciones };
}

async function createNewActuacionesAlert(
  workItemId: string,
  ownerId: string,
  radicado: string,
  count: number,
  workflowType: SupportedWorkflowType,
  actuaciones?: NormalizedActuacion[]
): Promise<void> {
  // Map workflow type to alert entity type
  const entityTypeMap: Record<SupportedWorkflowType, AlertEntityType> = {
    CGP: 'CGP_CASE',
    CPACA: 'CPACA',
    TUTELA: 'TUTELA',
    LABORAL: 'LABORAL',
    PENAL_906: 'PENAL_906',
    GOV_PROCEDURE: 'GOV_PROCEDURE',
    ALL: 'CGP_CASE', // Default fallback
  };
  
  const entityType = entityTypeMap[workflowType] || 'CGP_CASE';
  
  // Determine severity based on actuacion types
  let severity: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO';
  const importantTypes = ['SENTENCIA', 'AUTO_ADMISORIO', 'AUDIENCIA', 'NOTIFICACION', 'MANDAMIENTO_DE_PAGO'];
  const hasImportant = actuaciones?.some(a => importantTypes.includes(a.actTypeGuess || ''));
  if (hasImportant) severity = 'WARNING';

  // Build detailed message
  const recentActs = actuaciones?.slice(0, 3) || [];
  const actTypesSummary = recentActs.map(a => a.actTypeGuess || 'Actuación').join(', ');
  const message = actuaciones?.length 
    ? `Radicado ${radicado}: ${actTypesSummary}${count > 3 ? ` y ${count - 3} más` : ''}`
    : `Se detectaron ${count} actuación(es) nueva(s) en el radicado ${radicado}`;

  // Get most recent actuacion date for fingerprint
  const latestActDate = actuaciones?.[0]?.actDate || new Date().toISOString().split('T')[0];
  const eventType = hasImportant 
    ? (actuaciones?.find(a => importantTypes.includes(a.actTypeGuess || ''))?.actTypeGuess || 'ACTUACION')
    : 'ACTUACION';

  // Use idempotent alert creation to prevent duplicates
  await createAlertIdempotent({
    ownerId,
    entityType,
    entityId: workItemId,
    severity,
    title: `${count} nueva(s) actuación(es) detectada(s)`,
    message,
    payload: {
      radicado,
      workflow_type: workflowType,
      new_count: count,
      actuaciones: actuaciones?.slice(0, 5).map(a => ({
        text: a.rawText.substring(0, 200),
        date: a.actDate,
        type: a.actTypeGuess,
      })),
    },
    actions: [
      { 
        label: 'Ver Proceso', 
        action: 'navigate', 
        params: { path: `/app/work-items/${workItemId}` } // Canonical route
      },
    ],
    fingerprintKeys: {
      radicado,
      eventType,
      eventDate: latestActDate,
    },
  });

  // Send email notification
  await sendActuacionEmailNotification(ownerId, radicado, count, actuaciones, workItemId);
}

/**
 * Send email notification for new actuaciones
 */
async function sendActuacionEmailNotification(
  ownerId: string,
  radicado: string,
  count: number,
  actuaciones?: NormalizedActuacion[],
  workItemId?: string
): Promise<void> {
  try {
    // Get user profile for email
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, reminder_email, default_alert_email')
      .eq('id', ownerId)
      .single();

    // Also get user email from auth
    const { data: { user } } = await supabase.auth.getUser();
    
    const recipientEmail = profile?.default_alert_email || profile?.reminder_email || user?.email;
    
    if (!recipientEmail) {
      console.log('No email configured for user, skipping email notification');
      return;
    }

    // Build email message with actuaciones details
    let emailMessage = `Se detectaron ${count} nueva(s) actuación(es) en el proceso ${radicado}:\n\n`;
    
    if (actuaciones && actuaciones.length > 0) {
      emailMessage += actuaciones.slice(0, 5).map(a => 
        `• ${a.actDate || 'Sin fecha'}: ${a.rawText.substring(0, 150)}...`
      ).join('\n');
      
      if (count > 5) {
        emailMessage += `\n\n... y ${count - 5} actuación(es) más.`;
      }
    }
    
    emailMessage += '\n\nIngrese a ATENIA para ver los detalles completos.';

    // Call the send-reminder edge function
    const { error } = await supabase.functions.invoke('send-reminder', {
      body: {
        type: 'process_update',
        recipientEmail,
        recipientName: profile?.full_name || undefined,
        subject: `${count} nueva(s) actuación(es) detectada(s) - ${radicado}`,
        radicado,
        message: emailMessage,
        workItemId, // Include for deep-linking
      },
    });

    if (error) {
      console.error('Error sending email notification:', error);
    } else {
      console.log(`Email notification sent to ${recipientEmail} for radicado ${radicado}`);
    }
  } catch (err) {
    console.error('Error in sendActuacionEmailNotification:', err);
  }
}

async function createHighConfidenceMilestones(
  workItemId: string,
  ownerId: string,
  suggestions: Awaited<ReturnType<typeof mapActuacionesToMilestones>>
): Promise<number> {
  let created = 0;
  
  for (const s of suggestions) {
    if (s.confidence >= 0.80 && s.eventDate) {
      const { error } = await supabase.from('cgp_milestones').insert({
        owner_id: ownerId,
        work_item_id: workItemId, // Canonical key
        milestone_type: s.milestoneType,
        event_date: s.eventDate,
        occurred: true,
        in_audience: false,
        source: 'RAMA_SCRAPE',
        confidence: s.confidence,
        needs_user_confirmation: s.needsUserConfirmation,
        notes: `Auto-detectado: ${s.rawText.substring(0, 100)}...`,
      });
      
      if (!error) created++;
    }
  }
  
  return created;
}

/**
 * Trigger manual refresh for a specific work_item
 */
export async function triggerManualRefresh(
  workItemId: string,
  radicado: string,
  ownerId: string,
  organizationId?: string,
  workflowType: SupportedWorkflowType = 'CGP'
): Promise<VerifyAndScrapeResult> {
  return verifyAndScrapeWorkItem(workItemId, radicado, ownerId, organizationId, workflowType);
}
