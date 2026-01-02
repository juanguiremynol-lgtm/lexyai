/**
 * Scraping Service
 * 
 * Orchestrates the verification, scraping, and milestone detection workflow.
 * This is the main entry point for triggering scraping operations.
 * 
 * Uses the External API adapter by default for all CGP process lookups.
 */

import { supabase } from '@/integrations/supabase/client';
import { adapterRegistry } from './adapter-registry';
import { mapActuacionesToMilestones } from './milestone-mapper';
import type { NormalizedActuacion } from './adapter-interface';

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
 * Verify radicado and scrape actuaciones (non-blocking)
 * Uses the External API adapter by default
 */
export async function verifyAndScrapeRadicado(
  caseId: string,
  radicadoNumber: string,
  ownerId: string,
  isMonitoredProcess: boolean = false
): Promise<VerifyAndScrapeResult> {
  const adapter = adapterRegistry.getDefault();
  const tableName = isMonitoredProcess ? 'monitored_processes' : 'filings';

  try {
    // Update status to in progress
    await supabase
      .from(tableName)
      .update({ 
        radicado_status: 'PROVIDED_NOT_VERIFIED',
        scrape_status: 'IN_PROGRESS' 
      })
      .eq('id', caseId);

    // Step 1: Lookup
    const lookupResult = await adapter.lookup(radicadoNumber);

    if (lookupResult.status === 'NOT_FOUND') {
      await supabase.from(tableName).update({ 
        radicado_status: 'NOT_FOUND',
        scrape_status: 'FAILED' 
      }).eq('id', caseId);
      
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
      await supabase.from(tableName).update({ 
        radicado_status: 'LOOKUP_UNAVAILABLE',
        scrape_status: 'FAILED' 
      }).eq('id', caseId);
      
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
      await supabase.from(tableName).update({ 
        radicado_status: 'AMBIGUOUS_MATCH_NEEDS_USER_CONFIRMATION',
        scrape_status: 'NOT_ATTEMPTED' 
      }).eq('id', caseId);
      
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
      await supabase.from(tableName).update({ 
        radicado_status: 'VERIFIED_FOUND',
        scrape_status: 'FAILED' 
      }).eq('id', caseId);
      
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
    const { count: newActuacionesCount, newActuaciones } = await storeActuaciones(caseId, ownerId, normalized, isMonitoredProcess);

    // Step 4: Map to milestones
    const suggestions = await mapActuacionesToMilestones(normalized);
    const autoCreated = await createHighConfidenceMilestones(
      caseId, ownerId, suggestions, isMonitoredProcess
    );

    // Step 5: Create alerts and send email for new actuaciones
    if (newActuacionesCount > 0) {
      await createNewActuacionesAlert(caseId, ownerId, radicadoNumber, newActuacionesCount, isMonitoredProcess, newActuaciones);
    }

    // Update final status with case metadata
    const updateData: Record<string, unknown> = {
      radicado_status: 'VERIFIED_FOUND',
      scrape_status: 'SUCCESS',
      scraped_fields: scrapeResult.caseMetadata || {},
      source_links: [match.sourceUrl],
      last_crawled_at: new Date().toISOString(),
    };

    // Update additional fields from case metadata
    if (scrapeResult.caseMetadata?.despacho) {
      updateData.court_name = scrapeResult.caseMetadata.despacho;
    }
    if (scrapeResult.caseMetadata?.demandantes) {
      updateData.demandantes = scrapeResult.caseMetadata.demandantes;
    }
    if (scrapeResult.caseMetadata?.demandados) {
      updateData.demandados = scrapeResult.caseMetadata.demandados;
    }

    await supabase.from(tableName).update(updateData).eq('id', caseId);

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
    await supabase.from(tableName).update({ scrape_status: 'FAILED' }).eq('id', caseId);
    
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

interface StoreActuacionesResult {
  count: number;
  newActuaciones: NormalizedActuacion[];
}

async function storeActuaciones(
  caseId: string,
  ownerId: string,
  actuaciones: NormalizedActuacion[],
  isMonitoredProcess: boolean
): Promise<StoreActuacionesResult> {
  // Get existing hashes to avoid duplicates
  const queryField = isMonitoredProcess ? 'monitored_process_id' : 'filing_id';
  const { data: existingActs } = await supabase
    .from('actuaciones')
    .select('hash_fingerprint')
    .eq(queryField, caseId);

  const existingHashes = new Set((existingActs || []).map(a => a.hash_fingerprint));

  const newActuaciones = actuaciones.filter(act => !existingHashes.has(act.hashFingerprint));
  
  const newRows = newActuaciones.map(act => ({
    owner_id: ownerId,
    filing_id: isMonitoredProcess ? null : caseId,
    monitored_process_id: isMonitoredProcess ? caseId : null,
    source: 'RAMA_JUDICIAL',
    source_url: act.sourceUrl,
    raw_text: act.rawText,
    normalized_text: act.normalizedText,
    act_date: act.actDate,
    act_time: act.actTime,
    act_date_raw: act.actDateRaw,
    act_type_guess: act.actTypeGuess,
    confidence: act.confidence,
    hash_fingerprint: act.hashFingerprint,
    attachments: act.attachments,
    adapter_name: 'external-rama-judicial-api',
  }));

  if (newRows.length === 0) return { count: 0, newActuaciones: [] };

  const { error } = await supabase.from('actuaciones').insert(newRows);

  if (error) {
    console.error('Error storing actuaciones:', error);
    return { count: 0, newActuaciones: [] };
  }

  return { count: newRows.length, newActuaciones };
}

async function createNewActuacionesAlert(
  caseId: string,
  ownerId: string,
  radicado: string,
  count: number,
  isMonitoredProcess: boolean,
  actuaciones?: NormalizedActuacion[]
): Promise<void> {
  const entityType = isMonitoredProcess ? 'CGP_CASE' : 'CGP_FILING';
  
  // Determine severity based on actuacion types
  let severity = 'INFO';
  const importantTypes = ['SENTENCIA', 'AUTO_ADMISORIO', 'AUDIENCIA', 'NOTIFICACION', 'MANDAMIENTO_DE_PAGO'];
  const hasImportant = actuaciones?.some(a => importantTypes.includes(a.actTypeGuess || ''));
  if (hasImportant) severity = 'WARNING';

  // Build detailed message
  const recentActs = actuaciones?.slice(0, 3) || [];
  const actTypesSummary = recentActs.map(a => a.actTypeGuess || 'Actuación').join(', ');
  const message = actuaciones?.length 
    ? `Radicado ${radicado}: ${actTypesSummary}${count > 3 ? ` y ${count - 3} más` : ''}`
    : `Se detectaron ${count} actuación(es) nueva(s) en el radicado ${radicado}`;

  await supabase.from('alert_instances').insert({
    owner_id: ownerId,
    entity_type: entityType,
    entity_id: caseId,
    severity,
    status: 'PENDING',
    title: `${count} nueva(s) actuación(es) detectada(s)`,
    message,
    payload: {
      radicado,
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
        params: { path: isMonitoredProcess ? `/processes/${caseId}` : `/filings/${caseId}` } 
      },
    ],
  });

  // Send email notification
  await sendActuacionEmailNotification(ownerId, radicado, count, actuaciones, isMonitoredProcess, caseId);
}

/**
 * Send email notification for new actuaciones
 */
async function sendActuacionEmailNotification(
  ownerId: string,
  radicado: string,
  count: number,
  actuaciones?: NormalizedActuacion[],
  isMonitoredProcess?: boolean,
  caseId?: string
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
    
    emailMessage += '\n\nIngrese a Lex Docket para ver los detalles completos.';

    // Call the send-reminder edge function
    const { error } = await supabase.functions.invoke('send-reminder', {
      body: {
        type: 'process_update',
        recipientEmail,
        recipientName: profile?.full_name || undefined,
        subject: `${count} nueva(s) actuación(es) detectada(s) - ${radicado}`,
        radicado,
        message: emailMessage,
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
  caseId: string,
  ownerId: string,
  suggestions: Awaited<ReturnType<typeof mapActuacionesToMilestones>>,
  isMonitoredProcess: boolean
): Promise<number> {
  let created = 0;
  
  for (const s of suggestions) {
    if (s.confidence >= 0.80 && s.eventDate) {
      const { error } = await supabase.from('cgp_milestones').insert({
        owner_id: ownerId,
        filing_id: isMonitoredProcess ? null : caseId,
        process_id: isMonitoredProcess ? caseId : null,
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
 * Trigger manual refresh for a specific case/filing
 */
export async function triggerManualRefresh(
  caseId: string,
  radicado: string,
  ownerId: string,
  isMonitoredProcess: boolean = false
): Promise<VerifyAndScrapeResult> {
  return verifyAndScrapeRadicado(caseId, radicado, ownerId, isMonitoredProcess);
}
