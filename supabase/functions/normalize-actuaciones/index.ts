import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= TYPES =============

interface Actuacion {
  id: string;
  owner_id: string;
  filing_id: string | null;
  monitored_process_id: string | null;
  source: string;
  source_url: string | null;
  adapter_name: string | null;
  raw_text: string;
  normalized_text: string;
  act_date: string | null;
  act_time: string | null;
  act_date_raw: string | null;
  act_type_guess: string | null;
  confidence: number | null;
  hash_fingerprint: string;
  attachments: Array<{ label?: string; nombre?: string; url?: string }> | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
}

interface DetectedMilestone {
  milestone_type: string;
  confidence: number;
  pattern_id: string;
  matched_text: string;
  keywords_matched: string[];
}

interface MilestonePattern {
  id: string;
  milestone_type: string;
  pattern_regex: string;
  pattern_keywords: string[];
  base_confidence: number;
  priority: number;
  notes: string | null;
}

interface ProcessEvent {
  id?: string;
  filing_id: string;
  owner_id: string;
  monitored_process_id: string | null;
  event_date: string | null;
  event_type: string;
  title: string | null;
  description: string;
  detail: string | null;
  raw_data: Record<string, unknown> | null;
  source_url: string | null;
  source: string;
  hash_fingerprint: string;
  attachments: Array<{ label: string; url: string }> | null;
  detected_milestones: DetectedMilestone[] | null;
}

interface NormalizationResult {
  ok: boolean;
  run_id: string;
  counts: {
    ingested: number;
    existing: number;
    inserted: number;
    errors: number;
  };
  errors?: string[];
}

// ============= UTILITY FUNCTIONS =============

/**
 * Compute deterministic fingerprint for deduplication
 * Format: ${source}|${radicado}|${date}|${event_type}|${description_hash}
 */
function computeEventFingerprint(
  source: string,
  radicado: string,
  eventDate: string | null,
  eventType: string,
  description: string,
  sourceUrl: string | null
): string {
  // Normalize description for consistent hashing
  const normalizedDesc = description
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
  
  const data = `${source}|${radicado}|${eventDate || ''}|${eventType}|${normalizedDesc}|${sourceUrl || ''}`;
  
  // Double hash for better distribution
  let hash1 = 0, hash2 = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash1 = ((hash1 << 5) - hash1) + char;
    hash1 = hash1 & hash1;
    hash2 = ((hash2 << 7) + hash2) ^ char;
    hash2 = hash2 & hash2;
  }
  
  return `${Math.abs(hash1).toString(16).padStart(8, '0')}${Math.abs(hash2).toString(16).padStart(8, '0')}`;
}

/**
 * Determine event type from description keywords
 */
function determineEventType(description: string): string {
  const lower = description.toLowerCase();
  
  // Priority order matters - more specific first
  if (lower.includes('sentencia')) return 'SENTENCIA';
  if (lower.includes('audiencia')) return 'AUDIENCIA';
  if (lower.includes('auto admisorio')) return 'AUTO_ADMISORIO';
  if (lower.includes('auto ')) return 'AUTO';
  if (lower.includes('notifica')) return 'NOTIFICACION';
  if (lower.includes('traslado')) return 'TRASLADO';
  if (lower.includes('memorial')) return 'MEMORIAL';
  if (lower.includes('providencia')) return 'PROVIDENCIA';
  if (lower.includes('fallo')) return 'FALLO';
  if (lower.includes('radicacion') || lower.includes('radicación')) return 'RADICACION';
  if (lower.includes('emplazamiento')) return 'EMPLAZAMIENTO';
  if (lower.includes('impulso')) return 'IMPULSO';
  if (lower.includes('estado')) return 'ESTADO';
  
  return 'ACTUACION';
}

/**
 * Generate a summary from raw text
 */
