import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncRequest {
  radicado: string;
  force_refresh?: boolean;
  source?: 'CPNU' | 'EXTERNAL_SCRAPER' | 'AUTO';
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
  error?: string;
  classification?: string;
  attempts?: Array<{
    source: string;
    success: boolean;
    latency_ms: number;
    error?: string;
  }>;
}

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

function validateRadicado(radicado: string): { valid: boolean; normalized: string; error?: string } {
  if (!radicado) {
    return { valid: false, normalized: '', error: 'Radicado es requerido' };
  }
  
  // Extract only digits
  const normalized = radicado.replace(/\D/g, '');
  
  if (normalized.length !== 23) {
    return { 
      valid: false, 
      normalized, 
      error: `Radicado debe tener 23 dígitos, tiene ${normalized.length}` 
    };
  }
  
  return { valid: true, normalized };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const attempts: SyncResponse['attempts'] = [];

  try {
    // Environment validation
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('MISSING_ENV', 'Missing Supabase environment variables', 500);
    }

    // Auth validation
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '');
    
    // Verify user
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    
    if (authError || !user) {
      return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
    }

    // Parse request body
    let payload: SyncRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400);
    }

    // Validate radicado
    const validation = validateRadicado(payload.radicado);
    if (!validation.valid) {
      return errorResponse('INVALID_RADICADO', validation.error || 'Invalid radicado', 400);
    }

    const radicado = validation.normalized;
    console.log(`[sync-by-radicado] Starting sync for user ${user.id}: ${radicado}`);

    // Check if work_item already exists
    const { data: existingWorkItem } = await supabase
      .from('work_items')
      .select('id, radicado, last_action_date, monitoring_enabled')
      .eq('owner_id', user.id)
      .eq('radicado', radicado)
      .maybeSingle();

    // Also check monitored_processes for legacy data
    const { data: existingProcess } = await supabase
      .from('monitored_processes')
      .select('id, radicado, last_action_date')
      .eq('owner_id', user.id)
      .eq('radicado', radicado)
      .maybeSingle();

    let workItemId: string | null = existingWorkItem?.id || null;
    let created = false;
    let updated = false;
    let foundInSource = false;
    let sourceUsed: string | null = null;
    let newEventsCount = 0;

    // Determine which source to use
    const sourcePreference = payload.source || 'AUTO';
    
    // Try to fetch data from CPNU adapter
    if (sourcePreference === 'CPNU' || sourcePreference === 'AUTO') {
      const cpnuStartTime = Date.now();
      
      try {
        // Call the adapter-cpnu function
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

        const cpnuData = await cpnuResponse.json();
        
        attempts.push({
          source: 'CPNU',
          success: cpnuData.ok === true,
          latency_ms: Date.now() - cpnuStartTime,
          error: cpnuData.ok ? undefined : cpnuData.error,
        });

        if (cpnuData.ok && cpnuData.results?.length > 0) {
          foundInSource = true;
          sourceUsed = 'CPNU';

          const result = cpnuData.results[0];
          const proceso = cpnuData.proceso;

          // Extract data from CPNU response
          const updateData: Record<string, unknown> = {
            authority_name: result.despacho || proceso?.despacho || null,
            demandantes: result.demandante || null,
            demandados: result.demandado || null,
            radicado_verified: true,
            last_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          // Extract parties from sujetos_procesales if available
          if (proceso?.sujetos_procesales?.length > 0) {
            const demandantes = proceso.sujetos_procesales
              .filter((s: { tipo: string }) => s.tipo?.toLowerCase().includes('demandante') || s.tipo?.toLowerCase().includes('actor'))
              .map((s: { nombre: string }) => s.nombre)
              .join(', ');
            const demandados = proceso.sujetos_procesales
              .filter((s: { tipo: string }) => s.tipo?.toLowerCase().includes('demandado'))
              .map((s: { nombre: string }) => s.nombre)
              .join(', ');
            
            if (demandantes) updateData.demandantes = demandantes;
            if (demandados) updateData.demandados = demandados;
          }

          // Count new events if actuaciones present
          if (cpnuData.events?.length > 0) {
            newEventsCount = cpnuData.events.length;
          }

          if (existingWorkItem) {
            // Update existing work_item
            await supabase
              .from('work_items')
              .update(updateData)
              .eq('id', existingWorkItem.id);
            
            workItemId = existingWorkItem.id;
            updated = true;
          } else {
            // Create new work_item
            const workflowType = payload.workflow_type || 'CGP';
            const stage = payload.stage || 'MONITORING';

            const { data: newWorkItem, error: insertError } = await supabase
              .from('work_items')
              .insert({
                owner_id: user.id,
                radicado,
                radicado_verified: true,
                workflow_type: workflowType,
                stage,
                status: 'ACTIVE',
                source: 'SCRAPE_API',
                source_reference: `sync-by-radicado-${Date.now()}`,
                authority_name: updateData.authority_name,
                demandantes: updateData.demandantes,
                demandados: updateData.demandados,
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

          // Also update monitored_processes if exists
          if (existingProcess) {
            await supabase
              .from('monitored_processes')
              .update({
                ...updateData,
                cpnu_confirmed: true,
                cpnu_confirmed_at: new Date().toISOString(),
              })
              .eq('id', existingProcess.id);
          }
        }
      } catch (cpnuError) {
        attempts.push({
          source: 'CPNU',
          success: false,
          latency_ms: Date.now() - cpnuStartTime,
          error: cpnuError instanceof Error ? cpnuError.message : 'Unknown CPNU error',
        });
        console.error('[sync-by-radicado] CPNU error:', cpnuError);
      }
    }

    // If external scraper is configured and CPNU didn't find anything, try it
    // TODO: Implement external scraper integration when available
    if (!foundInSource && (sourcePreference === 'EXTERNAL_SCRAPER' || sourcePreference === 'AUTO')) {
      // Check if external scraper is configured
      const { data: config } = await supabase
        .from('integrations')
        .select('config')
        .eq('owner_id', user.id)
        .eq('provider', 'external_scraper')
        .maybeSingle();

      if (config?.config?.enabled && config?.config?.base_url) {
        // External scraper is configured but not yet implemented
        attempts.push({
          source: 'EXTERNAL_SCRAPER',
          success: false,
          latency_ms: 0,
          error: 'External scraper integration not yet implemented',
        });
      }
    }

    // If nothing found and no existing item, create a minimal work_item
    if (!workItemId && !existingWorkItem && !existingProcess) {
      const workflowType = payload.workflow_type || 'CGP';
      const stage = payload.stage || 'PENDING_VERIFICATION';

      const { data: newWorkItem, error: insertError } = await supabase
        .from('work_items')
        .insert({
          owner_id: user.id,
          radicado,
          radicado_verified: false,
          workflow_type: workflowType,
          stage,
          status: 'ACTIVE',
          source: 'MANUAL',
          source_reference: `sync-by-radicado-${Date.now()}`,
          client_id: payload.client_id || null,
          is_flagged: false,
          monitoring_enabled: true,
          email_linking_enabled: true,
        })
        .select('id')
        .single();

      if (!insertError && newWorkItem) {
        workItemId = newWorkItem.id;
        created = true;
      }
    }

    const response: SyncResponse = {
      ok: true,
      work_item_id: workItemId || undefined,
      created,
      updated,
      found_in_source: foundInSource,
      source_used: sourceUsed,
      new_events_count: newEventsCount,
      milestones_triggered: 0,
      attempts,
    };

    console.log(`[sync-by-radicado] Completed in ${Date.now() - startTime}ms:`, response);

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
