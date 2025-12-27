/**
 * Scraping Service
 * 
 * Orchestrates the verification, scraping, and milestone detection workflow.
 * This is the main entry point for triggering scraping operations.
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
  milestonesSuggested: number;
  errorMessage?: string;
}

/**
 * Verify radicado and scrape actuaciones (non-blocking)
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
        milestonesSuggested: 0,
        errorMessage: 'Radicado no encontrado en CPNU',
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
        milestonesSuggested: 0,
        errorMessage: scrapeResult.errorMessage,
      };
    }

    // Step 3: Normalize and store actuaciones
    const normalized = adapter.normalizeActuaciones(scrapeResult.actuaciones, match.sourceUrl);
    await storeActuaciones(caseId, ownerId, normalized, isMonitoredProcess);

    // Step 4: Map to milestones
    const suggestions = await mapActuacionesToMilestones(normalized);
    const autoCreated = await createHighConfidenceMilestones(
      caseId, ownerId, suggestions, isMonitoredProcess
    );

    // Update final status
    await supabase.from(tableName).update({
      radicado_status: 'VERIFIED_FOUND',
      scrape_status: 'SUCCESS',
      scraped_fields: scrapeResult.caseMetadata || {},
      source_links: [match.sourceUrl],
    }).eq('id', caseId);

    return {
      success: true,
      radicadoStatus: 'VERIFIED_FOUND',
      scrapeStatus: 'SUCCESS',
      actuacionesFound: normalized.length,
      milestonesSuggested: suggestions.length,
    };

  } catch (err) {
    console.error('Scraping error:', err);
    await supabase.from(tableName).update({ scrape_status: 'FAILED' }).eq('id', caseId);
    
    return {
      success: false,
      radicadoStatus: 'PROVIDED_NOT_VERIFIED',
      scrapeStatus: 'FAILED',
      actuacionesFound: 0,
      milestonesSuggested: 0,
      errorMessage: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

async function storeActuaciones(
  caseId: string,
  ownerId: string,
  actuaciones: NormalizedActuacion[],
  isMonitoredProcess: boolean
): Promise<void> {
  const rows = actuaciones.map(act => ({
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
  }));

  const { error } = await supabase.from('actuaciones').upsert(rows, {
    onConflict: 'filing_id,monitored_process_id,hash_fingerprint',
    ignoreDuplicates: true,
  });

  if (error) console.error('Error storing actuaciones:', error);
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
