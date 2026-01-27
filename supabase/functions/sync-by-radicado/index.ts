/**
 * sync-by-radicado Edge Function
 * 
 * REFACTORED: This is now a thin wrapper that:
 * 1. Validates and normalizes the radicado
 * 2. Resolves or creates the work_item
 * 3. Delegates actual sync to sync-by-work-item
 * 
 * NO external API URLs are hardcoded here.
 * 
 * Modes:
 * - LOOKUP: Preview data without persisting (resolves via server-side adapters)
 * - SYNC_AND_APPLY: Create/update work_item and sync events
 */

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

interface SyncResponse {
  ok: boolean;
  work_item_id?: string;
  created: boolean;
  updated: boolean;
  found_in_source: boolean;
  source_used: string | null;
  new_events_count: number;
  milestones_triggered: number;
  cgp_phase?: 'FILING' | 'PROCESS';
  classification_reason?: string;
  process_data?: ProcessData;
  error?: string;
  code?: string;
  attempts?: AttemptLog[];
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
  }>;
  total_actuaciones?: number;
}

interface AttemptLog {
  source: string;
  success: boolean;
  latency_ms: number;
  error?: string;
  events_found?: number;
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
 * Parse Colombian date strings to ISO format
 */
function parseColombianDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  
  const patterns = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    /^(\d{2})-(\d{2})-(\d{4})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/,
  ];

  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      if (pattern.source.startsWith('(\\d{4})')) {
        return dateStr;
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
    
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authError } = await anonClient.auth.getClaims(token);
    
    if (authError || !claims?.claims?.sub) {
      return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
    }

    const userId = claims.claims.sub as string;

    let payload: SyncRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400);
    }

    // Validate radicado with workflow-specific rules
    const validation = validateRadicado(payload.radicado, payload.workflow_type);
    if (!validation.valid) {
      console.log(`[sync-by-radicado] Validation failed: ${validation.error}`);
      return errorResponse(
        validation.errorCode || 'INVALID_RADICADO', 
        validation.error || 'Invalid radicado', 
        400
      );
    }

    const radicado = validation.normalized;
    const mode = payload.mode || 'SYNC_AND_APPLY';
    const createIfMissing = payload.create_if_missing !== false;
    const workflowType = payload.workflow_type || 'CGP';
    
    console.log(`[sync-by-radicado] Mode: ${mode}, Radicado: ${radicado}, Workflow: ${workflowType}, User: ${userId}`);

    // Get user's organization
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', userId)
      .maybeSingle();

    const organizationId = profile?.organization_id;
    if (!organizationId) {
      return errorResponse('NO_ORGANIZATION', 'User is not part of an organization', 400);
    }

    // Check if work_item already exists for this radicado + user
    const { data: existingWorkItem } = await supabase
      .from('work_items')
      .select('id, cgp_phase, stage, demandantes, demandados, authority_name, last_action_date, total_actuaciones')
      .eq('owner_id', userId)
      .eq('radicado', radicado)
      .maybeSingle();

    // ============= SYNC_AND_APPLY MODE WITH EXISTING WORK_ITEM =============
    
    if (existingWorkItem && mode === 'SYNC_AND_APPLY') {
      // Delegate to sync-by-work-item
      console.log(`[sync-by-radicado] Delegating to sync-by-work-item for existing item: ${existingWorkItem.id}`);
      
      const syncResponse = await fetch(
        `${supabaseUrl}/functions/v1/sync-by-work-item`,
        {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            work_item_id: existingWorkItem.id,
            force_refresh: payload.force_refresh,
          }),
        }
      );

      const syncResult = await syncResponse.json();
      
      if (syncResult.ok) {
        // Re-fetch to get updated data for response
        const { data: updatedWorkItem } = await supabase
          .from('work_items')
          .select('cgp_phase, demandantes, demandados, authority_name, last_action_date, total_actuaciones')
          .eq('id', existingWorkItem.id)
          .single();

        const { data: actuaciones } = await supabase
          .from('actuaciones')
          .select('act_date, raw_text, normalized_text')
          .eq('work_item_id', existingWorkItem.id)
          .order('act_date', { ascending: false })
          .limit(50);

        const processData: ProcessData = {
          despacho: updatedWorkItem?.authority_name,
          demandante: updatedWorkItem?.demandantes,
          demandado: updatedWorkItem?.demandados,
          fecha_ultima_actuacion: updatedWorkItem?.last_action_date,
          actuaciones: actuaciones?.map(a => ({
            fecha: a.act_date || '',
            actuacion: a.raw_text,
            anotacion: '',
          })) || [],
          total_actuaciones: updatedWorkItem?.total_actuaciones || actuaciones?.length || 0,
        };

        return jsonResponse({
          ok: true,
          work_item_id: existingWorkItem.id,
          created: false,
          updated: true,
          found_in_source: true,
          source_used: syncResult.source_used,
          new_events_count: syncResult.inserted_count || 0,
          milestones_triggered: 0,
          cgp_phase: updatedWorkItem?.cgp_phase,
          process_data: processData,
        });
      } else {
        // Return error from sync-by-work-item
        return jsonResponse({
          ok: false,
          work_item_id: existingWorkItem.id,
          created: false,
          updated: false,
          found_in_source: false,
          source_used: null,
          new_events_count: 0,
          milestones_triggered: 0,
          error: syncResult.errors?.[0] || syncResult.message || 'Sync failed',
          code: syncResult.code,
        });
      }
    }

    // ============= LOOKUP OR CREATE NEW WORK_ITEM =============
    
    // For LOOKUP mode or new work items, call CPNU adapter for preview data
    const cpnuStartTime = Date.now();
    const attempts: AttemptLog[] = [];
    let processData: ProcessData = {};
    let foundInSource = false;

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
      
      if (cpnuResult.ok && cpnuResult.proceso) {
        const proceso = cpnuResult.proceso;
        
        // Extract parties from sujetos_procesales
        let demandantes = '';
        let demandados = '';
        
        if (proceso.sujetos_procesales?.length > 0) {
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

        const actuaciones = (proceso.actuaciones || []).map((act: Record<string, unknown>) => ({
          fecha: act.fecha_actuacion || act.fecha || '',
          actuacion: act.actuacion || '',
          anotacion: act.anotacion || '',
        }));

        processData = {
          despacho: proceso.despacho,
          ciudad: proceso.ciudad,
          departamento: proceso.departamento,
          demandante: demandantes || proceso.demandante,
          demandado: demandados || proceso.demandado,
          tipo_proceso: proceso.tipo,
          clase_proceso: proceso.clase,
          fecha_radicacion: proceso.fecha_radicacion,
          sujetos_procesales: proceso.sujetos_procesales,
          actuaciones,
          total_actuaciones: actuaciones.length,
        };
        
        foundInSource = true;
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

    // Classify FILING vs PROCESS
    const { hasAutoAdmisorio, reason: classificationReason } = detectAutoAdmisorio(
      processData.actuaciones || []
    );
    const cgpPhase = hasAutoAdmisorio ? 'PROCESS' : 'FILING';

    // ============= LOOKUP MODE: Return preview only =============
    
    if (mode === 'LOOKUP') {
      const response: SyncResponse = {
        ok: true,
        work_item_id: existingWorkItem?.id,
        created: false,
        updated: false,
        found_in_source: foundInSource,
        source_used: foundInSource ? 'CPNU' : null,
        new_events_count: processData.total_actuaciones || 0,
        milestones_triggered: 0,
        cgp_phase: cgpPhase,
        classification_reason: classificationReason,
        process_data: processData,
        attempts,
      };
      
      console.log(`[sync-by-radicado] LOOKUP completed in ${Date.now() - startTime}ms`);
      return jsonResponse(response);
    }

    // ============= CREATE NEW WORK_ITEM =============
    
    if (!createIfMissing && !foundInSource) {
      return jsonResponse({
        ok: false,
        created: false,
        updated: false,
        found_in_source: false,
        source_used: null,
        new_events_count: 0,
        milestones_triggered: 0,
        error: 'No se encontró el proceso y create_if_missing está desactivado',
        code: 'NOT_FOUND',
        attempts,
      });
    }

    // Determine stage based on classification
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

    // Create the work item
    const { data: newWorkItem, error: insertError } = await supabase
      .from('work_items')
      .insert({
        owner_id: userId,
        organization_id: organizationId,
        radicado,
        radicado_verified: foundInSource,
        workflow_type: workflowType,
        stage,
        cgp_phase: workflowType === 'CGP' ? cgpPhase : null,
        cgp_phase_source: 'AUTO',
        status: 'ACTIVE',
        source: foundInSource ? 'SCRAPE_API' : 'MANUAL',
        source_reference: `sync-by-radicado-${Date.now()}`,
        authority_name: processData.despacho || null,
        authority_city: processData.ciudad || null,
        authority_department: processData.departamento || null,
        demandantes: processData.demandante || null,
        demandados: processData.demandado || null,
        filing_date: parseColombianDate(processData.fecha_radicacion),
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

    const workItemId = newWorkItem?.id;
    console.log(`[sync-by-radicado] Created work_item: ${workItemId}`);

    // If we have actuaciones from preview, delegate to sync-by-work-item for full sync
    if (workItemId && foundInSource) {
      const syncResponse = await fetch(
        `${supabaseUrl}/functions/v1/sync-by-work-item`,
        {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            work_item_id: workItemId,
          }),
        }
      );

      const syncResult = await syncResponse.json();
      console.log(`[sync-by-radicado] sync-by-work-item result:`, { 
        ok: syncResult.ok, 
        inserted: syncResult.inserted_count,
        source: syncResult.source_used,
      });
    }

    const response: SyncResponse = {
      ok: true,
      work_item_id: workItemId,
      created: true,
      updated: false,
      found_in_source: foundInSource,
      source_used: foundInSource ? 'CPNU' : null,
      new_events_count: processData.total_actuaciones || 0,
      milestones_triggered: 0,
      cgp_phase: cgpPhase,
      classification_reason: classificationReason,
      process_data: processData,
      attempts,
    };

    console.log(`[sync-by-radicado] Completed in ${Date.now() - startTime}ms`);
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
