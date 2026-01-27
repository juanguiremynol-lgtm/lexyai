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
 * - **NEW**: Detailed trace logging via sync_traces table for debugging
 * 
 * Input: { work_item_id: string }
 * Headers: X-Trace-Id (optional, for debugging)
 * Output: { ok, inserted_count, skipped_count, latest_event_date, provider_used, warnings, errors, trace_id }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-trace-id',
};

// ============= TYPES =============

interface SyncRequest {
  work_item_id: string;
  force_refresh?: boolean;
}

interface ProviderAttempt {
  provider: string;
  status: 'success' | 'not_found' | 'empty' | 'error' | 'timeout' | 'skipped';
  latencyMs: number;
  message?: string;
  actuacionesCount?: number;
}

interface SyncResult {
  ok: boolean;
  work_item_id: string;
  workflow_type: string;
  inserted_count: number;
  skipped_count: number;
  latest_event_date: string | null;
  provider_used: string | null;
  provider_attempts: ProviderAttempt[];
  provider_order_reason: string;
  warnings: string[];
  errors: string[];
  trace_id?: string;
  code?: string; // Error code for client
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
  latencyMs?: number;
  httpStatus?: number;
}

// ============= TRACE LOGGING =============

interface TraceEvent {
  trace_id: string;
  work_item_id: string | null;
  organization_id: string | null;
  workflow_type: string | null;
  step: string;
  provider: string | null;
  http_status: number | null;
  latency_ms: number | null;
  success: boolean;
  error_code: string | null;
  message: string | null;
  meta: Record<string, unknown>;
}

// Log a trace event to the database (non-blocking, fail-safe)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logTrace(
  supabase: any,
  event: Partial<TraceEvent> & { trace_id: string; step: string }
): Promise<void> {
  try {
    // Use 'any' cast since sync_traces table may not be in generated types yet
    await (supabase.from('sync_traces') as any).insert({
      trace_id: event.trace_id,
      work_item_id: event.work_item_id || null,
      organization_id: event.organization_id || null,
      workflow_type: event.workflow_type || null,
      step: event.step,
      provider: event.provider || null,
      http_status: event.http_status || null,
      latency_ms: event.latency_ms || null,
      success: event.success ?? false,
      error_code: event.error_code || null,
      message: event.message?.slice(0, 500) || null, // Truncate messages
      meta: event.meta || {},
    });
  } catch (err) {
    // Fail silently - tracing should never break the main flow
    console.warn('[sync-by-work-item] Failed to log trace:', err);
  }
}

// ============= WORKFLOW-BASED PROVIDER ORDER =============
// 
// NOTIFICATION SOURCES:
// - CGP/LABORAL: ESTADOS are primary notification source (for legal terms)
//   - CPNU primary for enrichment actuaciones, SAMAI fallback
// - CPACA: SAMAI primary (administrative litigation), CPNU optional fallback (disabled)
// - TUTELA: TUTELAS API primary (tutela_code), CPNU fallback if TUTELAS empty/failed
// - PENAL_906: PUBLICACIONES are PRIMARY sync source (called FIRST); CPNU/SAMAI are optional enrichment
// 
// The Estados ingestion pipeline remains canonical for CGP/LABORAL.

type WorkflowType = 'CGP' | 'LABORAL' | 'CPACA' | 'TUTELA' | 'PENAL_906' | 'PETICION' | 'GOV_PROCEDURE';

interface ProviderOrderConfig {
  primary: 'cpnu' | 'samai' | 'tutelas-api' | 'publicaciones';
  fallback?: 'cpnu' | 'samai' | null;
  fallbackEnabled: boolean;
  usePublicacionesAsPrimary?: boolean; // For PENAL_906: Publicaciones is the PRIMARY sync source
}

