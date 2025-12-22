import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.89.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessEvent {
  source: string;
  event_type: string;
  event_date: string | null;
  title: string;
  description: string;
  detail?: string;
  attachments: Array<{ label: string; url: string }>;
  source_url: string;
  hash_fingerprint: string;
  raw_data?: Record<string, unknown>;
}

interface SearchResult {
  radicado: string;
  despacho: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  fecha_radicacion?: string;
  detail_url?: string;
  id_proceso?: number;
}

// Compute hash fingerprint for deduplication
function computeFingerprint(source: string, eventDate: string | null, description: string, sourceUrl: string): string {
  const data = `${source}|${eventDate || ''}|${description}|${sourceUrl}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// Parse Colombian date format
function parseColombianDate(dateStr: string): string | null {
  if (!dateStr) return null;
  
  // Try ISO format first
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return new Date(dateStr).toISOString();
  }
  
  // DD/MM/YYYY or DD-MM-YYYY
  const match = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!match) return null;
  
  let [, day, month, year] = match;
  if (year.length === 2) {
    year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
  }
  
  try {
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toISOString();
  } catch {
    return null;
  }
}

// Determine event type from description
function determineEventType(description: string): string {
  const lowerDesc = description.toLowerCase();
  
  if (lowerDesc.includes('audiencia')) return 'AUDIENCIA';
  if (lowerDesc.includes('sentencia')) return 'SENTENCIA';
  if (lowerDesc.includes('auto admite') || lowerDesc.includes('auto que admite')) return 'AUTO';
  if (lowerDesc.includes('auto')) return 'AUTO';
  if (lowerDesc.includes('notifica')) return 'NOTIFICACION';
  if (lowerDesc.includes('traslado')) return 'TRASLADO';
  if (lowerDesc.includes('memorial') || lowerDesc.includes('escrito')) return 'MEMORIAL';
  if (lowerDesc.includes('providencia')) return 'PROVIDENCIA';
  if (lowerDesc.includes('estado')) return 'ESTADO_ELECTRONICO';
  
  return 'ACTUACION';
}

// Add a step to the crawler run
async function addStep(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  stepName: string,
  ok: boolean,
  detail?: string,
  meta?: Record<string, unknown>
) {
  try {
    await (supabase as any).from('crawler_run_steps').insert({
      run_id: runId,
      step_name: stepName,
      ok,
      detail: detail?.substring(0, 500),
      meta: meta || {},
    });
  } catch (e) {
    console.error('Failed to add step:', e);
  }
}

// Finalize the crawler run
async function finalizeRun(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  status: string,
  startTime: number,
  httpStatus?: number,
  errorCode?: string,
  errorMessage?: string,
  responseMeta?: Record<string, unknown>,
  debugExcerpt?: string
) {
  const duration = Date.now() - startTime;
  await (supabase as any).from('crawler_runs').update({
    finished_at: new Date().toISOString(),
    status,
    http_status: httpStatus,
    error_code: errorCode,
    error_message: errorMessage?.substring(0, 1000),
    duration_ms: duration,
    response_meta: responseMeta || {},
    debug_excerpt: debugExcerpt?.substring(0, 10000),
  }).eq('id', runId);
}

// CPNU API Endpoints (discovered via network inspection)
const CPNU_API = {
  // The actual API endpoint that the SPA uses
  CONSULTA: 'https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Procesos/Consulta',
  DETALLE: 'https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Proceso/Detalle',
  ACTUACIONES: 'https://consultaprocesos.ramajudicial.gov.co:448/api/v2/Proceso/Actuaciones',
};

// Default headers for CPNU API
function getCPNUHeaders(): Record<string, string> {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://consultaprocesos.ramajudicial.gov.co',
    'Referer': 'https://consultaprocesos.ramajudicial.gov.co/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
}

// Search by radicado using direct API
async function searchByRadicadoAPI(radicado: string): Promise<{
  success: boolean;
  results: SearchResult[];
  httpStatus: number;
  error?: string;
  rawResponse?: unknown;
}> {
  // The CPNU API expects a specific payload format
  const payload = {
    numero: radicado,
    nombreRazonSocial: '',
    tipoPersona: 'nat',
    codificacionDespacho: '',
    SoloActivos: null,
    pagina: 1,
    cantFilas: 20,
  };

  console.log('CPNU API: Calling search endpoint with payload:', JSON.stringify(payload));

  try {
    const response = await fetch(CPNU_API.CONSULTA, {
      method: 'POST',
      headers: getCPNUHeaders(),
      body: JSON.stringify(payload),
    });

    const httpStatus = response.status;
    console.log('CPNU API: Response status:', httpStatus);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('CPNU API: Error response:', errorText.substring(0, 500));
      return {
        success: false,
        results: [],
        httpStatus,
        error: `HTTP ${httpStatus}: ${response.statusText}`,
        rawResponse: errorText.substring(0, 2000),
      };
    }

    const data = await response.json();
    console.log('CPNU API: Response data keys:', Object.keys(data));

    // Parse the response - CPNU returns { procesos: [...], paginas: X }
    const procesos = data.procesos || [];
    console.log('CPNU API: Found', procesos.length, 'processes');

    const results: SearchResult[] = procesos.map((p: any) => {
      const sujetosProcesales = p.sujetosProcesales || '';
      const partes = typeof sujetosProcesales === 'string' ? sujetosProcesales.split(' VS ') : [];
      
      return {
        radicado: String(p.numero23 || p.llaveProceso || ''),
        despacho: String(p.despacho || ''),
        demandante: partes[0] || String(p.demandante || ''),
        demandado: partes[1] || String(p.demandado || ''),
        tipo_proceso: String(p.tipoProceso || ''),
        fecha_radicacion: String(p.fechaProceso || ''),
        id_proceso: p.idProceso as number,
        detail_url: `https://consultaprocesos.ramajudicial.gov.co/Procesos/Detalle?idProceso=${p.idProceso}`,
      };
    });

    return {
      success: true,
      results,
      httpStatus,
      rawResponse: data,
    };
  } catch (error) {
    console.error('CPNU API: Fetch error:', error);
    return {
      success: false,
      results: [],
      httpStatus: 0,
      error: error instanceof Error ? error.message : 'Unknown fetch error',
    };
  }
}

