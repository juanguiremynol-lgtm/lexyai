/**
 * sync-by-work-item Edge Function
 * 
 * PRODUCTION-GRADE sync for existing work items using external judicial APIs.
 * 
 * Features:
 * - Multi-tenant safe: validates user is member of work_item's organization
 * - All external URLs from env vars: EXTERNAL_RAMA_API_URL, TUTELAS_BASE_URL, CPNU adapter
 * - Adapter resolution via org_integration_settings
 * - Idempotent: uses hash_fingerprint to prevent duplicates
 * 
 * Input: { work_item_id: string }
 * Output: { ok, inserted_count, skipped_count, latest_event_date, warnings, errors }
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
  source_used: string | null;
  warnings: string[];
  errors: string[];
  adapter_used?: string;
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

interface OrgIntegrationSettings {
  adapter_priority_order: string[];
  feature_flags: {
    enableExternalApi?: boolean;
    enableLegacyCpnu?: boolean;
    enableTutelasApi?: boolean;
    enableSamaiApi?: boolean;
    enablePublicacionesApi?: boolean;
  };
  workflow_overrides?: Record<string, string>;
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
  source: string;
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

// ============= ADAPTER RESOLUTION =============

// deno-lint-ignore no-explicit-any
async function getOrgSettings(
  supabase: any,
  organizationId: string
): Promise<OrgIntegrationSettings | null> {
  const { data, error } = await supabase
    .from('org_integration_settings')
    .select('adapter_priority_order, feature_flags, workflow_overrides')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error || !data) {
    console.log(`[sync-by-work-item] No org settings for ${organizationId}, using defaults`);
    return null;
  }

  // deno-lint-ignore no-explicit-any
  const row = data as any;
  return {
    adapter_priority_order: row.adapter_priority_order || ['external-rama-judicial-api', 'cpnu', 'noop'],
    feature_flags: (row.feature_flags as OrgIntegrationSettings['feature_flags']) || {},
    workflow_overrides: row.workflow_overrides as Record<string, string> | undefined,
  };
}

function resolveAdapters(
  workflowType: string,
  settings: OrgIntegrationSettings | null
): string[] {
  // Build list of adapters to try in priority order
  const adapters: string[] = [];
  
  // Check for workflow-specific override
  if (settings?.workflow_overrides?.[workflowType]) {
    adapters.push(settings.workflow_overrides[workflowType]);
    return adapters;
  }

  const flags = settings?.feature_flags || {};
  
  // For TUTELA, prefer tutelas API
  if (workflowType === 'TUTELA') {
    if (flags.enableTutelasApi !== false) {
      adapters.push('tutelas-api');
    }
  }

  // Add adapters based on priority order and flags
  const priority = settings?.adapter_priority_order || ['external-rama-judicial-api', 'cpnu'];
  
  for (const adapterId of priority) {
    if (adapterId === 'external-rama-judicial-api' && flags.enableExternalApi !== false) {
      adapters.push(adapterId);
    }
    if (adapterId === 'cpnu' && flags.enableLegacyCpnu !== false) {
      adapters.push(adapterId);
    }
    if (adapterId === 'samai-api' && flags.enableSamaiApi) {
      adapters.push(adapterId);
    }
    if (adapterId === 'publicaciones-api' && flags.enablePublicacionesApi) {
      adapters.push(adapterId);
    }
  }

  return adapters.length > 0 ? adapters : ['noop'];
}

// ============= EXTERNAL API FETCHERS (ENV VAR BASED) =============

async function fetchFromCpnu(
  supabaseUrl: string,
  authHeader: string,
  radicado: string
): Promise<FetchResult> {
  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/adapter-cpnu`,
      {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ radicado, action: 'search' }),
      }
    );

    const result = await response.json();
    
    if (result.ok && result.proceso?.actuaciones) {
      return {
        ok: true,
        actuaciones: result.proceso.actuaciones.map((act: Record<string, unknown>) => ({
          fecha: act.fecha_actuacion || act.fecha || '',
          actuacion: act.actuacion || '',
          anotacion: act.anotacion || '',
          fecha_inicia_termino: act.fecha_inicia_termino,
          fecha_finaliza_termino: act.fecha_finaliza_termino,
        })),
        caseMetadata: {
          despacho: result.proceso.despacho,
          demandante: result.proceso.demandante,
          demandado: result.proceso.demandado,
          tipo_proceso: result.proceso.tipo,
        },
        source: 'cpnu',
      };
    }

    return { ok: false, actuaciones: [], error: result.error || 'No results', source: 'cpnu' };
  } catch (err) {
    return { ok: false, actuaciones: [], error: err instanceof Error ? err.message : 'CPNU fetch failed', source: 'cpnu' };
  }
}

async function fetchFromExternalApi(
  radicado: string
): Promise<FetchResult> {
  // Get base URL from env var - NEVER hardcoded
  const baseUrl = Deno.env.get('EXTERNAL_RAMA_API_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] EXTERNAL_RAMA_API_URL not configured');
    return { ok: false, actuaciones: [], error: 'External API not configured (missing EXTERNAL_RAMA_API_URL)', source: 'external-rama-judicial-api' };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const response = await fetch(
      `${baseUrl}/buscar?numero_radicacion=${radicado}`,
      { method: 'GET', headers }
    );

    if (!response.ok) {
      return { ok: false, actuaciones: [], error: `HTTP ${response.status}`, source: 'external-rama-judicial-api' };
    }

    const data = await response.json();

    // Handle job-based polling
    if (data.jobId) {
      let pollAttempts = 0;
      const maxPolls = 30;
      
      while (pollAttempts < maxPolls) {
        pollAttempts++;
        await new Promise(r => setTimeout(r, 2000));
        
        const pollResponse = await fetch(
          `${baseUrl}/resultado/${data.jobId}`,
          { method: 'GET', headers: { 'Accept': 'application/json' } }
        );
        
        const pollData = await pollResponse.json();
        
        if (pollData.status === 'completed' && pollData.proceso?.actuaciones) {
          return {
            ok: true,
            actuaciones: pollData.proceso.actuaciones.map((act: Record<string, unknown>) => ({
              fecha: act['Fecha de Actuación'] || act.fecha || '',
              actuacion: act['Actuación'] || act.actuacion || '',
              anotacion: act['Anotación'] || act.anotacion || '',
            })),
            caseMetadata: {
              despacho: pollData.proceso['Despacho'] || pollData.proceso.despacho,
              demandante: pollData.proceso['Demandante'] || pollData.proceso.demandante,
              demandado: pollData.proceso['Demandado'] || pollData.proceso.demandado,
              tipo_proceso: pollData.proceso['Tipo de Proceso'],
            },
            source: 'external-rama-judicial-api',
          };
        } else if (pollData.status === 'failed' || pollData.estado === 'NO_ENCONTRADO') {
          return { ok: false, actuaciones: [], error: 'Not found', source: 'external-rama-judicial-api' };
        }
      }
      
      return { ok: false, actuaciones: [], error: 'Polling timeout', source: 'external-rama-judicial-api' };
    }

    // Direct response
    if (data.proceso) {
      const actuaciones = data.actuaciones || data.proceso.actuaciones || [];
      return {
        ok: true,
        actuaciones: actuaciones.map((act: Record<string, unknown>) => ({
          fecha: act['Fecha de Actuación'] || act.fecha || '',
          actuacion: act['Actuación'] || act.actuacion || '',
          anotacion: act['Anotación'] || act.anotacion || '',
        })),
        caseMetadata: {
          despacho: data.proceso['Despacho'] || data.proceso.despacho,
          demandante: data.proceso['Demandante'] || data.proceso.demandante,
          demandado: data.proceso['Demandado'] || data.proceso.demandado,
          tipo_proceso: data.proceso['Tipo de Proceso'],
        },
        source: 'external-rama-judicial-api',
      };
    }

    if (data.estado === 'NO_ENCONTRADO') {
      return { ok: false, actuaciones: [], error: 'Not found', source: 'external-rama-judicial-api' };
    }

    return { ok: false, actuaciones: [], error: 'No actuaciones in response', source: 'external-rama-judicial-api' };
  } catch (err) {
    return { ok: false, actuaciones: [], error: err instanceof Error ? err.message : 'External API failed', source: 'external-rama-judicial-api' };
  }
}

async function fetchFromTutelasApi(
  tutelaCode: string,
  _radicado: string | null
): Promise<FetchResult> {
  const baseUrl = Deno.env.get('TUTELAS_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] TUTELAS_BASE_URL not configured');
    return { ok: false, actuaciones: [], error: 'Tutelas API not configured (missing TUTELAS_BASE_URL)', source: 'tutelas-api' };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const response = await fetch(
      `${baseUrl}/expediente/${tutelaCode}`,
      { method: 'GET', headers }
    );

    if (!response.ok) {
      return { ok: false, actuaciones: [], error: `HTTP ${response.status}`, source: 'tutelas-api' };
    }

    const data = await response.json();

    if (data.actuaciones) {
      return {
        ok: true,
        actuaciones: data.actuaciones.map((act: Record<string, unknown>) => ({
          fecha: act.fecha || '',
          actuacion: act.actuacion || act.descripcion || '',
          anotacion: act.anotacion || '',
        })),
        expedienteUrl: data.expediente_url,
        source: 'tutelas-api',
      };
    }

    return { ok: false, actuaciones: [], error: 'No actuaciones', source: 'tutelas-api' };
  } catch (err) {
    return { ok: false, actuaciones: [], error: err instanceof Error ? err.message : 'Tutelas API failed', source: 'tutelas-api' };
  }
}

async function fetchFromSamaiApi(
  radicado: string
): Promise<FetchResult> {
  const baseUrl = Deno.env.get('SAMAI_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] SAMAI_BASE_URL not configured');
    return { ok: false, actuaciones: [], error: 'SAMAI API not configured', source: 'samai-api' };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const response = await fetch(
      `${baseUrl}/proceso/${radicado}`,
      { method: 'GET', headers }
    );

    if (!response.ok) {
      return { ok: false, actuaciones: [], error: `HTTP ${response.status}`, source: 'samai-api' };
    }

    const data = await response.json();

    if (data.actuaciones) {
      return {
        ok: true,
        actuaciones: data.actuaciones.map((act: Record<string, unknown>) => ({
          fecha: act.fecha || '',
          actuacion: act.actuacion || '',
          anotacion: act.anotacion || '',
        })),
        source: 'samai-api',
      };
    }

    return { ok: false, actuaciones: [], error: 'No actuaciones', source: 'samai-api' };
  } catch (err) {
    return { ok: false, actuaciones: [], error: err instanceof Error ? err.message : 'SAMAI API failed', source: 'samai-api' };
  }
}

async function fetchFromPublicacionesApi(
  radicado: string
): Promise<FetchResult> {
  const baseUrl = Deno.env.get('PUBLICACIONES_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] PUBLICACIONES_BASE_URL not configured');
    return { ok: false, actuaciones: [], error: 'Publicaciones API not configured', source: 'publicaciones-api' };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const response = await fetch(
      `${baseUrl}/estados/${radicado}`,
      { method: 'GET', headers }
    );

    if (!response.ok) {
      return { ok: false, actuaciones: [], error: `HTTP ${response.status}`, source: 'publicaciones-api' };
    }

    const data = await response.json();

    if (data.estados) {
      return {
        ok: true,
        actuaciones: data.estados.map((est: Record<string, unknown>) => ({
          fecha: est.fecha_publicacion || est.fecha || '',
          actuacion: est.descripcion || est.estado || '',
          anotacion: est.detalle || '',
        })),
        source: 'publicaciones-api',
      };
    }

    return { ok: false, actuaciones: [], error: 'No estados', source: 'publicaciones-api' };
  } catch (err) {
    return { ok: false, actuaciones: [], error: err instanceof Error ? err.message : 'Publicaciones API failed', source: 'publicaciones-api' };
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
      source_used: null,
      warnings: [],
      errors: [],
    };

    // Resolve identifier based on workflow type
    let identifier: string | null = null;
    let identifierType: 'radicado' | 'tutela_code' = 'radicado';

    if (workItem.workflow_type === 'TUTELA') {
      if (workItem.tutela_code && isValidTutelaCode(workItem.tutela_code)) {
        identifier = workItem.tutela_code;
        identifierType = 'tutela_code';
      } else if (workItem.radicado && isValidRadicado(workItem.radicado)) {
        identifier = workItem.radicado.replace(/\D/g, '');
        identifierType = 'radicado';
        result.warnings.push('Using radicado as fallback - consider adding tutela_code (T + digits)');
      }
    } else {
      if (workItem.radicado && isValidRadicado(workItem.radicado)) {
        identifier = workItem.radicado.replace(/\D/g, '');
      }
    }

    if (!identifier) {
      const missingField = workItem.workflow_type === 'TUTELA' 
        ? 'tutela_code (T + digits) or radicado (23 digits)'
        : 'radicado (23 digits)';
      return errorResponse(
        'MISSING_IDENTIFIER',
        `Work item is missing required identifier: ${missingField}. Please edit the work item to add it.`,
        400
      );
    }

    console.log(`[sync-by-work-item] Identifier: ${identifier} (type: ${identifierType}), workflow: ${workItem.workflow_type}`);

    // Get org settings and resolve adapters to try
    const orgSettings = await getOrgSettings(supabase, workItem.organization_id);
    const adaptersToTry = resolveAdapters(workItem.workflow_type, orgSettings);
    
    console.log(`[sync-by-work-item] Adapters to try: ${adaptersToTry.join(', ')}`);

    if (adaptersToTry.length === 0 || (adaptersToTry.length === 1 && adaptersToTry[0] === 'noop')) {
      console.log(`[sync-by-work-item] No adapters enabled for org ${workItem.organization_id}`);
      result.ok = true;
      result.warnings.push('No external API adapters are enabled for this organization. Data sync skipped.');
      return jsonResponse(result);
    }

    // Try adapters in priority order until one succeeds
    let fetchResult: FetchResult | null = null;

    for (const adapterId of adaptersToTry) {
      if (adapterId === 'noop') continue;

      console.log(`[sync-by-work-item] Trying adapter: ${adapterId}`);

      if (adapterId === 'tutelas-api' && identifierType === 'tutela_code') {
        fetchResult = await fetchFromTutelasApi(identifier, workItem.radicado);
      } else if (adapterId === 'external-rama-judicial-api') {
        fetchResult = await fetchFromExternalApi(identifier);
      } else if (adapterId === 'cpnu') {
        fetchResult = await fetchFromCpnu(supabaseUrl, authHeader, identifier);
      } else if (adapterId === 'samai-api') {
        fetchResult = await fetchFromSamaiApi(identifier);
      } else if (adapterId === 'publicaciones-api') {
        fetchResult = await fetchFromPublicacionesApi(identifier);
      }

      if (fetchResult?.ok) {
        console.log(`[sync-by-work-item] Adapter ${adapterId} succeeded with ${fetchResult.actuaciones.length} actuaciones`);
        break;
      } else {
        console.log(`[sync-by-work-item] Adapter ${adapterId} failed: ${fetchResult?.error}`);
        result.warnings.push(`${adapterId}: ${fetchResult?.error || 'No data'}`);
        fetchResult = null;
      }
    }

    if (!fetchResult?.ok) {
      result.errors.push('All configured adapters failed to fetch data');
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

    result.source_used = fetchResult.source;
    result.adapter_used = fetchResult.source;

    // Process actuaciones
    const actuaciones = fetchResult.actuaciones;
    console.log(`[sync-by-work-item] Fetched ${actuaciones.length} actuaciones from ${fetchResult.source}`);

    if (actuaciones.length === 0) {
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

    // Upsert actuaciones with deduplication
    let latestDate: string | null = null;

    for (const act of actuaciones) {
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
          source: fetchResult.source,
          adapter_name: fetchResult.source,
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

    // Update work item with sync status and metadata
    const updatePayload: Record<string, unknown> = {
      scrape_status: result.errors.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
      last_crawled_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      total_actuaciones: actuaciones.length,
    };

    if (latestDate) {
      updatePayload.last_action_date = latestDate;
    }

    // Update expediente_url if returned by tutelas API and not already set
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
    console.log(`[sync-by-work-item] Completed: inserted=${result.inserted_count}, skipped=${result.skipped_count}, source=${result.source_used}`);

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