function generateSummary(rawText: string, maxLength: number = 100): string {
  if (!rawText) return '';
  
  // Clean up the text
  let summary = rawText
    .replace(/\s+/g, ' ')
    .trim();
  
  if (summary.length <= maxLength) return summary;
  
  // Find a good break point
  const breakAt = summary.lastIndexOf(' ', maxLength - 3);
  return summary.substring(0, breakAt > 0 ? breakAt : maxLength - 3) + '...';
}

/**
 * Map source adapter names to canonical source names
 */
function mapSourceName(source: string, adapterName: string | null): string {
  // Normalize to uppercase
  const upperSource = source?.toUpperCase() || '';
  const upperAdapter = adapterName?.toUpperCase() || '';
  
  if (upperSource.includes('CPNU') || upperAdapter.includes('CPNU')) return 'CPNU';
  if (upperSource.includes('PUBLICACIONES') || upperAdapter.includes('PUBLICACIONES')) return 'PUBLICACIONES';
  if (upperSource.includes('ICARUS') || upperAdapter.includes('ICARUS')) return 'ICARUS';
  if (upperSource.includes('RAMA_JUDICIAL') || upperAdapter.includes('EXTERNAL_API')) return 'CPNU';
  if (upperSource.includes('HISTORICO') || upperAdapter.includes('HISTORICO')) return 'HISTORICO';
  if (upperSource.includes('MANUAL') || upperSource === '') return 'MANUAL';
  
  return upperSource || 'UNKNOWN';
}

/**
 * Parse date string to ISO format
 */