// Get actuaciones for a process using direct API
async function getActuacionesAPI(idProceso: number): Promise<{
  success: boolean;
  events: ProcessEvent[];
  httpStatus: number;
  error?: string;
  rawResponse?: unknown;
}> {
  console.log('CPNU API: Fetching actuaciones for idProceso:', idProceso);

  try {
    const response = await fetch(`${CPNU_API.ACTUACIONES}/${idProceso}`, {
      method: 'GET',
      headers: getCPNUHeaders(),
    });

    const httpStatus = response.status;
    console.log('CPNU API: Actuaciones response status:', httpStatus);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        events: [],
        httpStatus,
        error: `HTTP ${httpStatus}: ${response.statusText}`,
        rawResponse: errorText.substring(0, 2000),
      };
    }

    const data = await response.json();
    console.log('CPNU API: Actuaciones data keys:', Object.keys(data));

    // Parse actuaciones
    const actuaciones = data.actuaciones || data || [];
    const sourceUrl = `https://consultaprocesos.ramajudicial.gov.co/Procesos/Detalle?idProceso=${idProceso}`;

    const events: ProcessEvent[] = (Array.isArray(actuaciones) ? actuaciones : []).map((a: any) => {
      const fechaActuacion = String(a.fechaActuacion || a.fechaInicial || '');
      const descripcion = String(a.actuacion || a.anotacion || '');
      const eventDate = parseColombianDate(fechaActuacion);
      
      // Build attachments from documentos if present
      const attachments: Array<{ label: string; url: string }> = [];
      if (Array.isArray(a.documentos)) {
        for (const doc of a.documentos) {
          if (doc.url || doc.urlDocumento) {
            attachments.push({
              label: String(doc.nombre || doc.descripcion || 'Documento'),
              url: String(doc.url || doc.urlDocumento),
            });
          }
        }
      }

      return {
        source: 'CPNU',
        event_type: determineEventType(descripcion),
        event_date: eventDate,
        title: descripcion.substring(0, 100),
        description: descripcion,
        detail: String(a.anotacion || ''),
        attachments,
        source_url: sourceUrl,
        hash_fingerprint: computeFingerprint('CPNU', eventDate, descripcion, sourceUrl),
        raw_data: a,
      };
    });

    return {
      success: true,
      events,
      httpStatus,
      rawResponse: data,
    };
  } catch (error) {
    console.error('CPNU API: Actuaciones fetch error:', error);
    return {
      success: false,
      events: [],
      httpStatus: 0,
      error: error instanceof Error ? error.message : 'Unknown fetch error',
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let runId: string | null = null;
  let supabase: any = null;

  try {
    const { action, radicado, owner_id, monitored_process_id } = await req.json();
    
    if (!action || !owner_id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing required fields: action, owner_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create crawler run for diagnostics
    const { data: runData, error: runError } = await supabase
      .from('crawler_runs')
      .insert({
        owner_id,
        radicado: radicado || 'N/A',
        adapter: 'CPNU',
        status: 'RUNNING',
        request_meta: {
          action,
          radicado,
          api_endpoints: CPNU_API,
        },
      })
      .select('id')
      .single();

    if (runError) {
      console.error('Failed to create crawler run:', runError);
    }
    runId = runData?.id;
    console.log('CPNU: Created crawler run:', runId);

    // Search action
    if (action === 'search') {
      if (!radicado) {
        if (runId) await addStep(supabase, runId, 'VALIDATE', false, 'Missing radicado');
        if (runId) await finalizeRun(supabase, runId, 'ERROR', startTime, undefined, 'MISSING_PARAM', 'Radicado is required');
        return new Response(
          JSON.stringify({ ok: false, error: 'Radicado is required for search', run_id: runId }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Ensure radicado is treated as string (preserve leading zeros)
      const radicadoStr = String(radicado).trim();
      if (runId) await addStep(supabase, runId, 'VALIDATE', true, `Radicado: ${radicadoStr} (${radicadoStr.length} chars)`);

      // Step 1: Call CPNU API directly
      if (runId) await addStep(supabase, runId, 'FETCH', true, 'Calling CPNU API endpoint', { endpoint: CPNU_API.CONSULTA });
      
      const searchResult = await searchByRadicadoAPI(radicadoStr);
      
      if (!searchResult.success) {
        // API call failed - check if blocked
        const isBlocked = searchResult.httpStatus === 403 || searchResult.httpStatus === 429;
        
        if (runId) await addStep(supabase, runId, 'FETCH', false, searchResult.error, {
          http_status: searchResult.httpStatus,
          blocked: isBlocked,
        });

        if (runId) await finalizeRun(
          supabase,
          runId,
          'ERROR',
          startTime,
          searchResult.httpStatus,
          isBlocked ? 'BLOCKED' : 'HTTP_ERROR',
          searchResult.error,
          { blocked_flag: isBlocked },
          JSON.stringify(searchResult.rawResponse).substring(0, 10000)
        );

        return new Response(
          JSON.stringify({
            ok: false,
            error: searchResult.error,
            run_id: runId,
            http_status: searchResult.httpStatus,
            blocked: isBlocked,
            source: 'CPNU',
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (runId) await addStep(supabase, runId, 'PARSE', true, `Parsed ${searchResult.results.length} results`, {
        count: searchResult.results.length,
        http_status: searchResult.httpStatus,
      });

      // If we found results, get actuaciones for the matching process
      let events: ProcessEvent[] = [];
      if (searchResult.results.length > 0) {
        // Find exact radicado match
        const exactMatch = searchResult.results.find(r => r.radicado === radicadoStr);
        const targetResult = exactMatch || searchResult.results[0];
        
        if (targetResult.id_proceso) {
          if (runId) await addStep(supabase, runId, 'FETCH', true, 'Fetching actuaciones', { id_proceso: targetResult.id_proceso });
          
          const actuacionesResult = await getActuacionesAPI(targetResult.id_proceso);
          
          if (actuacionesResult.success) {
            events = actuacionesResult.events;
            if (runId) await addStep(supabase, runId, 'NORMALIZE', true, `Normalized ${events.length} events`, {
              count: events.length,
            });
          } else {
            if (runId) await addStep(supabase, runId, 'FETCH', false, actuacionesResult.error, {
              http_status: actuacionesResult.httpStatus,
            });
          }
        }
      }

      // Finalize run
      const status = searchResult.results.length > 0 ? 'SUCCESS' : 'EMPTY';
      if (runId) await finalizeRun(
        supabase,
        runId,
        status,
        startTime,
        searchResult.httpStatus,
        undefined,
        undefined,
        { results_count: searchResult.results.length, events_count: events.length },
        JSON.stringify(searchResult.rawResponse).substring(0, 10000)
      );

      return new Response(
        JSON.stringify({
          ok: true,
          success: true,
          source: 'CPNU',
          run_id: runId,
          results: searchResult.results,
          events,
          search_url: CPNU_API.CONSULTA,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Crawl action
    if (action === 'crawl') {
      if (!radicado) {
        if (runId) await addStep(supabase, runId, 'VALIDATE', false, 'Missing radicado');
        if (runId) await finalizeRun(supabase, runId, 'ERROR', startTime, undefined, 'MISSING_PARAM', 'Radicado is required');
        return new Response(
          JSON.stringify({ ok: false, error: 'Radicado is required for crawl', run_id: runId }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const radicadoStr = String(radicado).trim();
      if (runId) await addStep(supabase, runId, 'VALIDATE', true, `Crawling radicado: ${radicadoStr}`);

      // Step 1: Search for the process
      if (runId) await addStep(supabase, runId, 'FETCH', true, 'Searching process via API');
      const searchResult = await searchByRadicadoAPI(radicadoStr);

      if (!searchResult.success || searchResult.results.length === 0) {
        const errorMsg = searchResult.error || 'No process found';
        if (runId) await addStep(supabase, runId, 'FETCH', false, errorMsg, {
          http_status: searchResult.httpStatus,
        });
        if (runId) await finalizeRun(supabase, runId, 'EMPTY', startTime, searchResult.httpStatus, 'NOT_FOUND', errorMsg);

        return new Response(
          JSON.stringify({
            ok: true,
            success: true,
            source: 'CPNU',
            run_id: runId,
            events_found: 0,
            new_events: 0,
            events: [],
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get the matching process
      const exactMatch = searchResult.results.find(r => r.radicado === radicadoStr);
      const targetResult = exactMatch || searchResult.results[0];
      
      if (runId) await addStep(supabase, runId, 'PARSE', true, `Found process: ${targetResult.despacho}`, {
        id_proceso: targetResult.id_proceso,
      });

      // Step 2: Get actuaciones
      let events: ProcessEvent[] = [];
      if (targetResult.id_proceso) {
        if (runId) await addStep(supabase, runId, 'FETCH', true, 'Fetching actuaciones');
        const actuacionesResult = await getActuacionesAPI(targetResult.id_proceso);
        
        if (actuacionesResult.success) {
          events = actuacionesResult.events;
          if (runId) await addStep(supabase, runId, 'NORMALIZE', true, `Normalized ${events.length} events`);
        } else {
          if (runId) await addStep(supabase, runId, 'FETCH', false, actuacionesResult.error);
        }
      }

      // Step 3: Detect new events by fingerprint
      let existingFingerprints: Set<string> = new Set();
      if (monitored_process_id) {
        const { data: existingEvents } = await supabase
          .from('process_events')
          .select('hash_fingerprint')
          .eq('monitored_process_id', monitored_process_id)
          .eq('source', 'CPNU');
        
        existingFingerprints = new Set(existingEvents?.map((e: any) => e.hash_fingerprint).filter(Boolean) || []);
      }

      const newEvents = events.filter(e => !existingFingerprints.has(e.hash_fingerprint));
      if (runId) await addStep(supabase, runId, 'UPSERT_DB', true, `New events: ${newEvents.length} of ${events.length}`, {
        total: events.length,
        new: newEvents.length,
        existing_fingerprints: existingFingerprints.size,
      });

      // Step 4: Insert new events
      if (newEvents.length > 0 && monitored_process_id) {
        // Need to get a filing_id - find one linked to this radicado
        const { data: filing } = await supabase
          .from('filings')
          .select('id')
          .eq('radicado', radicadoStr)
          .eq('owner_id', owner_id)
          .maybeSingle();

        if (filing) {
          const { error: insertError } = await supabase
            .from('process_events')
            .insert(newEvents.map(e => ({
              owner_id,
              filing_id: filing.id,
              monitored_process_id,
              source: e.source,
              event_type: e.event_type,
              event_date: e.event_date,
              title: e.title,
              description: e.description,
              detail: e.detail,
              attachments: e.attachments,
              source_url: e.source_url,
              hash_fingerprint: e.hash_fingerprint,
              raw_data: e.raw_data,
            })));

          if (insertError) {
            console.error('Error inserting events:', insertError);
            if (runId) await addStep(supabase, runId, 'UPSERT_DB', false, insertError.message);
          } else {
            // Create alert
            await supabase.from('alerts').insert({
              owner_id,
              filing_id: filing.id,
              message: `CPNU: ${newEvents.length} nueva(s) actuación(es) en proceso ${radicadoStr}`,
              severity: 'INFO',
            });
          }
        }

        // Update monitored_process timestamps
        await supabase
          .from('monitored_processes')
          .update({
            last_checked_at: new Date().toISOString(),
            last_change_at: new Date().toISOString(),
            despacho_name: targetResult.despacho || undefined,
          })
          .eq('id', monitored_process_id);
      } else if (monitored_process_id) {
        await supabase
          .from('monitored_processes')
          .update({ 
            last_checked_at: new Date().toISOString(),
            despacho_name: targetResult.despacho || undefined,
          })
          .eq('id', monitored_process_id);
      }

      if (runId) await addStep(supabase, runId, 'RETURN_UI', true, 'Returning results');
      if (runId) await finalizeRun(supabase, runId, 'SUCCESS', startTime, searchResult.httpStatus, undefined, undefined, {
        events_found: events.length,
        new_events: newEvents.length,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          success: true,
          source: 'CPNU',
          run_id: runId,
          events_found: events.length,
          new_events: newEvents.length,
          events: newEvents,
          process_info: targetResult,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Unknown action
    if (runId) await finalizeRun(supabase, runId, 'ERROR', startTime, undefined, 'UNKNOWN_ACTION', `Unknown action: ${action}`);
    
    return new Response(
      JSON.stringify({ ok: false, error: `Unknown action: ${action}`, run_id: runId }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in adapter-cpnu:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Try to finalize run if we have one
    if (runId && supabase) {
      try {
        await finalizeRun(supabase, runId, 'ERROR', startTime, undefined, 'EXCEPTION', errorMessage);
      } catch (e) {
        console.error('Failed to finalize run on error:', e);
      }
    }

    return new Response(
      JSON.stringify({ ok: false, error: errorMessage, source: 'CPNU', run_id: runId }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
