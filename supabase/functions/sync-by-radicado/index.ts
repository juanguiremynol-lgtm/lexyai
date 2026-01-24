import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= TYPES =============

interface SyncRequest {
  radicado: string;
  force_refresh?: boolean;
  mode?: 'LOOKUP' | 'SYNC_AND_APPLY';
  create_if_missing?: boolean;
  workflow_type?: string;
  stage?: string;
  client_id?: string;
}

interface AttemptLog {
  source: string;
  success: boolean;
  latency_ms: number;
  error?: string;
  events_found?: number;
}

interface ProcessData {
  despacho?: string;
  ciudad?: string;
  departamento?: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  clase_proceso?: string;
  fecha_radicacion?: string;
  ultima_actuacion?: string;
  fecha_ultima_actuacion?: string;
  sujetos_procesales?: Array<{ tipo: string; nombre: string }>;
  actuaciones?: Array<{
    fecha: string;
    actuacion: string;
    anotacion?: string;
    fecha_inicia_termino?: string;
    fecha_finaliza_termino?: string;
  }>;
  total_actuaciones?: number;
}

interface SyncResponse {
  ok: boolean;
  work_item_id?: string;
  created: boolean;
  updated: boolean;
  found_in_source: boolean;
  source_used: string | null;
  new_events_count: number;
  milestones_triggered: number;
  // Classification: FILING = no Auto Admisorio, PROCESS = has Auto Admisorio
  cgp_phase?: 'FILING' | 'PROCESS';
  classification_reason?: string;
  // Preview data for LOOKUP mode
  process_data?: ProcessData;
  error?: string;
  code?: string;
  attempts?: AttemptLog[];
}

// ============= HELPERS =============

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number = 400): Response {
  return jsonResponse({
    ok: false,
    code,
    message,
    timestamp: new Date().toISOString(),
  }, status);
}

/**
 * Validate and normalize radicado input
 * 
 * CRITICAL: Radicado must ALWAYS be treated as STRING to preserve leading zeros.
 * 
 * Rules:
 * - Must be exactly 23 digits after stripping non-numeric characters
 * - For CGP workflows, must end with 00 or 01
 */
function validateRadicado(radicado: string, workflowType?: string): { 
  valid: boolean; 
  normalized: string; 
  error?: string;
  errorCode?: string;
} {
  if (!radicado || typeof radicado !== 'string') {
    return { 
      valid: false, 
      normalized: '', 
      error: 'Radicado es requerido',
      errorCode: 'EMPTY_RADICADO',
    };
  }
  
  // Remove ALL non-digit characters, keeping as string to preserve leading zeros
  const normalized = radicado.replace(/\D/g, '');
  
  if (normalized.length === 0) {
    return { 
      valid: false, 
      normalized: '', 
      error: 'El radicado no contiene dígitos válidos',
      errorCode: 'INVALID_CHARS',
    };
  }
  
  if (normalized.length !== 23) {
    return { 
      valid: false, 
      normalized, 
      error: `El radicado debe tener exactamente 23 dígitos (tiene ${normalized.length})`,
      errorCode: 'INVALID_LENGTH',
    };
  }
  
  // CGP-specific validation: must end with 00 or 01
  if (workflowType === 'CGP') {
    const ending = normalized.slice(-2);
    if (ending !== '00' && ending !== '01') {
      return {
        valid: false,
        normalized,
        error: `El radicado CGP debe terminar en 00 o 01 (termina en ${ending})`,
        errorCode: 'INVALID_ENDING',
      };
    }
  }
  
  return { valid: true, normalized };
}

/**
 * Detect if Auto Admisorio exists in actuaciones
 * This determines if the case is in FILING or PROCESS phase
 */
function detectAutoAdmisorio(actuaciones: Array<{ actuacion: string; anotacion?: string }>): {
  hasAutoAdmisorio: boolean;
  reason: string;
} {
  const AUTO_ADMISORIO_PATTERNS = [
    /auto\s+admisorio/i,
    /admite\s+demanda/i,
    /admision\s+de\s+demanda/i,
    /auto\s+que\s+admite/i,
    /se\s+admite\s+la?\s+demanda/i,
    /admite\s+tutela/i,
    /auto\s+avoca\s+conocimiento/i,
    /avoca\s+conocimiento/i,
    /auto\s+admite\s+accion/i,
    /se\s+avocar\s+conocimiento/i,
    /auto\s+interlocutorio.*admite/i,
    /admitir\s+demanda/i,
    /admitir\s+tutela/i,
    /admitir\s+accion/i,
  ];

  for (const act of actuaciones) {
    const text = `${act.actuacion || ''} ${act.anotacion || ''}`.toLowerCase();
    for (const pattern of AUTO_ADMISORIO_PATTERNS) {
      if (pattern.test(text)) {
        return {
          hasAutoAdmisorio: true,
          reason: `Detectado: "${act.actuacion?.substring(0, 50)}..."`,
        };
      }
    }
  }

  return {
    hasAutoAdmisorio: false,
    reason: 'No se encontró Auto Admisorio en las actuaciones',
  };
}