function parseEventDate(dateStr: string | null, dateRaw: string | null): string | null {
  const input = dateStr || dateRaw;
  if (!input) return null;
  
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) {
    try {
      const d = new Date(input);
      return isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
      return null;
    }
  }
  
  // DD/MM/YYYY or DD-MM-YYYY
  const match = input.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (match) {
    let [, day, month, year] = match;
    if (year.length === 2) {
      year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    }
    try {
      const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      return isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
      return null;
    }
  }
  
  return null;
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let runId: string | null = null;
  
  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }
    
    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body
    const body = await req.json();
    const {
      monitored_process_id,
      filing_id,
      owner_id,
      radicado,
      force_reprocess = false,
    } = body;
    
    if (!owner_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'owner_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!monitored_process_id && !filing_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Either monitored_process_id or filing_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Create crawler_run record for audit trail
    const { data: runData, error: runError } = await supabase
      .from('crawler_runs')
      .insert({
        owner_id,
        radicado: radicado || 'unknown',
        adapter: 'normalize-actuaciones',
        status: 'RUNNING',
        request_meta: { monitored_process_id, filing_id, force_reprocess },
      })
      .select('id')
      .single();
    
    if (runError) {
      console.error('Failed to create crawler_run:', runError);
    } else {
      runId = runData.id;
    }
    
    // Helper to log steps
    const logStep = async (stepName: string, ok: boolean, detail: string, meta?: Record<string, unknown>) => {
      if (!runId) return;
      await supabase.from('crawler_run_steps').insert({
        run_id: runId,
        step_name: stepName,
        ok,
        detail,
        meta,
      });
    };
    
    await logStep('INIT', true, 'Normalization started', { monitored_process_id, filing_id });
    
    // Fetch actuaciones to normalize
    let query = supabase
      .from('actuaciones')
      .select('*')
      .eq('owner_id', owner_id);
    
    if (monitored_process_id) {
      query = query.eq('monitored_process_id', monitored_process_id);
    } else if (filing_id) {
      query = query.eq('filing_id', filing_id);
    }
    
    const { data: actuaciones, error: fetchError } = await query;
    
    if (fetchError) {
      await logStep('FETCH_ACTUACIONES', false, `Error: ${fetchError.message}`);
      throw fetchError;
    }
    
    const ingestedCount = actuaciones?.length || 0;
    await logStep('FETCH_ACTUACIONES', true, `Fetched ${ingestedCount} actuaciones`);
    
    if (ingestedCount === 0) {
      // Nothing to process
      await logStep('COMPLETE', true, 'No actuaciones to normalize');
      
      if (runId) {
        await supabase
          .from('crawler_runs')
          .update({
            status: 'SUCCESS',
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            response_meta: { ingested: 0, existing: 0, inserted: 0, errors: 0 },
          })
          .eq('id', runId);
      }
      
      return new Response(
        JSON.stringify({
          ok: true,
          run_id: runId,
          counts: { ingested: 0, existing: 0, inserted: 0, errors: 0 },
        } as NormalizationResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Determine the target filing_id for process_events
    // process_events requires a filing_id, so we need to find or create one
    let targetFilingId = filing_id;
    
    if (!targetFilingId && monitored_process_id) {
      // Try to find an associated filing
      const { data: process } = await supabase
        .from('monitored_processes')
        .select('radicado')
        .eq('id', monitored_process_id)
        .single();
      
      if (process?.radicado) {
        // Look for a filing with this radicado
        const { data: filing } = await supabase
          .from('filings')
          .select('id')
          .eq('radicado', process.radicado)
          .eq('owner_id', owner_id)
          .limit(1)
          .single();
        
        if (filing) {
          targetFilingId = filing.id;
        } else {
          // Create a placeholder filing
          const { data: newFiling, error: createError } = await supabase
            .from('filings')
            .insert({
              owner_id,
              radicado: process.radicado,
              status: 'MONITORING_ACTIVE',
              filing_type: 'IMPORTED',
              last_event_at: new Date().toISOString(),
            })
            .select('id')
            .single();
          
          if (!createError && newFiling) {
            targetFilingId = newFiling.id;
            await logStep('CREATE_FILING', true, `Created placeholder filing: ${newFiling.id}`);
          }
        }
      }
    }
    
    if (!targetFilingId) {
      // Last resort: create a minimal filing
      const { data: newFiling, error: createError } = await supabase
        .from('filings')
        .insert({
          owner_id,
          radicado: radicado || 'unknown',
          status: 'MONITORING_ACTIVE',
          filing_type: 'IMPORTED',
          last_event_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      
      if (createError) {
        await logStep('CREATE_FILING', false, `Failed to create filing: ${createError.message}`);
        throw new Error('Cannot create process_events without a filing_id');
      }
      
      targetFilingId = newFiling.id;
      await logStep('CREATE_FILING', true, `Created placeholder filing: ${newFiling.id}`);
    }
    
    // Fetch milestone patterns for detection
    const { data: patterns } = await supabase
      .from('milestone_mapping_patterns')
      .select('*')
      .eq('active', true)
      .order('priority', { ascending: false });
    
    const milestonePatterns = (patterns || []) as MilestonePattern[];
    
    // Transform actuaciones to process_events
    const processEvents: ProcessEvent[] = [];
    const errors: string[] = [];
    
    for (const act of actuaciones as Actuacion[]) {
      try {
        const eventDate = parseEventDate(act.act_date, act.act_date_raw);
        const eventType = act.act_type_guess || determineEventType(act.raw_text);
        const source = mapSourceName(act.source, act.adapter_name);
        
        // Compute fingerprint for deduplication
        const fingerprint = computeEventFingerprint(
          source,
          radicado || 'unknown',
          eventDate,
          eventType,
          act.raw_text,
          act.source_url
        );
        
        // Normalize attachments
        const attachments = (act.attachments || []).map((att) => ({
          label: att.label || att.nombre || 'Documento',
          url: att.url || '',
        })).filter(att => att.url);
        
        // Detect milestones from patterns
        const detectedMilestones: DetectedMilestone[] = [];
        for (const pattern of milestonePatterns) {
          try {
            const regex = new RegExp(pattern.pattern_regex, 'gi');
            const match = regex.exec(act.raw_text);
            if (match) {
              const normalizedText = act.raw_text.toLowerCase();
              const keywordsMatched = (pattern.pattern_keywords || []).filter(kw => 
                normalizedText.includes(kw.toLowerCase())
              );
              
              detectedMilestones.push({
                milestone_type: pattern.milestone_type,
                confidence: Number(pattern.base_confidence) || 0.8,
                pattern_id: pattern.id,
                matched_text: match[0],
                keywords_matched: keywordsMatched,
              });
            }
          } catch (e) {
            // Invalid regex, skip
          }
        }
        
        processEvents.push({
          filing_id: targetFilingId,
          owner_id: act.owner_id,
          monitored_process_id: act.monitored_process_id,
          event_date: eventDate,
          event_type: eventType,
          title: generateSummary(act.raw_text, 100),
          description: act.raw_text,
          detail: act.normalized_text !== act.raw_text ? act.normalized_text : null,
          raw_data: act.raw_data,
          source_url: act.source_url,
          source,
          hash_fingerprint: fingerprint,
          attachments: attachments.length > 0 ? attachments : null,
          detected_milestones: detectedMilestones.length > 0 ? detectedMilestones : null,
        });
      } catch (err) {
        errors.push(`Failed to process actuacion ${act.id}: ${err}`);
      }
    }
    
    await logStep('TRANSFORM', true, `Transformed ${processEvents.length} events`, { errors_count: errors.length });
    
    // Fetch existing fingerprints to deduplicate
    const fingerprints = processEvents.map(e => e.hash_fingerprint);
    const { data: existingEvents, error: existingError } = await supabase
      .from('process_events')
      .select('hash_fingerprint')
      .in('hash_fingerprint', fingerprints);
    
    if (existingError) {
      await logStep('CHECK_DUPLICATES', false, `Error: ${existingError.message}`);
    }
    
    const existingFingerprints = new Set((existingEvents || []).map(e => e.hash_fingerprint));
    const existingCount = existingFingerprints.size;
    
    // Filter out duplicates
    const newEvents = force_reprocess 
      ? processEvents 
      : processEvents.filter(e => !existingFingerprints.has(e.hash_fingerprint));
    
    await logStep('DEDUPLICATE', true, `${existingCount} existing, ${newEvents.length} new to insert`);
    
    let insertedCount = 0;
    
    if (newEvents.length > 0) {
      // Insert in batches
      const batchSize = 50;
      for (let i = 0; i < newEvents.length; i += batchSize) {
        const batch = newEvents.slice(i, i + batchSize);
        
        const { error: insertError } = await supabase
          .from('process_events')
          .insert(batch);
        
        if (insertError) {
          errors.push(`Batch insert error at ${i}: ${insertError.message}`);
          await logStep('INSERT_BATCH', false, `Batch ${i / batchSize + 1} failed: ${insertError.message}`);
        } else {
          insertedCount += batch.length;
        }
      }
      
      await logStep('INSERT', true, `Inserted ${insertedCount} events`, { batch_count: Math.ceil(newEvents.length / batchSize) });
    }
    
    // Update monitored_process last_normalized_at
    if (monitored_process_id) {
      await supabase
        .from('monitored_processes')
        .update({ last_checked_at: new Date().toISOString() })
        .eq('id', monitored_process_id);
    }
    
    // Finalize crawler_run
    const counts = {
      ingested: ingestedCount,
      existing: existingCount,
      inserted: insertedCount,
      errors: errors.length,
    };
    
    await logStep('COMPLETE', true, `Normalization complete`, counts);
    
    if (runId) {
      await supabase
        .from('crawler_runs')
        .update({
          status: errors.length > 0 ? 'PARTIAL' : 'SUCCESS',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          response_meta: counts,
        })
        .eq('id', runId);
    }
    
    const result: NormalizationResult = {
      ok: true,
      run_id: runId || '',
      counts,
      errors: errors.length > 0 ? errors : undefined,
    };
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Normalization error:', error);
    
    // Try to update the run as failed
    if (runId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await supabase
          .from('crawler_runs')
          .update({
            status: 'FAILED',
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
            error_message: String(error),
          })
          .eq('id', runId);
      }
    }
    
    return new Response(
      JSON.stringify({ 
        ok: false, 
        run_id: runId,
        error: error instanceof Error ? error.message : String(error) 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
