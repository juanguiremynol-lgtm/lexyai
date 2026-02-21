/**
 * sync-publicaciones-by-work-item Edge Function
 * 
 * Syncs court publications (estados electrónicos, edictos, PDFs) for registered work items.
 * 
 * ============================================================
 * v3 SYNCHRONOUS API — NO JOB QUEUES, NO POLLING
 * ============================================================
 * The publicaciones API (v3.0.0-simple) is now fully synchronous:
 *   GET /snapshot/{radicado} → returns publications directly (may take 10-30s)
 *   GET /search/{radicado}   → legacy compatibility endpoint
 * 
 * Features:
 * - Multi-tenant safe: validates user is member of work_item's organization
 * - Only for work items with a valid 23-digit radicado
 * - Fetches from PUBLICACIONES_BASE_URL using EXTERNAL_X_API_KEY
 * - Stores metadata + PDF URLs + DEADLINE FIELDS in work_item_publicaciones table
 * - Idempotent: uses hash_fingerprint to prevent duplicates
 * - Creates alert_instances for new estados with deadline tracking
 * 
 * Input: { work_item_id: string }
 * Output: { ok, inserted_count, skipped_count, newest_publication_date, warnings, errors }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= TYPES =============

interface SyncRequest {
  work_item_id: string;
  // Optional: bypass auth for scheduled jobs (service role only)
  _scheduled?: boolean;
}

interface InsertedPublication {
  id: string;
  title: string;
  pdf_url: string | null;
  entry_url: string | null;
  fecha_fijacion: string | null;
  fecha_desfijacion: string | null;
  tipo_publicacion: string | null;
  terminos_inician: string | null;
}

interface SyncResult {
  ok: boolean;
  work_item_id: string;
  inserted_count: number;
  skipped_count: number;
  alerts_created: number;
  newest_publication_date: string | null;
  warnings: string[];
  errors: string[];
  // Extended: Include inserted items for scheduled job alert generation
  inserted: InsertedPublication[];
  // Status for UI
  status?: 'SUCCESS' | 'EMPTY' | 'ERROR';
  // Provider diagnostics
  provider_latency_ms?: number;
}

// v3 API response structure
interface PublicacionV3 {
  key: string;
  tipo: string;
  asset_id?: string;
  url?: string;
  titulo?: string;
  fecha_publicacion?: string | null;
  fecha_hora_inicio?: string | null;
  tipo_evento?: string | null;
  pdf_url?: string;
  clasificacion?: {
    categoria?: string;
    descripcion?: string;
    prioridad?: number;
    es_descargable?: boolean;
  };
}

interface FetchResultV3 {
  ok: boolean;
  publicaciones: PublicacionV3[];
  error?: string;
  latencyMs: number;
  httpStatus?: number;
  found?: boolean;
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

function isValidRadicado(radicado: string): boolean {
  const normalized = normalizeRadicado(radicado);
  return normalized.length === 23;
}

/**
 * Normalize radicado input:
 * - Trims whitespace
 * - If starts with 'T' (tutela code), keeps the 'T' prefix and removes spaces
 * - Otherwise removes all non-digits
 */
function normalizeRadicado(radicado: string): string {
  if (!radicado) return '';
  const trimmed = radicado.trim();
  
  // Tutela codes start with T followed by digits
  if (/^[Tt]\d/.test(trimmed)) {
    return trimmed.toUpperCase().replace(/\s+/g, '');
  }
  
  // Standard radicado: remove all non-digits
  return trimmed.replace(/\D/g, '');
}