/**
 * Merge data from multiple sources, prioritizing the more complete one
 */
function mergeProcessData(cpnuData: ProcessData | null, externalData: ProcessData | null): ProcessData {
  if (!cpnuData && !externalData) return {};
  if (!cpnuData) return externalData!;
  if (!externalData) return cpnuData;

  // Prefer the source with more actuaciones
  const cpnuActCount = cpnuData.actuaciones?.length || 0;
  const externalActCount = externalData.actuaciones?.length || 0;
  
  const primary = cpnuActCount >= externalActCount ? cpnuData : externalData;
  const secondary = cpnuActCount >= externalActCount ? externalData : cpnuData;

  return {
    despacho: primary.despacho || secondary.despacho,
    ciudad: primary.ciudad || secondary.ciudad,
    departamento: primary.departamento || secondary.departamento,
    demandante: primary.demandante || secondary.demandante,
    demandado: primary.demandado || secondary.demandado,
    tipo_proceso: primary.tipo_proceso || secondary.tipo_proceso,
    clase_proceso: primary.clase_proceso || secondary.clase_proceso,
    fecha_radicacion: primary.fecha_radicacion || secondary.fecha_radicacion,
    ultima_actuacion: primary.ultima_actuacion || secondary.ultima_actuacion,
    fecha_ultima_actuacion: primary.fecha_ultima_actuacion || secondary.fecha_ultima_actuacion,
    sujetos_procesales: primary.sujetos_procesales?.length 
      ? primary.sujetos_procesales 
      : secondary.sujetos_procesales,
    actuaciones: cpnuActCount >= externalActCount 
      ? primary.actuaciones 
      : (externalData.actuaciones || primary.actuaciones),
    total_actuaciones: Math.max(cpnuActCount, externalActCount),
  };
}

/**
 * Parse Colombian date strings to ISO format
 */
function parseColombianDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  
  // Handle formats like "24/01/2024", "24-01-2024", "2024-01-24"
  const patterns = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,  // DD/MM/YYYY
    /^(\d{2})-(\d{2})-(\d{4})$/,     // DD-MM-YYYY
    /^(\d{4})-(\d{2})-(\d{2})$/,     // YYYY-MM-DD (ISO)
  ];

  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      if (pattern.source.startsWith('(\\d{4})')) {
        return dateStr; // Already ISO
      }
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
  }
  
  return null;
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const attempts: AttemptLog[] = [];

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('MISSING_ENV', 'Missing Supabase environment variables', 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '');
    
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    
    if (authError || !user) {
      return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
    }

    let payload: SyncRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400);
    }

    // Validate radicado with workflow-specific rules
    const validation = validateRadicado(payload.radicado, payload.workflow_type);
    if (!validation.valid) {
      console.log(`[sync-by-radicado] Validation failed: ${validation.error} (code: ${validation.errorCode})`);
      return errorResponse(
        validation.errorCode || 'INVALID_RADICADO', 
        validation.error || 'Invalid radicado', 
        400
      );
    }

    // CRITICAL: Use normalized string (preserves leading zeros)
    const radicado = validation.normalized;
    const mode = payload.mode || 'SYNC_AND_APPLY';
    const createIfMissing = payload.create_if_missing !== false;
    
    console.log(`[sync-by-radicado] Mode: ${mode}, Radicado: ${radicado} (len=${radicado.length}), Workflow: ${payload.workflow_type || 'any'}, User: ${user.id}`);

    // ============= CONCURRENT FETCH: CPNU + External API =============
    
    let cpnuData: ProcessData | null = null;
    let externalData: ProcessData | null = null;
    let cpnuSuccess = false;
    let externalSuccess = false;

    // Prepare fetch promises
    const cpnuPromise = (async () => {
      const cpnuStartTime = Date.now();
      try {
        const cpnuResponse = await fetch(
          `${supabaseUrl}/functions/v1/adapter-cpnu`,
          {
            method: 'POST',
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              radicado,
              action: 'search',
            }),
          }
        );

        const cpnuResult = await cpnuResponse.json();
        const latency = Date.now() - cpnuStartTime;
        
        if (cpnuResult.ok && cpnuResult.results?.length > 0) {
          const result = cpnuResult.results[0];
          const proceso = cpnuResult.proceso;
          
          // Extract parties from sujetos_procesales
          let demandantes = result.demandante || '';
          let demandados = result.demandado || '';
          
          if (proceso?.sujetos_procesales?.length > 0) {
            const demandantesList = proceso.sujetos_procesales
              .filter((s: { tipo: string }) => 
                s.tipo?.toLowerCase().includes('demandante') || 
                s.tipo?.toLowerCase().includes('actor') ||
                s.tipo?.toLowerCase().includes('accionante')
              )
              .map((s: { nombre: string }) => s.nombre);
            const demandadosList = proceso.sujetos_procesales
              .filter((s: { tipo: string }) => 
                s.tipo?.toLowerCase().includes('demandado') ||
                s.tipo?.toLowerCase().includes('accionado')
              )
              .map((s: { nombre: string }) => s.nombre);
            
            if (demandantesList.length) demandantes = demandantesList.join(', ');
            if (demandadosList.length) demandados = demandadosList.join(', ');
          }

          // Map actuaciones
          const actuaciones = (cpnuResult.events || proceso?.actuaciones || []).map((act: Record<string, unknown>) => ({
            fecha: act.event_date || act.fecha || '',
            actuacion: act.title || act.actuacion || '',
            anotacion: act.description || act.anotacion || '',
            fecha_inicia_termino: act.fecha_inicia_termino,
            fecha_finaliza_termino: act.fecha_finaliza_termino,
          }));

          cpnuData = {
            despacho: result.despacho || proceso?.despacho,
            demandante: demandantes,
            demandado: demandados,
            tipo_proceso: result.tipo_proceso || proceso?.tipo,
            clase_proceso: result.clase_proceso || proceso?.clase,
            fecha_radicacion: result.fecha_radicacion,
            sujetos_procesales: proceso?.sujetos_procesales,
            actuaciones,
            total_actuaciones: actuaciones.length,
          };
          
          cpnuSuccess = true;
          attempts.push({
            source: 'CPNU',
            success: true,
            latency_ms: latency,
            events_found: actuaciones.length,
          });
        } else {
          attempts.push({
            source: 'CPNU',
            success: false,
            latency_ms: latency,
            error: cpnuResult.error || cpnuResult.why_empty || 'No results',
          });
        }
      } catch (err) {
        attempts.push({
          source: 'CPNU',
          success: false,
          latency_ms: Date.now() - cpnuStartTime,
          error: err instanceof Error ? err.message : 'CPNU fetch failed',
        });
      }
    })();

    // External API (Render) - concurrent fetch
    const externalPromise = (async () => {
      const externalStartTime = Date.now();
      try {
        // Step 1: Start job
        const startResponse = await fetch(
          `https://rama-judicial-api.onrender.com/buscar?numero_radicacion=${radicado}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          }
        );

        if (!startResponse.ok) {
          attempts.push({
            source: 'EXTERNAL_API',
            success: false,
            latency_ms: Date.now() - externalStartTime,
            error: `HTTP ${startResponse.status}`,
          });
          return;
        }

        const startData = await startResponse.json();
        
        // Handle job-based polling or direct response
        let data: Record<string, unknown>;
        
        if (startData.jobId) {
          // Poll for results
          let pollAttempts = 0;
          const maxPolls = 30; // 60 seconds max (2s intervals)
          
          while (pollAttempts < maxPolls) {
            pollAttempts++;
            await new Promise(r => setTimeout(r, 2000));
            
            const pollResponse = await fetch(
              `https://rama-judicial-api.onrender.com/resultado/${startData.jobId}`,
              { method: 'GET', headers: { 'Accept': 'application/json' } }
            );
            
            const pollData = await pollResponse.json();
            
            if (pollData.status === 'completed') {
              data = pollData;
              break;
            } else if (pollData.status === 'failed' || pollData.estado === 'NO_ENCONTRADO') {
              attempts.push({
                source: 'EXTERNAL_API',
                success: false,
                latency_ms: Date.now() - externalStartTime,
                error: pollData.error || 'Not found',
              });
              return;
            }
          }
          
          if (!data!) {
            attempts.push({
              source: 'EXTERNAL_API',
              success: false,
              latency_ms: Date.now() - externalStartTime,
              error: 'Polling timeout',
            });
            return;
          }
        } else if (startData.proceso) {
          data = startData;
        } else if (startData.estado === 'NO_ENCONTRADO') {
          attempts.push({
            source: 'EXTERNAL_API',
            success: false,
            latency_ms: Date.now() - externalStartTime,
            error: 'Not found in external API',
          });
          return;
        } else {
          attempts.push({
            source: 'EXTERNAL_API',
            success: false,
            latency_ms: Date.now() - externalStartTime,
            error: 'Unexpected response format',
          });
          return;
        }

        // Parse external API response
        const proceso = data.proceso as Record<string, string> | undefined;
        const actuacionesRaw = data.actuaciones as Array<Record<string, string>> || [];
        
        if (proceso) {
          const actuaciones = actuacionesRaw.map(act => ({
            fecha: act['Fecha de Actuación'] || '',
            actuacion: act['Actuación'] || '',
            anotacion: act['Anotación'] || '',
            fecha_inicia_termino: act['Fecha inicia Término'],
            fecha_finaliza_termino: act['Fecha finaliza Término'],
          }));

          externalData = {
            despacho: proceso['Despacho'],
            demandante: proceso['Demandante'],
            demandado: proceso['Demandado'],
            tipo_proceso: proceso['Tipo de Proceso'],
            clase_proceso: proceso['Clase de Proceso'],
            fecha_radicacion: proceso['Fecha de Radicación'],
            ultima_actuacion: (data.ultima_actuacion as Record<string, string>)?.['Actuación'],
            fecha_ultima_actuacion: (data.ultima_actuacion as Record<string, string>)?.['Fecha de Actuación'],
            actuaciones,
            total_actuaciones: actuaciones.length,
          };
          
          externalSuccess = true;
          attempts.push({
            source: 'EXTERNAL_API',
            success: true,
            latency_ms: Date.now() - externalStartTime,
            events_found: actuaciones.length,
          });
        }
      } catch (err) {
        attempts.push({
          source: 'EXTERNAL_API',
          success: false,
          latency_ms: Date.now() - externalStartTime,
          error: err instanceof Error ? err.message : 'External API fetch failed',
        });
      }
    })();

    // Wait for both to complete (with timeout)
    await Promise.allSettled([cpnuPromise, externalPromise]);

    // ============= MERGE RESULTS =============
    
    const mergedData = mergeProcessData(cpnuData, externalData);
    const foundInSource = cpnuSuccess || externalSuccess;
    const sourceUsed = cpnuSuccess && externalSuccess 
      ? 'CPNU+EXTERNAL_API' 
      : cpnuSuccess 
        ? 'CPNU' 
        : externalSuccess 
          ? 'EXTERNAL_API' 
          : null;

    // ============= CLASSIFY FILING vs PROCESS =============
    
    const { hasAutoAdmisorio, reason: classificationReason } = detectAutoAdmisorio(
      mergedData.actuaciones || []
    );
    const cgpPhase = hasAutoAdmisorio ? 'PROCESS' : 'FILING';

    // ============= LOOKUP MODE: Return preview only =============
    
    if (mode === 'LOOKUP') {
      const response: SyncResponse = {
        ok: true,
        created: false,
        updated: false,
        found_in_source: foundInSource,
        source_used: sourceUsed,
        new_events_count: mergedData.total_actuaciones || 0,
        milestones_triggered: 0,
        cgp_phase: cgpPhase,
        classification_reason: classificationReason,
        process_data: mergedData,
        attempts,
      };
      
      console.log(`[sync-by-radicado] LOOKUP completed in ${Date.now() - startTime}ms`);
      return jsonResponse(response);
    }

    // ============= SYNC_AND_APPLY MODE: Create/Update Work Item =============

    // Check if work_item already exists
    const { data: existingWorkItem } = await supabase
      .from('work_items')
      .select('id, radicado, cgp_phase, stage')
      .eq('owner_id', user.id)
      .eq('radicado', radicado)
      .maybeSingle();

    let workItemId: string | null = existingWorkItem?.id || null;
    let created = false;
    let updated = false;

    // Determine workflow type and stage based on classification
    const workflowType = payload.workflow_type || 'CGP';
    let stage = payload.stage;
    
    if (!stage) {
      if (workflowType === 'CGP') {
        stage = hasAutoAdmisorio ? 'AUTO_ADMISORIO' : 'RADICADO_CONFIRMED';
      } else if (workflowType === 'CPACA') {
        stage = hasAutoAdmisorio ? 'AUTO_ADMISORIO' : 'DEMANDA_RADICADA';
      } else if (workflowType === 'TUTELA') {
        stage = hasAutoAdmisorio ? 'TUTELA_ADMITIDA' : 'TUTELA_RADICADA';
      } else {
        stage = 'MONITORING';
      }
    }

    if (foundInSource || createIfMissing) {
      const updateData: Record<string, unknown> = {
        authority_name: mergedData.despacho || null,
        authority_city: mergedData.ciudad || null,
        authority_department: mergedData.departamento || null,
        demandantes: mergedData.demandante || null,
        demandados: mergedData.demandado || null,
        radicado_verified: foundInSource,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Parse filing date if available
      if (mergedData.fecha_radicacion) {
        const parsedDate = parseColombianDate(mergedData.fecha_radicacion);
        if (parsedDate) {
          updateData.filing_date = parsedDate;
        }
      }

      if (existingWorkItem) {
        // Update existing work_item
        await supabase
          .from('work_items')
          .update({
            ...updateData,
            cgp_phase: workflowType === 'CGP' ? cgpPhase : null,
          })
          .eq('id', existingWorkItem.id);
        
        workItemId = existingWorkItem.id;
        updated = true;
      } else if (createIfMissing) {
        // Create new work_item
        const { data: newWorkItem, error: insertError } = await supabase
          .from('work_items')
          .insert({
            owner_id: user.id,
            radicado,
            radicado_verified: foundInSource,
            workflow_type: workflowType,
            stage,
            cgp_phase: workflowType === 'CGP' ? cgpPhase : null,
            cgp_phase_source: 'AUTO',
            status: 'ACTIVE',
            source: foundInSource ? 'SCRAPE_API' : 'MANUAL',
            source_reference: `sync-by-radicado-${Date.now()}`,
            authority_name: updateData.authority_name,
            authority_city: updateData.authority_city,
            authority_department: updateData.authority_department,
            demandantes: updateData.demandantes,
            demandados: updateData.demandados,
            filing_date: updateData.filing_date,
            client_id: payload.client_id || null,
            is_flagged: false,
            monitoring_enabled: true,
            email_linking_enabled: true,
          })
          .select('id')
          .single();

        if (insertError) {
          console.error('[sync-by-radicado] Insert error:', insertError);
          return errorResponse('INSERT_ERROR', insertError.message, 500);
        }

        workItemId = newWorkItem?.id || null;
        created = true;
      }

      // Create process_events for actuaciones
      if (workItemId && mergedData.actuaciones?.length) {
        const eventsToInsert = mergedData.actuaciones.slice(0, 50).map((act, idx) => ({
          work_item_id: workItemId,
          owner_id: user.id,
          source: sourceUsed || 'SYNC_BY_RADICADO',
          event_type: 'ACTUACION',
          event_date: parseColombianDate(act.fecha),
          title: act.actuacion?.substring(0, 255) || 'Sin título',
          description: act.anotacion || null,
          hash_fingerprint: `${radicado}-${act.fecha}-${idx}`,
          created_at: new Date().toISOString(),
        }));

        // Upsert events (avoid duplicates)
        for (const event of eventsToInsert) {
          await supabase
            .from('process_events')
            .upsert(event, {
              onConflict: 'hash_fingerprint',
              ignoreDuplicates: true,
            });
        }
      }
    }

    const response: SyncResponse = {
      ok: true,
      work_item_id: workItemId || undefined,
      created,
      updated,
      found_in_source: foundInSource,
      source_used: sourceUsed,
      new_events_count: mergedData.total_actuaciones || 0,
      milestones_triggered: 0,
      cgp_phase: cgpPhase,
      classification_reason: classificationReason,
      process_data: mergedData,
      attempts,
    };

    console.log(`[sync-by-radicado] Completed in ${Date.now() - startTime}ms:`, {
      created,
      updated,
      foundInSource,
      cgpPhase,
    });

    return jsonResponse(response);

  } catch (error) {
    console.error('[sync-by-radicado] Unexpected error:', error);
    return errorResponse(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Unexpected error',
      500
    );
  }
});
