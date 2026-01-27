/**
 * sync-by-work-item Edge Function
 * 
 * PRODUCTION-GRADE sync for existing work items using external judicial APIs.
 * 
 * Features:
 * - Multi-tenant safe: validates user is member of work_item's organization
 * - CPNU primary + SAMAI fallback for radicado workflows
 * - TUTELAS API for TUTELA workflows (tutela_code-based)
 * - All external URLs from env vars: CPNU_BASE_URL, SAMAI_BASE_URL, TUTELAS_BASE_URL, EXTERNAL_X_API_KEY
 * - Idempotent: uses hash_fingerprint to prevent duplicates
 * 
 * Input: { work_item_id: string }
 * Output: { ok, inserted_count, skipped_count, latest_event_date, provider_used, warnings, errors }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= TYPES =============

interface SyncRequest {
  work_item_id: string;
  force_refresh?: boolean;
}

interface SyncResult {
  ok: boolean;
  work_item_id: string;
  inserted_count: number;
  skipped_count: number;
  latest_event_date: string | null;
  provider_used: string | null;
  warnings: string[];
  errors: string[];
}

interface WorkItem {
  id: string;
  owner_id: string;
  organization_id: string;
  workflow_type: string;
  radicado: string | null;
  tutela_code: string | null;
  scrape_status: string | null;
  last_crawled_at: string | null;
  expediente_url: string | null;
}

interface ActuacionRaw {
  fecha: string;
  actuacion: string;
  anotacion?: string;
  fecha_inicia_termino?: string;
  fecha_finaliza_termino?: string;
}

interface FetchResult {
  ok: boolean;
  actuaciones: ActuacionRaw[];
  expedienteUrl?: string;
  caseMetadata?: {
    despacho?: string;
    demandante?: string;
    demandado?: string;
    tipo_proceso?: string;
  };
  error?: string;
  provider: string;
  isEmpty?: boolean; // Indicates empty result (for fallback logic)
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

function isValidTutelaCode(code: string): boolean {
  return /^T\d{6,10}$/i.test(code);
}

function isValidRadicado(radicado: string): boolean {
  const normalized = radicado.replace(/\D/g, '');
  return normalized.length === 23;
}

function normalizeRadicado(radicado: string): string {
  return radicado.replace(/\D/g, '');
}

function generateFingerprint(
  workItemId: string,
  date: string,
  text: string
): string {
  const normalized = `${workItemId}|${date}|${text.toLowerCase().trim().slice(0, 200)}`;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `wi_${workItemId.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
}

function parseColombianDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  
  // If already ISO format, return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }
  
  const patterns = [
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    /^(\d{2})-(\d{2})-(\d{4})$/,
  ];

  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
  }
  
  return null;
}

// ============= PROVIDER: CPNU (Primary for CGP/LABORAL/CPACA/PENAL_906) =============

async function fetchFromCpnu(radicado: string): Promise<FetchResult> {
  const baseUrl = Deno.env.get('CPNU_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] CPNU_BASE_URL not configured');
    return { 
      ok: false, 
      actuaciones: [], 
      error: 'CPNU API not configured (missing CPNU_BASE_URL). Contact administrator.', 
      provider: 'cpnu' 
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    console.log(`[sync-by-work-item] Calling CPNU: ${baseUrl}/proceso/${radicado}`);
    
    const response = await fetch(`${baseUrl}/proceso/${radicado}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[sync-by-work-item] CPNU: Process not found for ${radicado}`);
        return { 
          ok: false, 
          actuaciones: [], 
          error: 'Not found', 
          provider: 'cpnu',
          isEmpty: true,
        };
      }
      const errorText = await response.text();
      console.log(`[sync-by-work-item] CPNU HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      return { 
        ok: false, 
        actuaciones: [], 
        error: `HTTP ${response.status}`, 
        provider: 'cpnu' 
      };
    }

    const data = await response.json();
    
    // Check for "not found" indicators
    if (data.expediente_encontrado === false || data.found === false) {
      console.log(`[sync-by-work-item] CPNU: expediente_encontrado=false for ${radicado}`);
      return { 
        ok: false, 
        actuaciones: [], 
        error: 'Process not found in CPNU', 
        provider: 'cpnu',
        isEmpty: true,
      };
    }

    // Extract actuaciones
    const actuaciones = data.actuaciones || data.proceso?.actuaciones || [];
    
    if (actuaciones.length === 0) {
      console.log(`[sync-by-work-item] CPNU: No actuaciones for ${radicado}`);
      return { 
        ok: false, 
        actuaciones: [], 
        error: 'No actuaciones found', 
        provider: 'cpnu',
        isEmpty: true,
      };
    }

    console.log(`[sync-by-work-item] CPNU: Found ${actuaciones.length} actuaciones for ${radicado}`);
    
    return {
      ok: true,
      actuaciones: actuaciones.map((act: Record<string, unknown>) => ({
        fecha: String(act.fecha_actuacion || act.fecha || ''),
        actuacion: String(act.actuacion || ''),
        anotacion: String(act.anotacion || ''),
        fecha_inicia_termino: act.fecha_inicia_termino ? String(act.fecha_inicia_termino) : undefined,
        fecha_finaliza_termino: act.fecha_finaliza_termino ? String(act.fecha_finaliza_termino) : undefined,
      })),
      caseMetadata: {
        despacho: data.despacho || data.proceso?.despacho,
        demandante: data.demandante || data.proceso?.demandante,
        demandado: data.demandado || data.proceso?.demandado,
        tipo_proceso: data.tipo_proceso || data.proceso?.tipo,
      },
      expedienteUrl: data.expediente_url,
      provider: 'cpnu',
    };
  } catch (err) {
    console.error('[sync-by-work-item] CPNU fetch error:', err);
    return { 
      ok: false, 
      actuaciones: [], 
      error: err instanceof Error ? err.message : 'CPNU fetch failed', 
      provider: 'cpnu' 
    };
  }
}

// ============= PROVIDER: SAMAI (Fallback for CGP/LABORAL/CPACA/PENAL_906) =============

async function fetchFromSamai(radicado: string): Promise<FetchResult> {
  const baseUrl = Deno.env.get('SAMAI_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] SAMAI_BASE_URL not configured');
    return { 
      ok: false, 
      actuaciones: [], 
      error: 'SAMAI API not configured (missing SAMAI_BASE_URL). Fallback unavailable.', 
      provider: 'samai' 
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    console.log(`[sync-by-work-item] Calling SAMAI fallback: ${baseUrl}/proceso/${radicado}`);
    
    const response = await fetch(`${baseUrl}/proceso/${radicado}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { 
          ok: false, 
          actuaciones: [], 
          error: 'Not found in SAMAI', 
          provider: 'samai',
          isEmpty: true,
        };
      }
      return { 
        ok: false, 
        actuaciones: [], 
        error: `HTTP ${response.status}`, 
        provider: 'samai' 
      };
    }

    const data = await response.json();
    
    const actuaciones = data.actuaciones || [];
    
    if (actuaciones.length === 0) {
      return { 
        ok: false, 
        actuaciones: [], 
        error: 'No actuaciones in SAMAI', 
        provider: 'samai',
        isEmpty: true,
      };
    }

    console.log(`[sync-by-work-item] SAMAI: Found ${actuaciones.length} actuaciones for ${radicado}`);
    
    return {
      ok: true,
      actuaciones: actuaciones.map((act: Record<string, unknown>) => ({
        fecha: String(act.fecha || ''),
        actuacion: String(act.actuacion || ''),
        anotacion: String(act.anotacion || ''),
      })),
      caseMetadata: {
        despacho: data.despacho,
        demandante: data.demandante,
        demandado: data.demandado,
        tipo_proceso: data.tipo_proceso,
      },
      provider: 'samai',
    };
  } catch (err) {
    console.error('[sync-by-work-item] SAMAI fetch error:', err);
    return { 
      ok: false, 
      actuaciones: [], 
      error: err instanceof Error ? err.message : 'SAMAI fetch failed', 
      provider: 'samai' 
    };
  }
}

// ============= PROVIDER: TUTELAS API =============

async function fetchFromTutelasApi(tutelaCode: string): Promise<FetchResult> {
  const baseUrl = Deno.env.get('TUTELAS_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] TUTELAS_BASE_URL not configured');
    return { 
      ok: false, 
      actuaciones: [], 
      error: 'TUTELAS API not configured (missing TUTELAS_BASE_URL). Contact administrator.', 
      provider: 'tutelas-api' 
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    console.log(`[sync-by-work-item] Calling TUTELAS: ${baseUrl}/expediente/${tutelaCode}`);
    
    const response = await fetch(`${baseUrl}/expediente/${tutelaCode}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { 
          ok: false, 
          actuaciones: [], 
          error: 'Tutela not found', 
          provider: 'tutelas-api',
          isEmpty: true,
        };
      }
      return { 
        ok: false, 
        actuaciones: [], 
        error: `HTTP ${response.status}`, 
        provider: 'tutelas-api' 
      };
    }

    const data = await response.json();
    
    const actuaciones = data.actuaciones || [];
    
    console.log(`[sync-by-work-item] TUTELAS: Found ${actuaciones.length} actuaciones for ${tutelaCode}`);
    
    return {
      ok: actuaciones.length > 0 || !!data.expediente_url,
      actuaciones: actuaciones.map((act: Record<string, unknown>) => ({
        fecha: String(act.fecha || ''),
        actuacion: String(act.actuacion || act.descripcion || ''),
        anotacion: String(act.anotacion || ''),
      })),
      expedienteUrl: data.expediente_url,
      caseMetadata: {
        despacho: data.despacho,
        demandante: data.accionante,
        demandado: data.accionado,
        tipo_proceso: 'TUTELA',
      },
      provider: 'tutelas-api',
    };
  } catch (err) {
    console.error('[sync-by-work-item] TUTELAS fetch error:', err);
    return { 
      ok: false, 
      actuaciones: [], 
      error: err instanceof Error ? err.message : 'TUTELAS API failed', 
      provider: 'tutelas-api' 
    };
  }
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('MISSING_ENV', 'Missing Supabase environment variables', 500);
    }

    // Auth check
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

    // Parse request
    let payload: SyncRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400);
    }

    const { work_item_id } = payload;
    
    if (!work_item_id) {
      return errorResponse('MISSING_WORK_ITEM_ID', 'work_item_id is required', 400);
    }

    console.log(`[sync-by-work-item] Starting sync for work_item_id=${work_item_id}, user=${userId}`);

    // Fetch work item
    const { data: workItem, error: workItemError } = await supabase
      .from('work_items')
      .select('id, owner_id, organization_id, workflow_type, radicado, tutela_code, scrape_status, last_crawled_at, expediente_url')
      .eq('id', work_item_id)
      .maybeSingle();

    if (workItemError || !workItem) {
      console.log(`[sync-by-work-item] Work item not found: ${work_item_id}`);
      return errorResponse('WORK_ITEM_NOT_FOUND', 'Work item not found or access denied', 404);
    }

    // ============= MULTI-TENANT SECURITY: Verify user is member of org =============
    const { data: membership, error: membershipError } = await supabase
      .from('organization_memberships')
      .select('id, role')
      .eq('organization_id', workItem.organization_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipError || !membership) {
      console.log(`[sync-by-work-item] ACCESS DENIED: User ${userId} is not member of org ${workItem.organization_id}`);
      return errorResponse(
        'ACCESS_DENIED', 
        'You do not have permission to sync this work item. You must be a member of the organization.', 
        403
      );
    }

    console.log(`[sync-by-work-item] Access verified: user ${userId} has role ${membership.role} in org ${workItem.organization_id}`);

    const result: SyncResult = {
      ok: false,
      work_item_id,
      inserted_count: 0,
      skipped_count: 0,
      latest_event_date: null,
      provider_used: null,
      warnings: [],
      errors: [],
    };

    // ============= RESOLVE IDENTIFIER BASED ON WORKFLOW =============
    let fetchResult: FetchResult | null = null;

    if (workItem.workflow_type === 'TUTELA') {
      // TUTELA workflow: require tutela_code
      if (!workItem.tutela_code || !isValidTutelaCode(workItem.tutela_code)) {
        return errorResponse(
          'MISSING_TUTELA_CODE',
          'TUTELA workflow requires a valid tutela_code (format: T + 6-10 digits, e.g., T11728622). Please edit the work item to add it.',
          400
        );
      }
      
      console.log(`[sync-by-work-item] TUTELA workflow: using tutela_code=${workItem.tutela_code}`);
      fetchResult = await fetchFromTutelasApi(workItem.tutela_code);
      
    } else {
      // CGP/LABORAL/CPACA/PENAL_906: require radicado (23 digits)
      if (!workItem.radicado || !isValidRadicado(workItem.radicado)) {
        return errorResponse(
          'MISSING_RADICADO',
          'This workflow requires a valid radicado (23 digits). Please edit the work item to add it.',
          400
        );
      }
      
      const normalizedRadicado = normalizeRadicado(workItem.radicado);
      console.log(`[sync-by-work-item] Radicado workflow: using radicado=${normalizedRadicado}`);
      
      // CPNU primary
      fetchResult = await fetchFromCpnu(normalizedRadicado);
      
      // SAMAI fallback: only if CPNU returns not found, empty, or recoverable error
      if (!fetchResult.ok && (fetchResult.isEmpty || fetchResult.error?.includes('timeout') || fetchResult.error?.includes('5'))) {
        console.log(`[sync-by-work-item] CPNU failed/empty, trying SAMAI fallback`);
        result.warnings.push(`CPNU: ${fetchResult.error}`);
        
        const samaiResult = await fetchFromSamai(normalizedRadicado);
        
        if (samaiResult.ok) {
          fetchResult = samaiResult;
        } else {
          // Both failed
          result.warnings.push(`SAMAI fallback: ${samaiResult.error}`);
        }
      }
    }

    // Handle fetch failure
    if (!fetchResult || !fetchResult.ok) {
      result.errors.push(fetchResult?.error || 'All providers failed to fetch data');
      
      // Update scrape status
      await supabase
        .from('work_items')
        .update({
          scrape_status: 'FAILED',
          last_checked_at: new Date().toISOString(),
        })
        .eq('id', work_item_id);
      
      return jsonResponse(result);
    }

    result.provider_used = fetchResult.provider;
    console.log(`[sync-by-work-item] Provider ${fetchResult.provider} returned ${fetchResult.actuaciones.length} actuaciones`);

    // Handle empty actuaciones (success but no data)
    if (fetchResult.actuaciones.length === 0) {
      result.ok = true;
      result.warnings.push('No actuaciones found in external source');
      
      await supabase
        .from('work_items')
        .update({
          scrape_status: 'SUCCESS',
          last_crawled_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString(),
        })
        .eq('id', work_item_id);
      
      return jsonResponse(result);
    }

    // ============= INGEST ACTUACIONES WITH DEDUPLICATION =============
    let latestDate: string | null = null;

    for (const act of fetchResult.actuaciones) {
      const actDate = parseColombianDate(act.fecha);
      const fingerprint = generateFingerprint(work_item_id, act.fecha, act.actuacion);

      // Check for existing record using fingerprint
      const { data: existing } = await supabase
        .from('actuaciones')
        .select('id')
        .eq('work_item_id', work_item_id)
        .eq('hash_fingerprint', fingerprint)
        .maybeSingle();

      if (existing) {
        result.skipped_count++;
        continue;
      }

      // Insert new actuacion
      const { error: insertError } = await supabase
        .from('actuaciones')
        .insert({
          owner_id: workItem.owner_id,
          organization_id: workItem.organization_id,
          work_item_id,
          raw_text: act.actuacion,
          normalized_text: `${act.actuacion}${act.anotacion ? ' - ' + act.anotacion : ''}`,
          act_date: actDate,
          act_date_raw: act.fecha,
          source: fetchResult.provider,
          adapter_name: fetchResult.provider,
          hash_fingerprint: fingerprint,
        });

      if (insertError) {
        // Check if it's a duplicate error (can happen in race conditions)
        if (insertError.message?.includes('duplicate') || insertError.code === '23505') {
          result.skipped_count++;
        } else {
          console.error(`[sync-by-work-item] Insert error:`, insertError);
          result.errors.push(`Failed to insert actuacion: ${insertError.message}`);
        }
      } else {
        result.inserted_count++;
        if (actDate && (!latestDate || actDate > latestDate)) {
          latestDate = actDate;
        }
      }
    }

    result.latest_event_date = latestDate;

    // ============= UPDATE WORK ITEM METADATA =============
    const updatePayload: Record<string, unknown> = {
      scrape_status: result.errors.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
      last_crawled_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      total_actuaciones: fetchResult.actuaciones.length,
    };

    if (latestDate) {
      updatePayload.last_action_date = latestDate;
    }

    // Update expediente_url if returned and not already set
    if (fetchResult.expedienteUrl && !workItem.expediente_url) {
      updatePayload.expediente_url = fetchResult.expedienteUrl;
    }

    // Update case metadata if available
    if (fetchResult.caseMetadata) {
      if (fetchResult.caseMetadata.despacho) {
        updatePayload.authority_name = fetchResult.caseMetadata.despacho;
      }
      if (fetchResult.caseMetadata.demandante) {
        updatePayload.demandantes = fetchResult.caseMetadata.demandante;
      }
      if (fetchResult.caseMetadata.demandado) {
        updatePayload.demandados = fetchResult.caseMetadata.demandado;
      }
    }

    await supabase
      .from('work_items')
      .update(updatePayload)
      .eq('id', work_item_id);

    result.ok = true;
    console.log(`[sync-by-work-item] Completed: inserted=${result.inserted_count}, skipped=${result.skipped_count}, provider=${result.provider_used}`);

    return jsonResponse(result);

  } catch (err) {
    console.error('[sync-by-work-item] Unhandled error:', err);
    return errorResponse(
      'INTERNAL_ERROR',
      err instanceof Error ? err.message : 'An unexpected error occurred',
      500
    );
  }
});