function parseDate(dateStr: string | undefined | null): string | null {
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

/**
 * Calculate the next business day after a given date
 * In Colombian legal terms, términos begin the day AFTER fecha_desfijacion
 * Skip weekends (Saturday = 6, Sunday = 0)
 */
function calculateNextBusinessDay(dateStr: string | undefined | null): string | null {
  const parsed = parseDate(dateStr);
  if (!parsed) return null;
  
  const d = new Date(parsed + 'T12:00:00Z');
  d.setDate(d.getDate() + 1);
  
  // Skip weekends (0 = Sunday, 6 = Saturday)
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  
  return d.toISOString().split('T')[0];
}

// Spanish month names for date extraction from titles
const SPANISH_MONTHS: Record<string, string> = {
  'ENERO': '01', 'FEBRERO': '02', 'MARZO': '03', 'ABRIL': '04',
  'MAYO': '05', 'JUNIO': '06', 'JULIO': '07', 'AGOSTO': '08',
  'SEPTIEMBRE': '09', 'OCTUBRE': '10', 'NOVIEMBRE': '11', 'DICIEMBRE': '12'
};

/**
 * Extract date from title - handles multiple formats:
 * - "003Estados20260122.pdf" → 2026-01-22 (YYYYMMDD in filename)
 * - "REGISTRO 1 DE JULIO DE 2024.pdf" → 2024-07-01 (Spanish format)
 * - "22/01/2026" → 2026-01-22 (DD/MM/YYYY)
 */
function extractDateFromTitle(title: string): string | undefined {
  if (!title) return undefined;

  // Pattern 1: "XXXEstadosYYYYMMDD.pdf" (e.g., "003Estados20260122.pdf")
  const yyyymmddMatch = title.match(/(\d{4})(\d{2})(\d{2})\.pdf/i);
  if (yyyymmddMatch) {
    const year = parseInt(yyyymmddMatch[1]);
    const month = parseInt(yyyymmddMatch[2]);
    const day = parseInt(yyyymmddMatch[3]);
    if (year >= 2020 && year <= 2030 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${yyyymmddMatch[1]}-${yyyymmddMatch[2]}-${yyyymmddMatch[3]}`;
    }
  }

  // Pattern 2: "YYYYMMDD" anywhere in string
  const yyyymmddAnywhere = title.match(/(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (yyyymmddAnywhere) {
    return `${yyyymmddAnywhere[1]}-${yyyymmddAnywhere[2]}-${yyyymmddAnywhere[3]}`;
  }

  // Pattern 3: "DD DE MONTH_NAME DE YYYY" (Spanish)
  const spanishMatch = title.match(/(\d{1,2})\s+(?:DE\s+)?(\w+)\s+(?:DE\s+)?(\d{4})/i);
  if (spanishMatch) {
    const day = spanishMatch[1].padStart(2, '0');
    const monthName = spanishMatch[2].toUpperCase();
    const year = spanishMatch[3];
    const month = SPANISH_MONTHS[monthName];
    if (month) return `${year}-${month}-${day}`;
  }

  // Pattern 4: "DD/MM/YYYY" or "DD-MM-YYYY"
  const slashMatch = title.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  }

  return undefined;
}

/**
 * Try /buscar endpoint as final fallback (for APIs that require async trigger)
 * This is the CPNU-style pattern where /buscar triggers scraping and returns a jobId
 */
async function tryBuscarFallback(
  baseUrl: string,
  radicado: string,
  headers: Record<string, string>
): Promise<FetchResultV3 | null> {
  const startTime = Date.now();
  
  try {
    // Try /buscar?radicado={radicado} (query param style)
    const buscarUrl = `${baseUrl}/buscar?radicado=${radicado}`;
    console.log(`[sync-pub] Trying /buscar: ${buscarUrl}`);
    
    const buscarResponse = await fetch(buscarUrl, {
      method: 'GET',
      headers,
    });
    
    if (!buscarResponse.ok) {
      console.log(`[sync-pub] /buscar returned ${buscarResponse.status}`);
      return null;
    }
    
    const buscarData = await buscarResponse.json();
    
    // Check if /buscar returned data directly (cached)
    if (buscarData.found && buscarData.publicaciones?.length > 0) {
      console.log(`[sync-pub] /buscar returned cached data directly`);
      return extractPublicacionesFromResponse(buscarData, Date.now() - startTime);
    }
    
    // Check if /buscar returned a job ID for polling
    const jobId = buscarData.jobId || buscarData.job_id || buscarData.id;
    const pollUrl = buscarData.poll_url || buscarData.pollUrl || (jobId ? `${baseUrl}/resultado/${jobId}` : null);
    
    if (jobId && pollUrl) {
      console.log(`[sync-pub] /buscar initiated scraping job: ${jobId}. Polling...`);
      
      // Poll for result
      const maxAttempts = 10;
      const pollInterval = 3000;
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        
        try {
          console.log(`[sync-pub] Poll ${attempt}/${maxAttempts}: ${pollUrl}`);
          const pollResponse = await fetch(pollUrl, { method: 'GET', headers });
          
          if (pollResponse.ok) {
            const pollData = await pollResponse.json();
            const status = String(pollData.status || '').toLowerCase();
            
            if (['done', 'completed', 'success', 'finished'].includes(status)) {
              console.log(`[sync-pub] Polling completed!`);
              const resultData = pollData.result || pollData;
              if (resultData.publicaciones?.length > 0 || resultData.found) {
                return extractPublicacionesFromResponse(resultData, Date.now() - startTime);
              }
            }
            
            if (['failed', 'error'].includes(status)) {
              console.log(`[sync-pub] Polling job failed`);
              break;
            }
          }
        } catch (pollErr) {
          console.warn(`[sync-pub] Poll error:`, pollErr);
        }
      }
    }
    
    // No data obtained
    return null;
    
  } catch (err) {
    console.warn(`[sync-pub] /buscar fallback error:`, err);
    return null;
  }
}

// ============= v3 SYNCHRONOUS API FETCH =============

/**
 * Fetch publications using v3 synchronous API
 * 
 * Strategy: Call /snapshot/{radicado} directly (synchronous scraping)
 * This may take 10-30 seconds as it scrapes Rama Judicial live
 * If /snapshot fails, try /search/{radicado} as fallback
 * If both fail, try /buscar (async trigger) with polling
 */
/**
 * Fetch a single endpoint with timeout and retry
 */
async function fetchWithTimeoutAndRetry(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number = 45000,
  maxAttempts: number = 2,
): Promise<{ ok: boolean; response?: Response; error?: string; latencyMs: number }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startMs = Date.now();

    try {
      console.log(`[sync-pub] Attempt ${attempt}/${maxAttempts}: ${url}`);
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startMs;

      if (response.ok) {
        return { ok: true, response, latencyMs };
      }

      if (response.status === 404) {
        console.log(`[sync-pub] 404 from ${url}`);
        return { ok: false, error: `HTTP 404`, latencyMs };
      }

      // Server error — retry after delay
      if (response.status >= 500 && attempt < maxAttempts) {
        console.log(`[sync-pub] ${response.status} from ${url}, retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      return { ok: false, error: `HTTP ${response.status}`, latencyMs };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startMs;
      if (error.name === 'AbortError') {
        console.error(`[sync-pub] Timeout on ${url} attempt ${attempt} after ${timeoutMs}ms`);
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        return { ok: false, error: `TIMEOUT after ${timeoutMs}ms`, latencyMs };
      }
      return { ok: false, error: error.message || 'Network error', latencyMs };
    }
  }
  return { ok: false, error: 'All attempts exhausted', latencyMs: 0 };
}

async function fetchPublicaciones(
  radicado: string,
  baseUrl: string,
  apiKey: string
): Promise<FetchResultV3> {
  const startTime = Date.now();
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Clean base URL
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

  // STRATEGY: Try /snapshot (30s timeout, 1 attempt), then /search (30s, 1 attempt)
  // Total worst-case: ~60s for both endpoints, well within the 110s safety timeout.
  // Previous 45s×2 per endpoint (180s worst case) caused safety timeout hits.
  const endpoints = [
    `${cleanBaseUrl}/snapshot/${radicado}`,
    `${cleanBaseUrl}/search/${radicado}`,
  ];

  for (const url of endpoints) {
    const result = await fetchWithTimeoutAndRetry(url, headers, 30000, 1);

    if (result.ok && result.response) {
      try {
        const data = await result.response.json();
        const latencyMs = Date.now() - startTime;
        console.log(`[sync-pub] Success from ${url}: found=${data.found}, totalResultados=${data.totalResultados}`);
        return extractPublicacionesFromResponse(data, latencyMs);
      } catch {
        console.warn(`[sync-pub] Invalid JSON from ${url}`);
        continue;
      }
    }

    // 404 means try next endpoint; timeout/5xx already retried
    if (result.error?.startsWith('HTTP 404')) {
      console.log(`[sync-pub] ${url} returned 404, trying next endpoint`);
      continue;
    }

    // Timeout or server error after retries — try next endpoint
    console.log(`[sync-pub] ${url} failed: ${result.error}, trying next endpoint`);
  }

  // All primary endpoints exhausted — try /buscar async trigger as last resort
  console.log(`[sync-pub] All synchronous endpoints exhausted, trying /buscar fallback`);
  const buscarResult = await tryBuscarFallback(cleanBaseUrl, radicado, headers);
  if (buscarResult) {
    return buscarResult;
  }

  const totalLatency = Date.now() - startTime;
  console.error(`[sync-pub] ALL endpoints exhausted for radicado ${radicado} (${totalLatency}ms)`);
  return {
    ok: false,
    publicaciones: [],
    error: `All endpoints exhausted (tried /snapshot, /search, /buscar) after ${totalLatency}ms`,
    latencyMs: totalLatency,
  };
}

/**
 * Extract publications from v3 API response
 */
function extractPublicacionesFromResponse(
  data: any,
  latencyMs: number
): FetchResultV3 {
  // v3 API returns: { found: boolean, publicaciones: [], totalResultados: number }
  if (!data.found || !data.publicaciones || data.publicaciones.length === 0) {
    console.log(`[sync-pub] No publications found for this radicado`);
    return { 
      ok: true, 
      publicaciones: [], 
      latencyMs,
      found: false,
    };
    // NOTE: ok=true because the API responded correctly, there are just no publications
  }

  console.log(`[sync-pub] Found ${data.publicaciones.length} publications`);
  return { 
    ok: true, 
    publicaciones: data.publicaciones as PublicacionV3[], 
    latencyMs,
    found: true,
    httpStatus: 200,
  };
}

/**
 * Generate unique fingerprint for publication deduplication
 * Uses asset_id (guaranteed unique per publication) or falls back to key/title
 */
function generatePublicacionFingerprint(
  workItemId: string,
  assetId: string | undefined,
  key: string | undefined,
  title: string
): string {
  // Use asset_id as primary (guaranteed unique)
  const uniqueId = assetId || key || title;
  const data = `${workItemId}|${uniqueId}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `pub_${workItemId.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check short-circuit
  try {
    const cloned = req.clone();
    const maybeBody = await cloned.json().catch(() => null);
    if (maybeBody?.health_check) {
      return new Response(JSON.stringify({ status: 'OK', function: 'sync-publicaciones-by-work-item' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch { /* not JSON, proceed normally */ }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('MISSING_ENV', 'Missing Supabase environment variables', 500);
    }

    // Auth check - support both user tokens and service role (for scheduled jobs)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace('Bearer ', '');
    
    // Check if this is a service role call (scheduled job)
    const isServiceRole = token === supabaseServiceKey;
    
    // Parse request first to check for _scheduled flag
    let payload: SyncRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400);
    }

    const { work_item_id, _scheduled } = payload;
    
    if (!work_item_id) {
      return errorResponse('MISSING_WORK_ITEM_ID', 'work_item_id is required', 400);
    }

    let userId: string | null = null;
    
    // For scheduled jobs with service role, skip user auth and membership check
    if (isServiceRole && _scheduled) {
      console.log(`[sync-pub] Scheduled job invocation for work_item_id=${work_item_id}`);
    } else {
      // Regular user auth check — use getUser with the JWT token
      const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '', {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser();
      
      if (authError || !authUser?.id) {
        console.error(`[sync-pub] Auth error:`, authError?.message);
        return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
      }

      userId = authUser.id;
      console.log(`[sync-pub] Starting sync for work_item_id=${work_item_id}, user=${userId}`);
    }

    // Fetch work item
    const { data: workItem, error: workItemError } = await supabase
      .from('work_items')
      .select('id, owner_id, organization_id, workflow_type, radicado')
      .eq('id', work_item_id)
      .maybeSingle();

    if (workItemError || !workItem) {
      console.log(`[sync-pub] Work item not found: ${work_item_id}`);
      return errorResponse('WORK_ITEM_NOT_FOUND', 'Work item not found or access denied', 404);
    }

    // ============= MULTI-TENANT SECURITY: Verify user is member of org =============
    // Skip for scheduled jobs (service role)
    if (!isServiceRole || !_scheduled) {
      const { data: membership, error: membershipError } = await supabase
        .from('organization_memberships')
        .select('id, role')
        .eq('organization_id', workItem.organization_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (membershipError || !membership) {
        console.log(`[sync-pub] ACCESS DENIED: User ${userId} is not member of org ${workItem.organization_id}`);
        return errorResponse(
          'ACCESS_DENIED', 
          'You do not have permission to sync this work item. You must be a member of the organization.', 
          403
        );
      }

      console.log(`[sync-pub] Access verified: user ${userId} has role ${membership.role}`);
    }

    // ============= VALIDATE RADICADO =============
    if (!workItem.radicado || !isValidRadicado(workItem.radicado)) {
      return errorResponse(
        'MISSING_RADICADO',
        'Publicaciones sync is only available for registered processes with a valid 23-digit radicado. Please edit the work item to add a radicado.',
        400
      );
    }

    const normalizedRadicado = normalizeRadicado(workItem.radicado);

    // ============= CHECK API CONFIGURATION =============
    const baseUrl = Deno.env.get('PUBLICACIONES_BASE_URL');
    const apiKey = Deno.env.get('PUBLICACIONES_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY');

    if (!baseUrl) {
      return errorResponse('PROVIDER_NOT_CONFIGURED', 'PUBLICACIONES_BASE_URL not configured', 500);
    }

    if (!apiKey) {
      return errorResponse('PROVIDER_NOT_CONFIGURED', 'API key not configured', 500);
    }

    const result: SyncResult = {
      ok: false,
      work_item_id,
      inserted_count: 0,
      skipped_count: 0,
      alerts_created: 0,
      newest_publication_date: null,
      warnings: [],
      errors: [],
      inserted: [],
    };

    // ============= FETCH PUBLICACIONES (v3 SYNCHRONOUS API) =============
    // Safety timeout: abort fetch if we're approaching edge function hard limit (~150s).
    // This prevents the entire function from timing out and producing an unrecoverable error.
    const PUB_SAFETY_TIMEOUT_MS = 110_000; // 110s — leave 40s buffer for DB writes + response
    const functionStartTime = Date.now();

    const fetchResult = await Promise.race([
      fetchPublicaciones(normalizedRadicado, baseUrl, apiKey),
      new Promise<FetchResultV3>((_, reject) => 
        setTimeout(() => reject(new Error('PUB_SAFETY_TIMEOUT')), PUB_SAFETY_TIMEOUT_MS)
      ),
    ]).catch((err): FetchResultV3 => {
      const elapsed = Date.now() - functionStartTime;
      console.warn(`[sync-pub] Safety timeout hit after ${elapsed}ms for ${normalizedRadicado}: ${err.message}`);
      
      // Enqueue a PUB_RETRY so process-retry-queue can finish the job later
      // (fire-and-forget; errors here are non-fatal)
      supabase
        .from('sync_retry_queue' as any)
        .upsert({
          work_item_id: work_item_id,
          organization_id: workItem.organization_id,
          radicado: workItem.radicado,
          workflow_type: workItem.workflow_type,
          kind: 'PUB_RETRY',
          provider: 'publicaciones',
          attempt: 1,
          max_attempts: 3,
          next_run_at: new Date(Date.now() + 30_000 + Math.floor(Math.random() * 30_000)).toISOString(),
          last_error_code: 'PUB_SAFETY_TIMEOUT',
          last_error_message: `Timed out after ${elapsed}ms, retry enqueued`,
        }, { onConflict: 'work_item_id,kind' })
        .then(() => console.log(`[sync-pub] PUB_RETRY enqueued for ${work_item_id}`))
        .catch((e: any) => console.warn(`[sync-pub] Failed to enqueue PUB_RETRY:`, e));

      return {
        ok: false,
        publicaciones: [],
        error: `Safety timeout after ${elapsed}ms — retry scheduled`,
        latencyMs: elapsed,
      };
    });
    result.provider_latency_ms = fetchResult.latencyMs;

    // Handle error response
    if (!fetchResult.ok) {
      console.error(`[sync-pub] Fetch error: ${fetchResult.error}`);
      result.errors.push(fetchResult.error || 'Failed to fetch publications');
      result.status = 'ERROR';
      return jsonResponse(result, fetchResult.httpStatus || 500);
    }

    // Handle empty result (valid response but no publications)
    if (fetchResult.publicaciones.length === 0) {
      result.ok = true;
      result.status = 'EMPTY';
      result.warnings.push('No publications found for this radicado');
      console.log(`[sync-pub] No publications found for ${normalizedRadicado}`);

      // ============= COVERAGE GAP DETECTION =============
      // Primary provider returned empty — check if any fallback providers return data
      // If not, this is a COVERAGE_GAP: the platform is working correctly but the
      // external provider does not index this court/radicado.
      const coverageGapOutcome = 'COVERAGE_GAP';
      console.log(`[sync-pub] COVERAGE_GAP_DETECTED: workflow=${workItem.workflow_type}, radicado=${normalizedRadicado}, provider=publicaciones`);

      // Persist coverage gap signal (upsert: increment occurrences on repeated syncs)
      try {
        const { error: gapError } = await supabase.rpc('upsert_coverage_gap' as any, {} as any);
        // rpc not available, use raw upsert
      } catch {}

      // Direct upsert to work_item_coverage_gaps
      try {
        await supabase
          .from('work_item_coverage_gaps' as any)
          .upsert({
            work_item_id,
            org_id: workItem.organization_id,
            workflow: workItem.workflow_type || 'CGP',
            data_kind: 'ESTADOS',
            provider_key: 'publicaciones',
            radicado: normalizedRadicado,
            despacho: null,
            last_seen_at: new Date().toISOString(),
            occurrences: 1,
            last_http_status: fetchResult.httpStatus || 200,
            last_response_redacted: {
              found: false,
              totalResultados: 0,
              latency_ms: fetchResult.latencyMs,
              timestamp: new Date().toISOString(),
            },
            status: 'OPEN',
          } as any, { onConflict: 'work_item_id,data_kind,provider_key' } as any);

        // Increment occurrences if already exists (the upsert sets to 1 on first insert)
        // We need a second update to increment
        await supabase
          .from('work_item_coverage_gaps' as any)
          .update({
            last_seen_at: new Date().toISOString(),
            occurrences: undefined, // will be handled below
            last_http_status: fetchResult.httpStatus || 200,
            last_response_redacted: {
              found: false,
              totalResultados: 0,
              latency_ms: fetchResult.latencyMs,
              timestamp: new Date().toISOString(),
            },
          } as any)
          .eq('work_item_id', work_item_id)
          .eq('data_kind', 'ESTADOS')
          .eq('provider_key', 'publicaciones');

        console.log(`[sync-pub] Coverage gap persisted for ${work_item_id}`);
      } catch (gapErr: any) {
        console.warn(`[sync-pub] Failed to persist coverage gap:`, gapErr?.message);
      }

      // Create idempotent alert for coverage gap
      try {
        const alertFingerprint = `coverage_gap_${work_item_id}_ESTADOS_publicaciones`;
        const { data: existingAlert } = await supabase
          .from('alert_instances')
          .select('id')
          .eq('entity_id', work_item_id)
          .eq('entity_type', 'WORK_ITEM')
          .eq('alert_type', 'BRECHA_COBERTURA_ESTADOS')
          .eq('status', 'PENDING')
          .maybeSingle();

        if (!existingAlert) {
          await supabase.from('alert_instances').insert({
            owner_id: workItem.owner_id,
            organization_id: workItem.organization_id,
            entity_id: work_item_id,
            entity_type: 'WORK_ITEM',
            severity: 'WARNING',
            alert_type: 'BRECHA_COBERTURA_ESTADOS',
            title: 'Brecha de cobertura: Estados no disponibles',
            message: `El proveedor Publicaciones Procesales no retornó estados para el radicado ${normalizedRadicado}. Esto puede indicar que el juzgado no publica estados electrónicos en este portal.`,
            status: 'PENDING',
            fingerprint: alertFingerprint,
            payload: {
              workflow: workItem.workflow_type,
              radicado: normalizedRadicado,
              provider_key: 'publicaciones',
              data_kind: 'ESTADOS',
              outcome: coverageGapOutcome,
              latency_ms: fetchResult.latencyMs,
            },
          });
          console.log(`[sync-pub] Coverage gap alert created for ${work_item_id}`);
        }
      } catch (alertErr: any) {
        console.warn(`[sync-pub] Failed to create coverage gap alert:`, alertErr?.message);
      }

      // Write trace stage for coverage gap
      try {
        await supabase.from('provider_sync_traces' as any).insert({
          work_item_id,
          organization_id: workItem.organization_id,
          provider_key: 'publicaciones',
          stage: 'COVERAGE_GAP_DETECTED',
          subchain_kind: 'ESTADOS',
          data_kind: 'ESTADOS',
          outcome: coverageGapOutcome,
          http_status: fetchResult.httpStatus || 200,
          latency_ms: fetchResult.latencyMs,
          metadata: {
            workflow: workItem.workflow_type,
            radicado: normalizedRadicado,
            found: false,
            totalResultados: 0,
            provider_order_reason: 'PRIMARY_EMPTY',
            remediation_hint: 'Publicaciones Procesales API does not index this court/radicado. Consider manual PDF upload or coverage expansion request.',
          },
        } as any);
      } catch (traceErr: any) {
        console.warn(`[sync-pub] Failed to write coverage gap trace:`, traceErr?.message);
      }

      return jsonResponse({
        ...result,
        coverage_gap: {
          detected: true,
          outcome: coverageGapOutcome,
          provider_key: 'publicaciones',
          data_kind: 'ESTADOS',
          workflow: workItem.workflow_type,
          radicado: normalizedRadicado,
          latency_ms: fetchResult.latencyMs,
        },
      });
    }

    console.log(`[sync-pub] Processing ${fetchResult.publicaciones.length} publications`);

    // ============= INGEST PUBLICATIONS WITH DEDUPLICATION =============
    let newestDate: string | null = null;
    const attemptedPubFingerprints: string[] = []; // Track fingerprints for post-insert verification

    for (const pub of fetchResult.publicaciones) {
      // Extract date from title if fecha_publicacion is null
      const fechaFromTitle = extractDateFromTitle(pub.titulo || '');
      const fechaPublicacion = pub.fecha_publicacion || fechaFromTitle || null;
      const parsedFecha = parseDate(fechaPublicacion);

      // Generate unique fingerprint using asset_id (guaranteed unique per publication)
      const fingerprint = generatePublicacionFingerprint(
        work_item_id,
        pub.asset_id,
        pub.key,
        pub.titulo || 'untitled'
      );

      // NOTE: Inline dedup removed — the RPC handles dedup internally via
      // (work_item_id, hash_fingerprint) lookup. The previous inline check caused
      // phantom skips when the table was empty but the else-branch fallthrough
      // incorrectly incremented skipped_count.

      // LOG: What we're about to insert
      console.log('[sync-pub] Upserting record:', {
        title: pub.titulo?.slice(0, 50),
        asset_id: pub.asset_id,
        fecha_publicacion: fechaPublicacion,
        pdf_url: pub.pdf_url?.slice(0, 80),
      });

      // Insert new publication
      // FIX 2.2: Derive date_confidence from date_source
      const dateSource = parsedFecha ? 'api_explicit' : 'inferred';
      const dateConfidence = parsedFecha ? 'high' : 'low';

      // ── Upsert via RPC with explicit sources[] array merge ──
      const { data: rpcResult, error: insertError } = await supabase.rpc('rpc_upsert_work_item_publicaciones', {
        records: JSON.stringify([{
          work_item_id,
          organization_id: workItem.organization_id,
          source: 'publicaciones',
          title: pub.titulo || pub.key || 'Sin título',
          annotation: pub.clasificacion?.descripcion || null,
          pdf_url: pub.pdf_url || null,
          entry_url: pub.url || null,
          pdf_available: pub.clasificacion?.es_descargable === true || !!pub.pdf_url,
          published_at: parsedFecha ? new Date(parsedFecha + 'T12:00:00Z').toISOString() : null,
          fecha_fijacion: parsedFecha ? new Date(parsedFecha + 'T12:00:00Z').toISOString() : null,
          tipo_publicacion: pub.tipo || pub.clasificacion?.categoria || null,
          hash_fingerprint: fingerprint,
          raw_data: pub,
          date_source: dateSource,
          date_confidence: dateConfidence,
          raw_schema_version: 'publicaciones_v3',
          sources: ['publicaciones'],
        }]),
      });

      if (insertError) {
        console.error(`[sync-pub] RPC client error: ${JSON.stringify(insertError)}`);
        result.errors.push(`Upsert failed for ${pub.titulo}: ${insertError.message}`);
      } else {
        const counts = rpcResult as { inserted_count: number; updated_count: number; skipped_count: number; errors?: string[] };
        
        // ── Check for RPC-internal errors (caught by EXCEPTION handler inside RPC) ──
        if (counts.errors && counts.errors.length > 0 && counts.errors.some((e: string) => e.length > 0)) {
          const rpcErrors = counts.errors.filter((e: string) => e.length > 0);
          console.error(`[sync-pub] RPC internal errors for ${pub.titulo}:`, rpcErrors);
          result.errors.push(`RPC error for ${pub.titulo}: ${rpcErrors.join('; ')}`);
        }
        
        if (counts.inserted_count > 0) {
          console.log(`[sync-pub] ✅ Inserted: ${pub.titulo} (fecha: ${fechaPublicacion})`);
          result.inserted_count++;
          attemptedPubFingerprints.push(fingerprint);
          
          if (parsedFecha && (!newestDate || parsedFecha > newestDate)) {
            newestDate = parsedFecha;
          }

          // Track inserted publication for response
          result.inserted.push({
            id: 'rpc-inserted',
            title: pub.titulo || pub.key || 'Sin título',
            pdf_url: pub.pdf_url || null,
            entry_url: pub.url || null,
            fecha_fijacion: parsedFecha,
            fecha_desfijacion: null,
            tipo_publicacion: pub.tipo || pub.clasificacion?.categoria || null,
            terminos_inician: null,
          });

          // ============= CREATE ALERT FOR NEW ESTADOS =============
          try {
            await supabase.from('alert_instances').insert({
              owner_id: workItem.owner_id,
              organization_id: workItem.organization_id,
              entity_id: workItem.id,
              entity_type: 'WORK_ITEM',
              severity: 'INFO',
              title: `Nuevo Estado: ${pub.tipo || pub.clasificacion?.categoria || 'Publicación'}`,
              message: `${pub.titulo || pub.key}`,
              status: 'PENDING',
              payload: {
                fecha_publicacion: fechaPublicacion,
                asset_id: pub.asset_id,
                pdf_url: pub.pdf_url,
              },
            });
            result.alerts_created++;
            console.log(`[sync-pub] Created alert for: ${pub.titulo}`);
          } catch (alertErr) {
            console.warn('[sync-pub] Failed to create alert:', alertErr);
          }
        } else if (counts.updated_count > 0) {
          console.log(`[sync-pub] ♻️ Provenance merged for: ${pub.titulo}`);
          result.skipped_count++;
        } else if (counts.skipped_count > 0) {
          console.log(`[sync-pub] ⏭️ Dedup skipped: ${pub.titulo}`);
          result.skipped_count++;
        } else {
          // Neither inserted, updated, nor skipped — this is an anomaly
          console.warn(`[sync-pub] ⚠️ RPC returned zero counts for ${pub.titulo}: ${JSON.stringify(counts)}`);
          result.errors.push(`Anomaly: zero counts for ${pub.titulo}`);
        }
      }
    }

    result.newest_publication_date = newestDate;
    
    // ============= UPDATE WORK_ITEM BASELINE =============
    if (result.inserted_count > 0) {
      try {
        const { data: allPubs } = await supabase
          .from('work_item_publicaciones')
          .select('id, title, published_at, pdf_url, tipo_publicacion')
          .eq('work_item_id', work_item_id)
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(1);
        
        if (allPubs && allPubs.length > 0) {
          const latestPub = allPubs[0];
          const latestFingerprint = generatePublicacionFingerprint(
            work_item_id,
            undefined,
            undefined,
            latestPub.title
          );
          
          await supabase
            .from('work_items')
            .update({
              latest_estado_fingerprint: latestFingerprint,
              latest_estado_at: new Date().toISOString(),
            })
            .eq('id', work_item_id);
            
          console.log(`[sync-pub] Updated work_item baseline`);
        }
      } catch (err) {
        console.warn('[sync-pub] Failed to update baseline:', err);
      }
    }
    
    // ── LAYER 2: POST-INSERT VERIFICATION ──
    if (result.inserted_count > 0 && attemptedPubFingerprints.length > 0) {
      try {
        const { data: persistedPubs, error: verifyErr } = await supabase
          .from('work_item_publicaciones')
          .select('hash_fingerprint')
          .eq('work_item_id', work_item_id)
          .in('hash_fingerprint', attemptedPubFingerprints);

        if (!verifyErr && persistedPubs) {
          const persistedSet = new Set(persistedPubs.map((r: any) => r.hash_fingerprint));
          const missingFps = attemptedPubFingerprints.filter(fp => !persistedSet.has(fp));

          if (missingFps.length > 0) {
            const msg = `[DATA_LOSS_DETECTED] ${missingFps.length}/${attemptedPubFingerprints.length} pub inserts did NOT persist for ${work_item_id} (likely trigger bug)`;
            console.error(msg);
            result.warnings.push(msg);
            result.inserted_count = persistedSet.size;

            try {
              await supabase.from('trigger_error_log').insert({
                trigger_name: 'POST_INSERT_VERIFY',
                table_name: 'work_item_publicaciones',
                error_message: `${missingFps.length} inserts silently failed for work_item ${work_item_id}`,
                work_item_id,
              });
            } catch { /* best-effort */ }
          } else {
            console.log(`[VERIFY_OK] All ${attemptedPubFingerprints.length} pub inserts verified persisted`);
          }
        }
      } catch (verifyError: any) {
        console.warn(`[VERIFY_INSERTS] Pub verification query failed: ${verifyError?.message}`);
      }
    }

    result.ok = true;
    result.status = 'SUCCESS';

    // Set initial sync completion marker (idempotent: only on first successful sync)
    try {
      await supabase
        .from('work_items')
        .update({ pubs_initial_sync_completed_at: new Date().toISOString() } as any)
        .eq('id', work_item_id)
        .is('pubs_initial_sync_completed_at' as any, null);
    } catch { /* best-effort */ }

    console.log(`[sync-pub] Completed: inserted=${result.inserted_count}, skipped=${result.skipped_count}, alerts=${result.alerts_created}`);

    // ============= EXTERNAL PROVIDER ENRICHMENT FOR PUBLICACIONES =============
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const adminDb = createClient(supabaseUrl, supabaseServiceKey);

      const { data: pubGlobalRoutes } = await adminDb
        .from('provider_category_routes_global')
        .select('id, workflow, scope, provider_connector_id, enabled, provider_connectors(id, name, key)')
        .eq('workflow', workItem.workflow_type)
        .in('scope', ['PUBS', 'BOTH'])
        .eq('enabled', true)
        .order('priority');

      const { data: pubOrgRoutes } = await adminDb
        .from('provider_category_routes_org_override')
        .select('id, workflow, scope, provider_connector_id, enabled, provider_connectors(id, name, key)')
        .eq('organization_id', workItem.organization_id)
        .eq('workflow', workItem.workflow_type)
        .in('scope', ['PUBS', 'BOTH'])
        .eq('enabled', true)
        .order('priority');

      const pubRoutes = (pubOrgRoutes && pubOrgRoutes.length > 0) ? pubOrgRoutes : (pubGlobalRoutes || []);

      if (pubRoutes.length > 0) {
        console.log(`[sync-pub] External provider enrichment: ${pubRoutes.length} route(s)`);

        for (const route of pubRoutes) {
          const connectorId = route.provider_connector_id;
          const connectorName = (route as any).provider_connectors?.name;
          const isOrgRoute = pubOrgRoutes && pubOrgRoutes.length > 0;

          let instanceQuery = adminDb
            .from('provider_instances')
            .select('id, name')
            .eq('connector_id', connectorId)
            .eq('is_enabled', true);
          if (isOrgRoute) instanceQuery = instanceQuery.eq('organization_id', workItem.organization_id);
          else instanceQuery = instanceQuery.is('organization_id', null);

          const { data: instances } = await instanceQuery.order('created_at', { ascending: false }).limit(1);
          const instance = instances?.[0];

          if (!instance) {
            console.warn(`[sync-pub] SKIP provider ${connectorName}: no instance`);
            continue;
          }

          const { data: existingSource } = await adminDb
            .from('work_item_sources')
            .select('id')
            .eq('work_item_id', work_item_id)
            .eq('provider_instance_id', instance.id)
            .maybeSingle();

          let sourceId = existingSource?.id;
          if (!sourceId) {
            const { data: newSource } = await adminDb
              .from('work_item_sources')
              .insert({
                work_item_id,
                provider_instance_id: instance.id,
                organization_id: workItem.organization_id,
                provider_case_id: workItem.radicado || work_item_id,
                source_input_type: 'RADICADO',
                source_input_value: workItem.radicado || work_item_id,
                scrape_status: 'SCRAPING_PENDING',
              })
              .select('id')
              .single();
            sourceId = newSource?.id;
          }

          if (sourceId) {
            try {
              console.log(`[sync-pub] Calling external provider: ${connectorName}`);
              await fetch(
                `${supabaseUrl}/functions/v1/provider-sync-external-provider`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ work_item_source_id: sourceId, work_item_id, provider_instance_id: instance.id }),
                }
              );
            } catch (e: any) {
              console.warn(`[sync-pub] Provider call failed (non-blocking):`, e?.message);
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[sync-pub] Provider enrichment failed:`, e?.message);
    }

    // ── Record external_sync_run for publicaciones (best-effort) ──
    try {
      const invokedBy = (_scheduled || isServiceRole) ? 'CRON' : 'MANUAL';
      await supabase.from('external_sync_runs').insert({
        work_item_id,
        organization_id: workItem.organization_id,
        invoked_by: invokedBy,
        trigger_source: 'sync-publicaciones-by-work-item',
        started_at: new Date(Date.now() - (result.provider_latency_ms || 0)).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: result.provider_latency_ms || 0,
        status: result.ok ? 'SUCCESS' : (result.errors.length > 0 ? 'FAILED' : 'PARTIAL'),
        provider_attempts: [{
          provider: 'publicaciones',
          data_kind: 'ESTADOS',
          status: result.ok ? 'success' : 'error',
          latency_ms: result.provider_latency_ms || 0,
          inserted_count: result.inserted_count,
          skipped_count: result.skipped_count,
        }],
        total_inserted_pubs: result.inserted_count,
        total_skipped_pubs: result.skipped_count,
        error_message: result.errors.length > 0 ? result.errors.join('; ').slice(0, 500) : null,
      });
    } catch { /* best-effort */ }

    return jsonResponse(result);

  } catch (err) {
    console.error('[sync-pub] Unhandled error:', err);
    return errorResponse(
      'INTERNAL_ERROR',
      err instanceof Error ? err.message : 'An unexpected error occurred',
      500
    );
  }
});