function getProviderOrder(workflowType: string): ProviderOrderConfig {
  switch (workflowType) {
    case 'CPACA':
      // SAMAI is primary for CPACA (administrative litigation)
      return { primary: 'samai', fallback: 'cpnu', fallbackEnabled: false };
    case 'TUTELA':
      // TUTELAS API primary, CPNU fallback if TUTELAS empty/failed
      return { primary: 'tutelas-api', fallback: 'cpnu', fallbackEnabled: true };
    case 'PENAL_906':
      // PENAL_906: PUBLICACIONES is the PRIMARY sync source
      // Publicaciones must be called FIRST because penal updates frequently surface via published PDFs
      // CPNU/SAMAI are optional enrichment providers (disabled by default)
      return { primary: 'publicaciones', fallback: 'cpnu', fallbackEnabled: false, usePublicacionesAsPrimary: true };
    case 'CGP':
    case 'LABORAL':
    default:
      // CGP/LABORAL: CPNU primary, SAMAI fallback
      // Note: Estados remain the canonical notification source (via estados ingestion pipeline)
      return { primary: 'cpnu', fallback: 'samai', fallbackEnabled: true };
  }
}

// ============= HELPERS =============

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number = 400, traceId?: string): Response {
  return jsonResponse({
    ok: false,
    code,
    message,
    trace_id: traceId,
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

// ============= PROVIDER: CPNU =============

async function fetchFromCpnu(radicado: string): Promise<FetchResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('CPNU_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] CPNU_BASE_URL not configured');
    return { 
      ok: false, 
      actuaciones: [], 
      error: 'CPNU API not configured (missing CPNU_BASE_URL). Contact administrator.', 
      provider: 'cpnu',
      latencyMs: Date.now() - startTime,
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
          latencyMs: Date.now() - startTime,
        };
      }
      const errorText = await response.text();
      console.log(`[sync-by-work-item] CPNU HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      return { 
        ok: false, 
        actuaciones: [], 
        error: `HTTP ${response.status}`, 
        provider: 'cpnu',
        latencyMs: Date.now() - startTime,
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
        latencyMs: Date.now() - startTime,
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
        latencyMs: Date.now() - startTime,
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
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error('[sync-by-work-item] CPNU fetch error:', err);
    return { 
      ok: false, 
      actuaciones: [], 
      error: err instanceof Error ? err.message : 'CPNU fetch failed', 
      provider: 'cpnu',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= PROVIDER: SAMAI =============

async function fetchFromSamai(radicado: string): Promise<FetchResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('SAMAI_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] SAMAI_BASE_URL not configured');
    return { 
      ok: false, 
      actuaciones: [], 
      error: 'SAMAI API not configured (missing SAMAI_BASE_URL).', 
      provider: 'samai',
      latencyMs: Date.now() - startTime,
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

    console.log(`[sync-by-work-item] Calling SAMAI: ${baseUrl}/proceso/${radicado}`);
    
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
          latencyMs: Date.now() - startTime,
        };
      }
      return { 
        ok: false, 
        actuaciones: [], 
        error: `HTTP ${response.status}`, 
        provider: 'samai',
        latencyMs: Date.now() - startTime,
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
        latencyMs: Date.now() - startTime,
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
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error('[sync-by-work-item] SAMAI fetch error:', err);
    return { 
      ok: false, 
      actuaciones: [], 
      error: err instanceof Error ? err.message : 'SAMAI fetch failed', 
      provider: 'samai',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= PROVIDER: TUTELAS API =============

async function fetchFromTutelasApi(tutelaCode: string): Promise<FetchResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('TUTELAS_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] TUTELAS_BASE_URL not configured');
    return { 
      ok: false, 
      actuaciones: [], 
      error: 'TUTELAS API not configured (missing TUTELAS_BASE_URL). Contact administrator.', 
      provider: 'tutelas-api',
      latencyMs: Date.now() - startTime,
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
          latencyMs: Date.now() - startTime,
        };
      }
      return { 
        ok: false, 
        actuaciones: [], 
        error: `HTTP ${response.status}`, 
        provider: 'tutelas-api',
        latencyMs: Date.now() - startTime,
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
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error('[sync-by-work-item] TUTELAS fetch error:', err);
    return { 
      ok: false, 
      actuaciones: [], 
      error: err instanceof Error ? err.message : 'TUTELAS API failed', 
      provider: 'tutelas-api',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= PROVIDER: PUBLICACIONES (for PENAL_906) =============

interface PublicacionesResult {
  ok: boolean;
  publicacionesCount: number;
  insertedCount: number;
  skippedCount: number;
  isEmpty?: boolean;
  error?: string;
  latencyMs?: number;
}

function generatePublicacionFingerprint(
  workItemId: string,
  title: string,
  publishedAt: string | null
): string {
  const normalized = `pub|${workItemId}|${title.toLowerCase().trim().slice(0, 100)}|${publishedAt || 'no-date'}`;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `pub_${workItemId.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
}

async function fetchFromPublicaciones(
  radicado: string,
  workItemId: string,
  ownerId: string,
  organizationId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: any
): Promise<PublicacionesResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('PUBLICACIONES_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-by-work-item] PUBLICACIONES_BASE_URL not configured');
    return { 
      ok: false, 
      publicacionesCount: 0,
      insertedCount: 0,
      skippedCount: 0,
      error: 'PUBLICACIONES API not configured (missing PUBLICACIONES_BASE_URL).', 
      latencyMs: Date.now() - startTime,
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

    console.log(`[sync-by-work-item] PENAL_906: Calling PUBLICACIONES: ${baseUrl}/publicaciones/${radicado}`);
    
    const response = await fetch(`${baseUrl}/publicaciones/${radicado}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[sync-by-work-item] PUBLICACIONES: No publications found for ${radicado}`);
        return { 
          ok: true, // 404 is ok - just no data
          publicacionesCount: 0,
          insertedCount: 0,
          skippedCount: 0,
          error: 'No publications found', 
          isEmpty: true,
          latencyMs: Date.now() - startTime,
        };
      }
      const errorText = await response.text();
      console.log(`[sync-by-work-item] PUBLICACIONES HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      return { 
        ok: false, 
        publicacionesCount: 0,
        insertedCount: 0,
        skippedCount: 0,
        error: `HTTP ${response.status}`, 
        latencyMs: Date.now() - startTime,
      };
    }

    const data = await response.json();
    
    // Extract publications array
    const publications = data.publicaciones || data.publications || [];
    
    if (publications.length === 0) {
      console.log(`[sync-by-work-item] PUBLICACIONES: No publications for ${radicado}`);
      return { 
        ok: true,
        publicacionesCount: 0,
        insertedCount: 0,
        skippedCount: 0,
        error: 'No publications found', 
        isEmpty: true,
        latencyMs: Date.now() - startTime,
      };
    }

    console.log(`[sync-by-work-item] PUBLICACIONES: Found ${publications.length} publications for ${radicado}`);
    
    // Ingest publications with deduplication
    let insertedCount = 0;
    let skippedCount = 0;

    for (const pub of publications) {
      const title = String(pub.titulo || pub.title || '');
      const annotation = String(pub.anotacion || pub.annotation || '');
      const pdfUrl = pub.pdf_url || pub.url || null;
      const publishedAt = pub.fecha_publicacion || pub.published_at || pub.fecha || null;
      
      const fingerprint = generatePublicacionFingerprint(workItemId, title, publishedAt);

      // Check for existing record using fingerprint
      const { data: existing } = await supabaseClient
        .from('work_item_publicaciones')
        .select('id')
        .eq('work_item_id', workItemId)
        .eq('hash_fingerprint', fingerprint)
        .maybeSingle();

      if (existing) {
        skippedCount++;
        continue;
      }

      // Insert new publication
      const { error: insertError } = await supabaseClient
        .from('work_item_publicaciones')
        .insert({
          work_item_id: workItemId,
          owner_id: ownerId,
          organization_id: organizationId,
          title,
          annotation,
          pdf_url: pdfUrl,
          published_at: publishedAt ? parseColombianDate(publishedAt) : null,
          hash_fingerprint: fingerprint,
          source: 'publicaciones-api',
        });

      if (insertError) {
        // Check if it's a duplicate error (can happen in race conditions)
        if (insertError.message?.includes('duplicate') || insertError.code === '23505') {
          skippedCount++;
        } else {
          console.error(`[sync-by-work-item] PUBLICACIONES insert error:`, insertError);
        }
      } else {
        insertedCount++;
      }
    }

    return {
      ok: true,
      publicacionesCount: publications.length,
      insertedCount,
      skippedCount,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error('[sync-by-work-item] PUBLICACIONES fetch error:', err);
    return { 
      ok: false, 
      publicacionesCount: 0,
      insertedCount: 0,
      skippedCount: 0,
      error: err instanceof Error ? err.message : 'PUBLICACIONES API failed', 
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Get trace ID from header or generate new one
  const traceId = req.headers.get('X-Trace-Id') || crypto.randomUUID();
  const syncStartTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('MISSING_ENV', 'Missing Supabase environment variables', 500, traceId);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      await logTrace(supabase, {
        trace_id: traceId,
        step: 'AUTHZ_FAILED',
        success: false,
        error_code: 'UNAUTHORIZED',
        message: 'Missing Authorization header',
      });
      return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401, traceId);
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '');
    
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authError } = await anonClient.auth.getClaims(token);
    
    if (authError || !claims?.claims?.sub) {
      await logTrace(supabase, {
        trace_id: traceId,
        step: 'AUTHZ_FAILED',
        success: false,
        error_code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      });
      return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401, traceId);
    }

    const userId = claims.claims.sub as string;

    // Parse request
    let payload: SyncRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400, traceId);
    }

    const { work_item_id } = payload;
    
    if (!work_item_id) {
      return errorResponse('MISSING_WORK_ITEM_ID', 'work_item_id is required', 400, traceId);
    }

    console.log(`[sync-by-work-item] Starting sync for work_item_id=${work_item_id}, user=${userId}, trace_id=${traceId}`);

    // Log sync start
    await logTrace(supabase, {
      trace_id: traceId,
      work_item_id,
      step: 'SYNC_START',
      success: true,
      message: `Starting sync for work_item_id=${work_item_id}`,
      meta: { user_id: userId.slice(0, 8) + '...' },
    });

    // Fetch work item
    const { data: workItem, error: workItemError } = await supabase
      .from('work_items')
      .select('id, owner_id, organization_id, workflow_type, radicado, tutela_code, scrape_status, last_crawled_at, expediente_url')
      .eq('id', work_item_id)
      .maybeSingle();

    if (workItemError || !workItem) {
      console.log(`[sync-by-work-item] Work item not found: ${work_item_id}`);
      await logTrace(supabase, {
        trace_id: traceId,
        work_item_id,
        step: 'WORK_ITEM_NOT_FOUND',
        success: false,
        error_code: 'WORK_ITEM_NOT_FOUND',
        message: 'Work item not found or access denied',
      });
      return errorResponse('WORK_ITEM_NOT_FOUND', 'Work item not found or access denied', 404, traceId);
    }

    // Log work item loaded
    await logTrace(supabase, {
      trace_id: traceId,
      work_item_id,
      organization_id: workItem.organization_id,
      workflow_type: workItem.workflow_type,
      step: 'WORK_ITEM_LOADED',
      success: true,
      message: `Loaded work item: ${workItem.workflow_type}`,
      meta: {
        has_radicado: !!workItem.radicado,
        has_tutela_code: !!workItem.tutela_code,
        radicado_preview: workItem.radicado ? workItem.radicado.slice(0, 10) + '...' : null,
      },
    });

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

    // Determine provider order based on workflow_type
    const providerOrder = getProviderOrder(workItem.workflow_type);
    console.log(`[sync-by-work-item] Workflow ${workItem.workflow_type}: primary=${providerOrder.primary}, fallback=${providerOrder.fallback || 'none'}, fallbackEnabled=${providerOrder.fallbackEnabled}`);

    const result: SyncResult = {
      ok: false,
      work_item_id,
      workflow_type: workItem.workflow_type,
      inserted_count: 0,
      skipped_count: 0,
      latest_event_date: null,
      provider_used: null,
      provider_attempts: [],
      provider_order_reason: `workflow_type=${workItem.workflow_type}`,
      warnings: [],
      errors: [],
    };

    // ============= RESOLVE IDENTIFIER BASED ON WORKFLOW =============
    let fetchResult: FetchResult | null = null;

    if (workItem.workflow_type === 'TUTELA') {
      // TUTELA workflow: TUTELAS API primary, CPNU fallback
      if (!workItem.tutela_code || !isValidTutelaCode(workItem.tutela_code)) {
        // If no tutela_code, try radicado via CPNU
        if (workItem.radicado && isValidRadicado(workItem.radicado)) {
          console.log(`[sync-by-work-item] TUTELA workflow without tutela_code, using radicado via CPNU`);
          const normalizedRadicado = normalizeRadicado(workItem.radicado);
          fetchResult = await fetchFromCpnu(normalizedRadicado);
          result.provider_attempts.push({
            provider: 'cpnu',
            status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
            latencyMs: fetchResult.latencyMs || 0,
            message: 'Used CPNU (no tutela_code available)',
            actuacionesCount: fetchResult.actuaciones.length,
          });
          result.provider_order_reason = 'tutela_no_code_cpnu_fallback';
        } else {
          return errorResponse(
            'MISSING_IDENTIFIER',
            'TUTELA workflow requires a valid tutela_code (format: T + 6-10 digits, e.g., T11728622) or a 23-digit radicado. Please edit the work item to add one.',
            400
          );
        }
      } else {
        console.log(`[sync-by-work-item] TUTELA workflow: using tutela_code=${workItem.tutela_code}`);
        fetchResult = await fetchFromTutelasApi(workItem.tutela_code);
        
        result.provider_attempts.push({
          provider: 'tutelas-api',
          status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: fetchResult.latencyMs || 0,
          message: fetchResult.error,
          actuacionesCount: fetchResult.actuaciones.length,
        });
        
        // CPNU fallback for TUTELA if TUTELAS API returns empty/not-found
        if (!fetchResult.ok && providerOrder.fallbackEnabled && fetchResult.isEmpty) {
          console.log(`[sync-by-work-item] TUTELAS API empty, trying CPNU fallback`);
          result.warnings.push(`TUTELAS API (primary): ${fetchResult.error || 'Not found'}`);
          
          // Try CPNU using radicado if available
          if (workItem.radicado && isValidRadicado(workItem.radicado)) {
            const normalizedRadicado = normalizeRadicado(workItem.radicado);
            const cpnuResult = await fetchFromCpnu(normalizedRadicado);
            
            result.provider_attempts.push({
              provider: 'cpnu',
              status: cpnuResult.ok ? 'success' : (cpnuResult.isEmpty ? 'not_found' : 'error'),
              latencyMs: cpnuResult.latencyMs || 0,
              message: cpnuResult.error,
              actuacionesCount: cpnuResult.actuaciones.length,
            });
            
            if (cpnuResult.ok) {
              fetchResult = cpnuResult;
              result.provider_order_reason = 'tutela_tutelas_failed_cpnu_fallback';
            } else {
              result.warnings.push(`CPNU fallback: ${cpnuResult.error}`);
            }
          } else {
            result.provider_attempts.push({
              provider: 'cpnu',
              status: 'skipped',
              latencyMs: 0,
              message: 'No valid radicado for CPNU fallback',
            });
          }
        }
      }
      
    } else if (workItem.workflow_type === 'PENAL_906') {
      // ============= PENAL_906: PUBLICACIONES PRIMARY =============
      // For PENAL_906, Publicaciones Procesales is the PRIMARY sync source
      // because penal updates frequently surface via published PDFs/annotations
      
      if (!workItem.radicado || !isValidRadicado(workItem.radicado)) {
        return errorResponse(
          'MISSING_RADICADO',
          'PENAL_906 workflow requires a valid radicado (23 digits). Please edit the work item to add it.',
          400
        );
      }
      
      const normalizedRadicado = normalizeRadicado(workItem.radicado);
      console.log(`[sync-by-work-item] PENAL_906: Calling PUBLICACIONES as PRIMARY provider (radicado=${normalizedRadicado})`);
      
      // Call sync-publicaciones-by-work-item internally via the Publicaciones API
      // For now, we attempt to fetch Publicaciones directly here
      const publicacionesResult = await fetchFromPublicaciones(normalizedRadicado, workItem.id, workItem.owner_id, workItem.organization_id, supabase);
      
      result.provider_attempts.push({
        provider: 'publicaciones',
        status: publicacionesResult.ok ? 'success' : (publicacionesResult.isEmpty ? 'not_found' : 'error'),
        latencyMs: publicacionesResult.latencyMs || 0,
        message: publicacionesResult.error || (publicacionesResult.ok ? `Ingested ${publicacionesResult.insertedCount || 0} publications` : undefined),
        actuacionesCount: publicacionesResult.publicacionesCount || 0,
      });
      
      result.provider_order_reason = 'penal_906_publicaciones_primary';
      
      // For PENAL_906, Publicaciones is the primary source
      // We report success based on Publicaciones, not CPNU/SAMAI
      if (publicacionesResult.ok) {
        result.ok = true;
        result.provider_used = 'publicaciones';
        result.inserted_count = publicacionesResult.insertedCount || 0;
        result.skipped_count = publicacionesResult.skippedCount || 0;
        
        // Update work_item metadata
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
      
      // Publicaciones returned empty/error - optionally try CPNU if fallback enabled
      if (providerOrder.fallbackEnabled && providerOrder.fallback === 'cpnu') {
        console.log(`[sync-by-work-item] PENAL_906: Publicaciones empty, trying CPNU fallback`);
        result.warnings.push(`Publicaciones (primary): ${publicacionesResult.error || 'No publications found'}`);
        
        fetchResult = await fetchFromCpnu(normalizedRadicado);
        
        result.provider_attempts.push({
          provider: 'cpnu',
          status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: fetchResult.latencyMs || 0,
          message: fetchResult.error,
          actuacionesCount: fetchResult.actuaciones.length,
        });
        
        if (!fetchResult.ok) {
          result.warnings.push(`CPNU fallback: ${fetchResult.error}`);
        } else {
          result.provider_order_reason = 'penal_906_publicaciones_empty_cpnu_fallback';
        }
      } else {
        // CPNU fallback disabled for PENAL_906 by default
        result.provider_attempts.push({
          provider: 'cpnu',
          status: 'skipped',
          latencyMs: 0,
          message: 'CPNU enrichment disabled for PENAL_906 (Publicaciones is primary)',
        });
        
        // Publicaciones was the only attempt and it failed/empty
        result.ok = true; // Still "ok" because we successfully queried
        result.provider_used = 'publicaciones';
        result.warnings.push(publicacionesResult.error || 'No publications found');
        
        await supabase
          .from('work_items')
          .update({
            scrape_status: publicacionesResult.isEmpty ? 'SUCCESS' : 'FAILED',
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', work_item_id);
        
        return jsonResponse(result);
      }
      
    } else {
      // CGP/LABORAL/CPACA: require radicado (23 digits)
      if (!workItem.radicado || !isValidRadicado(workItem.radicado)) {
        return errorResponse(
          'MISSING_RADICADO',
          'This workflow requires a valid radicado (23 digits). Please edit the work item to add it.',
          400
        );
      }
      
      const normalizedRadicado = normalizeRadicado(workItem.radicado);
      console.log(`[sync-by-work-item] Radicado workflow (${workItem.workflow_type}): using radicado=${normalizedRadicado}, provider_order=${providerOrder.primary}→${providerOrder.fallback || 'none'}`);
      
      // ============= WORKFLOW-AWARE PROVIDER SELECTION =============
      if (providerOrder.primary === 'samai') {
        // CPACA: SAMAI primary
        console.log(`[sync-by-work-item] CPACA: Calling SAMAI as primary provider`);
        fetchResult = await fetchFromSamai(normalizedRadicado);
        
        result.provider_attempts.push({
          provider: 'samai',
          status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: fetchResult.latencyMs || 0,
          message: fetchResult.error,
          actuacionesCount: fetchResult.actuaciones.length,
        });
        
        // CPNU fallback for CPACA (only if explicitly enabled)
        if (!fetchResult.ok && providerOrder.fallbackEnabled && providerOrder.fallback === 'cpnu') {
          console.log(`[sync-by-work-item] SAMAI failed/empty for CPACA, trying CPNU fallback`);
          result.warnings.push(`SAMAI (primary): ${fetchResult.error}`);
          
          const cpnuResult = await fetchFromCpnu(normalizedRadicado);
          
          result.provider_attempts.push({
            provider: 'cpnu',
            status: cpnuResult.ok ? 'success' : (cpnuResult.isEmpty ? 'not_found' : 'error'),
            latencyMs: cpnuResult.latencyMs || 0,
            message: cpnuResult.error,
            actuacionesCount: cpnuResult.actuaciones.length,
          });
          
          if (cpnuResult.ok) {
            fetchResult = cpnuResult;
            result.provider_order_reason = 'cpaca_samai_failed_cpnu_fallback';
          } else {
            result.warnings.push(`CPNU fallback: ${cpnuResult.error}`);
          }
        } else if (!fetchResult.ok && !providerOrder.fallbackEnabled) {
          // Log that CPNU fallback is disabled for CPACA
          result.provider_attempts.push({
            provider: 'cpnu',
            status: 'skipped',
            latencyMs: 0,
            message: 'CPNU fallback disabled for CPACA workflow',
          });
        }
        
      } else {
        // CGP/LABORAL: CPNU primary
        console.log(`[sync-by-work-item] ${workItem.workflow_type}: Calling CPNU as primary provider`);
        fetchResult = await fetchFromCpnu(normalizedRadicado);
        
        result.provider_attempts.push({
          provider: 'cpnu',
          status: fetchResult.ok ? 'success' : (fetchResult.isEmpty ? 'not_found' : 'error'),
          latencyMs: fetchResult.latencyMs || 0,
          message: fetchResult.error,
          actuacionesCount: fetchResult.actuaciones.length,
        });
        
        // SAMAI fallback: only if CPNU returns not found, empty, or recoverable error
        if (!fetchResult.ok && providerOrder.fallbackEnabled && 
            (fetchResult.isEmpty || fetchResult.error?.includes('timeout') || fetchResult.error?.includes('5'))) {
          console.log(`[sync-by-work-item] CPNU failed/empty, trying SAMAI fallback`);
          result.warnings.push(`CPNU (primary): ${fetchResult.error}`);
          
          const samaiResult = await fetchFromSamai(normalizedRadicado);
          
          result.provider_attempts.push({
            provider: 'samai',
            status: samaiResult.ok ? 'success' : (samaiResult.isEmpty ? 'not_found' : 'error'),
            latencyMs: samaiResult.latencyMs || 0,
            message: samaiResult.error,
            actuacionesCount: samaiResult.actuaciones.length,
          });
          
          if (samaiResult.ok) {
            fetchResult = samaiResult;
            result.provider_order_reason = `${workItem.workflow_type.toLowerCase()}_cpnu_failed_samai_fallback`;
          } else {
            result.warnings.push(`SAMAI fallback: ${samaiResult.error}`);
          }
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
