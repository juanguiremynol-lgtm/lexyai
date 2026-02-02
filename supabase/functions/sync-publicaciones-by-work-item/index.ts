/**
 * sync-publicaciones-by-work-item Edge Function
 * 
 * Syncs court publications (estados electrónicos, edictos, PDFs) for registered work items.
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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  scrapingInitiated?: boolean;
  scrapingJobId?: string;
  scrapingMessage?: string;
  // NEW: Scraping status for UI auto-retry
  status?: 'SUCCESS' | 'SCRAPING_IN_PROGRESS' | 'SCRAPING_TIMEOUT' | 'ERROR' | 'EMPTY';
  retryAfterSeconds?: number;
}

interface PublicacionRaw {
  title: string;
  annotation?: string;
  pdf_url?: string;
  entry_url?: string;        // Portal entry URL
  pdf_available?: boolean;   // Whether PDF is available
  published_at?: string;
  // CRITICAL DEADLINE FIELDS:
  fecha_fijacion?: string;
  fecha_desfijacion?: string;
  despacho?: string;
  tipo_publicacion?: string;
  source_id?: string;
  raw?: Record<string, unknown>;
}

interface FetchResult {
  ok: boolean;
  publicaciones: PublicacionRaw[];
  error?: string;
  message?: string;
  scrapingJobId?: string;
  scrapingPollUrl?: string;
  isEmpty?: boolean;
  latencyMs?: number;
  httpStatus?: number;
  // NEW: Scraping in progress status (not a hard error)
  status?: 'SUCCESS' | 'SCRAPING_IN_PROGRESS' | 'SCRAPING_TIMEOUT' | 'ERROR';
  retryAfterSeconds?: number;
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
  const normalized = radicado.replace(/\D/g, '');
  return normalized.length === 23;
}

function normalizeRadicado(radicado: string): string {
  return radicado.replace(/\D/g, '');
}

function generatePublicacionFingerprint(
  pdfUrl: string | null | undefined,
  title: string,
  publishedAt: string | null | undefined
): string {
  // Use pdf_url as primary key if available, otherwise title + date
  const key = pdfUrl || `${title}|${publishedAt || ''}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `pub_${Math.abs(hash).toString(16)}`;
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

// ============= PUBLICACIONES API PROVIDER =============
// WORKING ENDPOINTS (Polling Strategy):
// - GET /buscar?radicado={radicado} - Trigger async scraping, returns job_id
// - GET /resultado/{job_id} - Poll for scraping results
// NOTE: /snapshot does NOT exist - always returns 404

interface FetchPublicacionesResult extends FetchResult {
  scrapingInitiated?: boolean;
  scrapingMessage?: string;
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
 * Reusable polling function for /resultado/{job_id}
 */
async function pollForResults(
  baseUrl: string,
  jobId: string,
  headers: Record<string, string>,
  radicado: string,
  startTime: number
): Promise<FetchPublicacionesResult> {
  const resultadoUrl = `${baseUrl}/resultado/${jobId}`;
  const maxAttempts = 24;       // 24 attempts (120 seconds total)
  const pollIntervalMs = 5000;  // 5 seconds between polls
  let lastResultData: Record<string, unknown> | null = null;

  console.log(`[sync-pub] pollForResults: Starting polling for ${resultadoUrl}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Wait BEFORE polling (including first attempt — give worker time to start)
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    try {
      const resultResponse = await fetch(resultadoUrl, { method: 'GET', headers });

      if (!resultResponse.ok) {
        console.log(`[sync-pub] pollForResults: Poll ${attempt}/${maxAttempts}: HTTP ${resultResponse.status}`);
        continue;
      }

      const data = await resultResponse.json();
      lastResultData = data;
      const status = data.status;

      console.log(`[sync-pub] pollForResults: Poll ${attempt}/${maxAttempts}: status=${status}`);

      // Still processing
      if (['queued', 'processing', 'running', 'pending'].includes(status)) {
        continue;
      }

      // Completed successfully
      if (['done', 'completed', 'success', 'finished'].includes(status)) {
        console.log(`[sync-pub] pollForResults: Job completed!`);
        return extractPublicacionesFromResponse(data, startTime);
      }

      // Failed
      if (['failed', 'error'].includes(status)) {
        console.log(`[sync-pub] pollForResults: Job failed: ${data.error || 'unknown'}`);
        return {
          ok: false,
          publicaciones: [],
          error: `Job failed: ${data.error || 'unknown'}`,
          latencyMs: Date.now() - startTime,
        };
      }

      // Unknown status
      console.log(`[sync-pub] pollForResults: Poll ${attempt}: unknown status "${status}"`);
    } catch (pollErr) {
      console.log(`[sync-pub] pollForResults: Poll ${attempt} error: ${pollErr instanceof Error ? pollErr.message : 'unknown'}`);
    }
  }

  // Polling timed out - this is NOT a hard error, scraping may still complete
  console.log(`[sync-pub] pollForResults: Polling timed out after ${maxAttempts * pollIntervalMs / 1000}s`);
  console.log(`[sync-pub] pollForResults: Last response:`, JSON.stringify(lastResultData).slice(0, 400));
  
  // Determine if still processing or truly timed out
  const lastStatus = (lastResultData as any)?.status;
  const isStillProcessing = ['queued', 'processing', 'running', 'pending'].includes(lastStatus);

  return {
    ok: false,
    publicaciones: [],
    error: isStillProcessing 
      ? `Scraping still in progress (job status: ${lastStatus})`
      : `Polling timeout (${maxAttempts * pollIntervalMs / 1000}s)`,
    status: isStillProcessing ? 'SCRAPING_IN_PROGRESS' : 'SCRAPING_TIMEOUT',
    scrapingJobId: jobId,
    scrapingPollUrl: resultadoUrl,
    retryAfterSeconds: 60,
    latencyMs: Date.now() - startTime,
  };
}

/**
 * POLLING-BASED STRATEGY for Publicaciones API
 * 
 * ENHANCED FLOW (handles slow Cloud Run worker):
 * 1. Call /buscar to trigger scraping job (or get deduped/cached response)
 * 2. Handle "deduped" responses by trying multiple fallback endpoints
 * 3. Poll /resultado/{job_id} every 5s for up to 120s (24 attempts)
 * 4. Wait BEFORE first poll to give worker time to start
 * 5. If polling times out, try fallback: GET /publicaciones?radicado=XXX
 * 6. Final fallback: Try /snapshot one last time
 */
/**
 * Route probe attempt result
 */
interface RouteProbeAttempt {
  path: string;
  httpStatus: number;
  responseKind: 'JSON' | 'HTML_404' | 'EMPTY' | 'ERROR';
  latencyMs: number;
  errorCode?: string;
}

/**
 * ROUTE PROBING STRATEGY for Publicaciones API
 * 
 * When the primary route fails (404 with generic "Not Found"), try alternate routes.
 * This distinguishes between:
 * - PROVIDER_ROUTE_NOT_FOUND: Wrong endpoint (HTML 404 / {"detail":"Not Found"})
 * - RECORD_NOT_CACHED: Valid endpoint but record needs scraping (domain-specific JSON)
 */
const PUBLICACIONES_ROUTE_CANDIDATES = [
  '/buscar?radicado={id}',                    // Primary: async job creation
  '/snapshot?radicado={id}',                  // Cached snapshot if available
  '/publicaciones/{id}',                      // Path-based direct lookup
  '/publicaciones?radicado={id}',             // Query-param direct lookup
  '/publicaciones?numero_radicacion={id}',    // Alternative param name
  '/buscar?numero_radicacion={id}',           // Alternative param name for buscar
];

/**
 * Detect if response body is a generic "route not found" (HTML 404, not JSON)
 * 
 * IMPORTANT: FastAPI's {"detail":"Not Found"} is NOT a route error - it's a valid
 * JSON response indicating the record doesn't exist. Only HTML 404s are route errors.
 */
function isHtmlRouteNotFound(body: string): boolean {
  const lower = body.toLowerCase();
  
  // HTML 404 pages (Express, Nginx, Apache, etc.) = route doesn't exist
  if (lower.includes('cannot get') ||         // Express
      lower.includes('<!doctype html') ||     // HTML response
      lower.includes('<html') ||               // HTML response
      lower.includes('not found</pre>') ||    // Express error page
      lower.includes('404 not found') ||      // Generic HTML
      lower.includes('<title>404')) return true;
  
  return false;
}

/**
 * Detect if response is a valid JSON 404 (record not found, but route exists)
 * 
 * FastAPI: {"detail":"Not Found"}
 * Custom: {"error":"not found"}, {"message":"Record not found"}, etc.
 */
function isJsonRecordNotFound(body: string): boolean {
  try {
    const json = JSON.parse(body);
    // FastAPI generic 404: {"detail":"Not Found"}
    if (json.detail && typeof json.detail === 'string') return true;
    // Other common patterns
    if (json.error || json.message || json.status === 404) return true;
    return true; // Any valid JSON 404 is a record-not-found
  } catch {
    return false;
  }
}

/**
 * Detect if response indicates scraping is needed/in progress
 */
function isScrapingNeededResponse(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes('scraping') || 
         lower.includes('queued') || 
         lower.includes('processing') ||
         lower.includes('not cached') ||
         lower.includes('job_id') ||
         lower.includes('jobid');
}

/**
 * Probe a single route and classify the response
 */
async function probeRoute(
  baseUrl: string,
  pathTemplate: string,
  radicado: string,
  headers: Record<string, string>,
  startTime: number
): Promise<{ attempt: RouteProbeAttempt; data?: any; isValidRoute: boolean; needsPolling?: boolean; jobId?: string }> {
  const path = pathTemplate.replace('{id}', radicado);
  const url = `${baseUrl}${path}`;
  const probeStart = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);

    const httpStatus = response.status;
    const bodyText = await response.text();
    const latencyMs = Date.now() - probeStart;

    // Classify response
    let responseKind: RouteProbeAttempt['responseKind'] = 'JSON';
    try {
      JSON.parse(bodyText);
    } catch {
      responseKind = bodyText.trim() === '' ? 'EMPTY' : 'HTML_404';
    }

    const attempt: RouteProbeAttempt = { path, httpStatus, responseKind, latencyMs };

    // 200 OK = valid route with data
    if (response.ok) {
      try {
        const jsonData = JSON.parse(bodyText);
        
        // Check if this is a job creation response (needs polling)
        const jobId = jsonData.job_id || jsonData.jobId;
        if (jobId) {
          // If job is already done, extract results
          if (jsonData.status === 'done' || jsonData.status === 'completed') {
            return { attempt, data: jsonData, isValidRoute: true, needsPolling: false };
          }
          return { attempt, data: jsonData, isValidRoute: true, needsPolling: true, jobId };
        }

        // Direct data response
        const results = jsonData.results || jsonData.publicaciones || jsonData.estados || jsonData.data;
        if (results && Array.isArray(results)) {
          return { attempt, data: jsonData, isValidRoute: true, needsPolling: false };
        }

        // Response is the array itself
        if (Array.isArray(jsonData)) {
          return { attempt, data: { results: jsonData }, isValidRoute: true, needsPolling: false };
        }

        // Valid route but empty result
        return { attempt, data: jsonData, isValidRoute: true, needsPolling: false };
      } catch {
        attempt.errorCode = 'INVALID_JSON';
        return { attempt, isValidRoute: false };
      }
    }

    // 404 - classify it
    if (httpStatus === 404) {
      // HTML 404 = route doesn't exist (Express, Nginx, etc.)
      if (isHtmlRouteNotFound(bodyText)) {
        attempt.errorCode = 'ROUTE_NOT_FOUND';
        return { attempt, isValidRoute: false };
      }
      
      // JSON 404 = valid route, record not found (FastAPI, custom APIs)
      // This is NOT a route error - the endpoint exists, record doesn't
      if (isJsonRecordNotFound(bodyText)) {
        // Check if scraping is needed/in progress
        if (isScrapingNeededResponse(bodyText)) {
          attempt.errorCode = 'SCRAPING_NEEDED';
          return { attempt, isValidRoute: true, needsPolling: true };
        }
        // Valid route, record simply doesn't exist - trigger scraping
        attempt.errorCode = 'RECORD_NOT_FOUND';
        return { attempt, isValidRoute: true, needsPolling: false };
      }
      
      // Unknown 404 format - assume route error
      attempt.errorCode = 'ROUTE_NOT_FOUND';
      return { attempt, isValidRoute: false };
    }

    // Other errors
    attempt.errorCode = `HTTP_${httpStatus}`;
    return { attempt, isValidRoute: false };

  } catch (err) {
    const latencyMs = Date.now() - probeStart;
    const attempt: RouteProbeAttempt = {
      path,
      httpStatus: 0,
      responseKind: 'ERROR',
      latencyMs,
      errorCode: err instanceof Error && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
    };
    return { attempt, isValidRoute: false };
  }
}

/**
 * POLLING-BASED STRATEGY with ROUTE PROBING for Publicaciones API
 * 
 * ENHANCED FLOW:
 * 1. Probe route candidates until we find a valid one
 * 2. If valid route returns job_id, poll /resultado/{job_id}
 * 3. If all routes return generic 404, return PROVIDER_ROUTE_NOT_FOUND
 * 4. If valid route indicates "not cached", return SCRAPING_IN_PROGRESS
 */
async function fetchPublicaciones(radicado: string): Promise<FetchPublicacionesResult & { provider_attempts?: RouteProbeAttempt[] }> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('PUBLICACIONES_BASE_URL');
  const apiKey = Deno.env.get('PUBLICACIONES_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY');

  console.log(`[sync-pub] === STARTING FETCH WITH ROUTE PROBING ===`);
  console.log(`[sync-pub] Radicado: ${radicado}`);
  console.log(`[sync-pub] Base URL: ${baseUrl ? 'configured' : 'MISSING'}`);
  console.log(`[sync-pub] API Key: present=${!!apiKey}, length=${apiKey?.length || 0}`);

  if (!baseUrl) {
    return {
      ok: false,
      publicaciones: [],
      error: 'PUBLICACIONES_BASE_URL not configured',
      status: 'ERROR',
      latencyMs: Date.now() - startTime,
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      publicaciones: [],
      error: 'API key not configured',
      status: 'ERROR',
      latencyMs: Date.now() - startTime,
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-api-key': apiKey,
  };

  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const attempts: RouteProbeAttempt[] = [];

  // ========= ROUTE PROBING: Try each candidate until we find a valid route =========
  console.log(`[sync-pub] Starting route probing with ${PUBLICACIONES_ROUTE_CANDIDATES.length} candidates...`);

  for (let i = 0; i < PUBLICACIONES_ROUTE_CANDIDATES.length; i++) {
    const pathTemplate = PUBLICACIONES_ROUTE_CANDIDATES[i];
    console.log(`[sync-pub] Probe ${i + 1}/${PUBLICACIONES_ROUTE_CANDIDATES.length}: ${pathTemplate.replace('{id}', radicado.slice(0, 8) + '...')}`);

    const probeResult = await probeRoute(cleanBaseUrl, pathTemplate, radicado, headers, startTime);
    attempts.push(probeResult.attempt);

    console.log(`[sync-pub] Probe result: HTTP ${probeResult.attempt.httpStatus}, valid=${probeResult.isValidRoute}, errorCode=${probeResult.attempt.errorCode || 'none'}`);

    if (!probeResult.isValidRoute) {
      // Try next route
      if (probeResult.attempt.errorCode === 'ROUTE_NOT_FOUND') {
        console.log(`[sync-pub] Route ${pathTemplate} not found, trying next...`);
        continue;
      }
      // Other error (network, timeout) - might want to retry same route
      continue;
    }

    // ========= VALID ROUTE FOUND =========
    console.log(`[sync-pub] ✓ Valid route found: ${pathTemplate}`);

    // Case A: Job ID returned - need to poll
    if (probeResult.needsPolling && probeResult.jobId) {
      const jobId = probeResult.jobId;
      console.log(`[sync-pub] Job ID received: ${jobId}, starting polling...`);

      // Handle "cached" job_id (can't poll)
      if (jobId === 'cached') {
        console.log(`[sync-pub] Job ID is 'cached', checking if inline result exists...`);
        const data = probeResult.data;
        if (data?.result || data?.results || data?.publicaciones) {
          return { ...extractPublicacionesFromResponse(data, startTime), provider_attempts: attempts };
        }
        // No inline result with cached job - this means it was processed before but no data
        // Try remaining fallback routes
        continue;
      }

      // Poll for results
      const pollResult = await pollForResults(cleanBaseUrl, jobId, headers, radicado, startTime);
      return { ...pollResult, provider_attempts: attempts };
    }

    // Case B: Direct data returned
    if (probeResult.data) {
      const results = probeResult.data.results || probeResult.data.publicaciones || 
                      probeResult.data.estados || probeResult.data.data || probeResult.data;
      
      if (Array.isArray(results) && results.length > 0) {
        console.log(`[sync-pub] Direct data received: ${results.length} publications`);
        return { ...extractPublicacionesFromResponse(probeResult.data, startTime), provider_attempts: attempts };
      }
    }

    // Case C: Valid route but record not found (needs scraping)
    if (probeResult.attempt.errorCode === 'RECORD_NOT_FOUND') {
      console.log(`[sync-pub] ✓ Valid route, but record not found. Returning SCRAPING_IN_PROGRESS.`);
      return {
        ok: true, // Not a hard error - valid route, just needs scraping
        publicaciones: [],
        status: 'SCRAPING_IN_PROGRESS',
        scrapingMessage: 'Record not yet cached. Provider may need to scrape this radicado.',
        retryAfterSeconds: 60,
        latencyMs: Date.now() - startTime,
        provider_attempts: attempts,
      };
    }

    // Case D: Valid route with scraping needed flag
    if (probeResult.attempt.errorCode === 'SCRAPING_NEEDED') {
      console.log(`[sync-pub] ✓ Valid route, scraping in progress.`);
      return {
        ok: true,
        publicaciones: [],
        status: 'SCRAPING_IN_PROGRESS',
        scrapingMessage: 'Scraping job detected. Retry later.',
        retryAfterSeconds: 60,
        latencyMs: Date.now() - startTime,
        provider_attempts: attempts,
      };
    }

  // ========= ALL ROUTES FAILED =========
  console.log(`[sync-pub] All ${attempts.length} route candidates failed.`);
  
  // Check if all failures were generic 404s (route not found)
  const allRoutesNotFound = attempts.every(a => a.errorCode === 'ROUTE_NOT_FOUND' || a.httpStatus === 404);
  
  if (allRoutesNotFound) {
    console.log(`[sync-pub] ❌ PROVIDER_ROUTE_NOT_FOUND - All routes returned generic 404.`);
    return {
      ok: false,
      publicaciones: [],
      error: 'PROVIDER_ROUTE_NOT_FOUND: All route candidates returned 404. Check PUBLICACIONES_BASE_URL configuration.',
      status: 'ERROR',
      httpStatus: 502, // Bad Gateway - upstream configuration issue
      latencyMs: Date.now() - startTime,
      provider_attempts: attempts,
    };
  }

  // Mixed failures
  console.log(`[sync-pub] ❌ Mixed failures across routes.`);
  return {
    ok: false,
    publicaciones: [],
    error: `Failed to find valid route. Attempts: ${attempts.map(a => `${a.path}:${a.httpStatus}`).join(', ')}`,
    status: 'ERROR',
    latencyMs: Date.now() - startTime,
    provider_attempts: attempts,
  };
}

/**
 * FALLBACK: Try direct /publicaciones?radicado=XXX endpoint
 * Some Cloud Run services support a synchronous query endpoint
 */
async function fetchPublicacionesFallback(
  radicado: string,
  apiKey: string,
  baseUrl: string
): Promise<PublicacionRaw[] | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-api-key': apiKey,
  };

  try {
    // Try GET /publicaciones?radicado=XXX (synchronous query, no job needed)
    const directUrl = `${baseUrl}/publicaciones?radicado=${radicado}`;
    console.log(`[sync-publicaciones] Fallback: Calling ${directUrl}`);

    const response = await fetch(directUrl, {
      method: 'GET',
      headers,
    });

    console.log(`[sync-publicaciones] Fallback response: HTTP ${response.status}`);

    if (!response.ok) {
      console.log(`[sync-publicaciones] Fallback endpoint returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[sync-publicaciones] Fallback response body:`, JSON.stringify(data).substring(0, 500));

    // Check if this endpoint returns results directly
    const results = data.results || data.publicaciones || data.estados || data.data;
    if (results && Array.isArray(results) && results.length > 0) {
      console.log(`[sync-publicaciones] Fallback found ${results.length} publications!`);
      return mapRawPublicaciones(results);
    }

    // Maybe the response IS the array
    if (Array.isArray(data) && data.length > 0) {
      console.log(`[sync-publicaciones] Fallback response is array with ${data.length} items`);
      return mapRawPublicaciones(data);
    }

    console.log(`[sync-publicaciones] Fallback: No publications in response`);
    return null;

  } catch (err) {
    console.error('[sync-publicaciones] Fallback error:', err);
    return null;
  }
}

/**
 * Map raw API response to PublicacionRaw format
 */
function mapRawPublicaciones(results: Record<string, unknown>[]): PublicacionRaw[] {
  return results.map((pub: Record<string, unknown>) => {
    // Extract date from title if not provided by API
    let publishedAt = pub.published_at || pub.fecha_publicacion || pub.fecha;
    let extractedDateFromTitle: string | undefined;
    
    if (pub.title) {
      extractedDateFromTitle = extractDateFromTitle(String(pub.title));
    }
    
    if (!publishedAt && extractedDateFromTitle) {
      publishedAt = extractedDateFromTitle;
    }

    // Try API fields first, fall back to extracted date from title
    const apiFechaFijacion = extractDateString(pub, ['fecha_fijacion', 'fijacion', 'fecha_inicio', 'start_date']);
    const apiFechaDesfijacion = extractDateString(pub, ['fecha_desfijacion', 'desfijacion', 'fecha_fin', 'end_date', 'fecha_retiro']);
    
    // CRITICAL FIX: If API doesn't provide fecha_fijacion but we extracted a date from title,
    // use that as fecha_fijacion (the publication date IS when it was posted)
    const finalFechaFijacion = apiFechaFijacion || extractedDateFromTitle;

    return {
      title: String(pub.title || pub.titulo || 'Sin título'),
      annotation: pub.annotation || pub.anotacion || pub.detalle
        ? String(pub.annotation || pub.anotacion || pub.detalle)
        : undefined,
      pdf_url: pub.pdf_url ? String(pub.pdf_url) : undefined,
      entry_url: pub.entry_url ? String(pub.entry_url) : undefined,
      pdf_available: Boolean(pub.pdf_available ?? true),
      published_at: publishedAt ? String(publishedAt) : undefined,
      fecha_fijacion: finalFechaFijacion,
      fecha_desfijacion: apiFechaDesfijacion,
      despacho: extractString(pub, ['despacho', 'juzgado', 'court', 'oficina', 'dependencia']),
      tipo_publicacion: extractString(pub, ['tipo_publicacion', 'tipo', 'type', 'categoria']),
      source_id: pub.id ? String(pub.id) : undefined,
      raw: pub as Record<string, unknown>,
    };
  });
}

/**
 * Extract publications from polling response data
 */
function extractPublicacionesFromResponse(data: Record<string, unknown>, startTime: number): FetchPublicacionesResult {
  console.log(`[sync-publicaciones] Raw response:`, JSON.stringify(data).substring(0, 500));

  const result = (data.result || data) as Record<string, unknown>;
  const publicaciones = (result.results || result.publicaciones || result.estados || []) as Record<string, unknown>[];

  if (publicaciones.length === 0) {
    console.log('[sync-publicaciones] No publications found in completed job');
    return {
      ok: false,
      publicaciones: [],
      error: 'No publications found',
      isEmpty: true,
      latencyMs: Date.now() - startTime,
      httpStatus: 200,
    };
  }

  console.log(`[sync-publicaciones] Found ${publicaciones.length} publications`);

  // Log sample for debugging
  if (publicaciones.length > 0) {
    const sample = publicaciones[0];
    console.log('[sync-publicaciones] Sample publication:', JSON.stringify(sample, null, 2));
  }

  return {
    ok: true,
    publicaciones: mapRawPublicaciones(publicaciones),
    latencyMs: Date.now() - startTime,
    httpStatus: 200,
  };
}

// Helper to extract date strings from multiple possible field names
function extractDateString(obj: Record<string, unknown>, fieldNames: string[]): string | undefined {
  for (const field of fieldNames) {
    if (obj[field]) {
      return String(obj[field]);
    }
  }
  return undefined;
}

// Helper to extract string from multiple possible field names
function extractString(obj: Record<string, unknown>, fieldNames: string[]): string | undefined {
  for (const field of fieldNames) {
    if (obj[field]) {
      return String(obj[field]);
    }
  }
  return undefined;
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
      console.log(`[sync-publicaciones] Scheduled job invocation for work_item_id=${work_item_id}`);
    } else {
      // Regular user auth check
      const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '');
      const { data: claims, error: authError } = await anonClient.auth.getClaims(token);
      
      if (authError || !claims?.claims?.sub) {
        return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
      }

      userId = claims.claims.sub as string;
      console.log(`[sync-publicaciones] Starting sync for work_item_id=${work_item_id}, user=${userId}`);
    }

    // Fetch work item
    const { data: workItem, error: workItemError } = await supabase
      .from('work_items')
      .select('id, owner_id, organization_id, workflow_type, radicado')
      .eq('id', work_item_id)
      .maybeSingle();

    if (workItemError || !workItem) {
      console.log(`[sync-publicaciones] Work item not found: ${work_item_id}`);
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
        console.log(`[sync-publicaciones] ACCESS DENIED: User ${userId} is not member of org ${workItem.organization_id}`);
        return errorResponse(
          'ACCESS_DENIED', 
          'You do not have permission to sync this work item. You must be a member of the organization.', 
          403
        );
      }

      console.log(`[sync-publicaciones] Access verified: user ${userId} has role ${membership.role}`);
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

    const result: SyncResult = {
      ok: false,
      work_item_id,
      inserted_count: 0,
      skipped_count: 0,
      alerts_created: 0,
      newest_publication_date: null,
      warnings: [],
      errors: [],
      inserted: [], // Track inserted items for scheduled job alert generation
    };

    // ============= FETCH PUBLICACIONES =============
    const fetchResult = await fetchPublicaciones(normalizedRadicado);

    // ============= CLASSIFY RESULT AND RETURN APPROPRIATE RESPONSE =============
    
    // Case 1: SCRAPING_IN_PROGRESS (valid route, but record not cached yet)
    // This is ok:true because the route works, we just need to wait for data
    if (fetchResult.status === 'SCRAPING_IN_PROGRESS') {
      console.log(`[sync-publicaciones] Scraping in progress: ${fetchResult.scrapingMessage || 'awaiting data'}`);
      return jsonResponse({
        ...result,
        ok: true, // ← NOT an error, this is expected behavior
        status: 'SCRAPING_IN_PROGRESS',
        scrapingInitiated: true,
        scrapingJobId: fetchResult.scrapingJobId,
        scrapingMessage: fetchResult.scrapingMessage || 'Provider is processing request',
        retryAfterSeconds: fetchResult.retryAfterSeconds || 60,
        provider_attempts: (fetchResult as any).provider_attempts || [],
        warnings: ['Scraping en progreso, reintente en 60 segundos'],
        errors: [], // No errors, this is expected
      }, 202); // 202 Accepted = operation started but not complete
    }
    
    // Case 2: SCRAPING_TIMEOUT (polling timed out but job may still complete)
    if (fetchResult.status === 'SCRAPING_TIMEOUT') {
      console.log(`[sync-publicaciones] Scraping timeout: ${fetchResult.error}`);
      return jsonResponse({
        ...result,
        ok: false, // Timeout is a soft failure
        status: 'SCRAPING_TIMEOUT',
        scrapingInitiated: true,
        scrapingJobId: fetchResult.scrapingJobId,
        scrapingMessage: fetchResult.error || 'Polling timed out, job may still complete',
        retryAfterSeconds: fetchResult.retryAfterSeconds || 60,
        provider_attempts: (fetchResult as any).provider_attempts || [],
        warnings: [],
        errors: [fetchResult.error || 'Polling timed out after 120s, retry recommended'],
      }, 202);
    }

    // Case 3: Hard error (provider misconfiguration, network failure, etc.)
    if (!fetchResult.ok && fetchResult.status === 'ERROR') {
      console.error(`[sync-publicaciones] Hard error: ${fetchResult.error}`);
      const httpStatus = fetchResult.httpStatus || 500;
      
      // Special handling for PROVIDER_ROUTE_NOT_FOUND
      if (fetchResult.error?.includes('PROVIDER_ROUTE_NOT_FOUND')) {
        return jsonResponse({
          ...result,
          ok: false,
          status: 'PROVIDER_ROUTE_NOT_FOUND',
          errors: [fetchResult.error],
          provider_attempts: (fetchResult as any).provider_attempts || [],
          message: 'All provider route candidates returned 404. Check PUBLICACIONES_BASE_URL configuration.',
        }, 502); // 502 Bad Gateway = upstream configuration issue
      }
      
      result.errors.push(fetchResult.error || 'Failed to fetch publications');
      result.status = 'ERROR';
      return jsonResponse({ ...result, provider_attempts: (fetchResult as any).provider_attempts || [] }, httpStatus);
    }

    // Case 4: Empty result (valid response but no publications for this radicado)
    if (!fetchResult.ok && fetchResult.isEmpty) {
      result.ok = true;
      result.status = 'EMPTY';
      result.warnings.push('No publications found for this radicado');
      return jsonResponse({ ...result, provider_attempts: (fetchResult as any).provider_attempts || [] });
    }

    if (fetchResult.publicaciones.length === 0) {
      result.ok = true;
      result.status = 'EMPTY';
      result.warnings.push('No publications found for this radicado');
      return jsonResponse({ ...result, provider_attempts: (fetchResult as any).provider_attempts || [] });
    }

    console.log(`[sync-publicaciones] Processing ${fetchResult.publicaciones.length} publications`);

    // ============= INGEST PUBLICATIONS WITH DEDUPLICATION =============
    let newestDate: string | null = null;

    for (const pub of fetchResult.publicaciones) {
      const publishedAt = parseDate(pub.published_at);
      const fingerprint = generatePublicacionFingerprint(pub.pdf_url, pub.title, pub.published_at);

      // Check for existing record using fingerprint
      const { data: existing } = await supabase
        .from('work_item_publicaciones')
        .select('id')
        .eq('work_item_id', work_item_id)
        .eq('hash_fingerprint', fingerprint)
        .maybeSingle();

      if (existing) {
        result.skipped_count++;
        continue;
      }

      // Parse deadline dates
      const fechaFijacion = parseDate(pub.fecha_fijacion);
      const fechaDesfijacion = parseDate(pub.fecha_desfijacion);

      // LOG: What we're about to insert
      console.log('[sync-publicaciones] Inserting record:', {
        title: pub.title?.slice(0, 50),
        published_at: pub.published_at,
        fecha_fijacion_raw: pub.fecha_fijacion,
        fecha_fijacion_parsed: fechaFijacion,
        fecha_desfijacion_raw: pub.fecha_desfijacion,
        fecha_desfijacion_parsed: fechaDesfijacion,
        despacho: pub.despacho,
        tipo_publicacion: pub.tipo_publicacion,
      });

      // Insert new publication - ALWAYS use parent work_item's organization_id for integrity
      // CRITICAL: Now includes fecha_fijacion, fecha_desfijacion, despacho, tipo_publicacion
      const { data: insertedPub, error: insertError } = await supabase
        .from('work_item_publicaciones')
        .insert({
          work_item_id,
          organization_id: workItem.organization_id, // CRITICAL: Always from parent work_item
          source: 'publicaciones-procesales',
          title: pub.title,
          annotation: pub.annotation || null,
          pdf_url: pub.pdf_url || null,
          published_at: publishedAt ? new Date(publishedAt + 'T12:00:00Z').toISOString() : null,
          // CRITICAL DEADLINE FIELDS - now properly stored in DB columns
          fecha_fijacion: fechaFijacion ? new Date(fechaFijacion + 'T12:00:00Z').toISOString() : null,
          fecha_desfijacion: fechaDesfijacion ? new Date(fechaDesfijacion + 'T12:00:00Z').toISOString() : null,
          despacho: pub.despacho || null,
          tipo_publicacion: pub.tipo_publicacion || null,
          hash_fingerprint: fingerprint,
          raw_data: pub.raw || null,
        })
        .select('id')
        .single();

      if (insertError) {
        // Check if it's a duplicate error (race condition)
        if (insertError.message?.includes('duplicate') || insertError.code === '23505') {
          result.skipped_count++;
        } else {
          console.error(`[sync-publicaciones] Insert error:`, insertError);
          result.errors.push(`Failed to insert publication: ${insertError.message}`);
        }
      } else {
        result.inserted_count++;
        if (publishedAt && (!newestDate || publishedAt > newestDate)) {
          newestDate = publishedAt;
        }
        
        // Calculate términos inician for response tracking
        const terminosInician = calculateNextBusinessDay(pub.fecha_desfijacion);
        
        // Track inserted publication for scheduled job response
        if (insertedPub?.id) {
          result.inserted.push({
            id: insertedPub.id,
            title: pub.title,
            pdf_url: pub.pdf_url || null,
            entry_url: pub.entry_url || null,
            fecha_fijacion: fechaFijacion,
            fecha_desfijacion: fechaDesfijacion,
            tipo_publicacion: pub.tipo_publicacion || null,
            terminos_inician: terminosInician,
          });
        }
        
        // ============= CREATE ALERT FOR NEW ESTADOS WITH DEADLINE =============
        // This helps lawyers track when términos begin
        if (fechaDesfijacion && insertedPub?.id) {
          try {
            await supabase.from('alert_instances').insert({
              owner_id: workItem.owner_id,
              organization_id: workItem.organization_id,
              entity_id: workItem.id,
              entity_type: 'WORK_ITEM',
              severity: 'info',
              title: `Nuevo Estado: ${pub.tipo_publicacion || 'Publicación'}`,
              message: `${pub.title}${terminosInician ? ` — Términos inician: ${terminosInician}` : ''}`,
              status: 'ACTIVE',
              payload: {
                publicacion_id: insertedPub.id,
                fecha_publicacion: pub.published_at,
                fecha_fijacion: pub.fecha_fijacion,
                fecha_desfijacion: pub.fecha_desfijacion,
                terminos_inician: terminosInician,
                despacho: pub.despacho,
                tipo_publicacion: pub.tipo_publicacion,
                pdf_url: pub.pdf_url,
              },
            });
            result.alerts_created++;
            console.log(`[sync-publicaciones] Created alert for estado: ${pub.title}, términos inician: ${terminosInician}`);
          } catch (alertErr) {
            console.warn('[sync-publicaciones] Failed to create alert:', alertErr);
            // Don't fail the whole sync if alert creation fails
          }
        }
      }
    }

    result.newest_publication_date = newestDate;
    
    // ============= LATEST ESTADO DETECTION =============
    // After all inserts, compute the "latest" publicación and check if it changed
    // This triggers a "NEW_LATEST_ESTADO" alert if the latest is different from baseline
    if (result.inserted_count > 0) {
      try {
        // Fetch all publicaciones for this work item to find the latest
        const { data: allPubs } = await supabase
          .from('work_item_publicaciones')
          .select('id, title, published_at, fecha_desfijacion, created_at, pdf_url, tipo_publicacion')
          .eq('work_item_id', work_item_id)
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(10);
        
        if (allPubs && allPubs.length > 0) {
          // The latest is the first one (most recent published_at)
          const latestPub = allPubs[0];
          
          // Generate fingerprint for the latest
          const latestFingerprint = generatePublicacionFingerprint(
            latestPub.pdf_url || null,
            latestPub.title,
            latestPub.published_at
          );
          
          // Fetch current baseline from work_item
          const { data: currentWorkItem } = await supabase
            .from('work_items')
            .select('latest_estado_fingerprint')
            .eq('id', work_item_id)
            .maybeSingle();
          
          const storedFingerprint = currentWorkItem?.latest_estado_fingerprint;
          
          // Check if latest has changed
          if (latestFingerprint !== storedFingerprint) {
            console.log(`[sync-publicaciones] NEW LATEST ESTADO detected!`, {
              work_item_id,
              old_fingerprint: storedFingerprint,
              new_fingerprint: latestFingerprint,
              latest_title: latestPub.title?.slice(0, 50),
            });
            
            // Update work_item baseline
            await supabase
              .from('work_items')
              .update({
                latest_estado_fingerprint: latestFingerprint,
                latest_estado_at: new Date().toISOString(),
              })
              .eq('id', work_item_id);
            
            // Create NEW_LATEST_ESTADO alert (different from per-item deadline alerts)
            const terminosInician = calculateNextBusinessDay(latestPub.fecha_desfijacion);
            
            await supabase.from('alert_instances').insert({
              owner_id: workItem.owner_id,
              organization_id: workItem.organization_id,
              entity_id: workItem.id,
              entity_type: 'WORK_ITEM',
              severity: 'info',
              title: `Nuevo Estado Detectado`,
              message: `${latestPub.tipo_publicacion || 'Estado'}: ${latestPub.title?.slice(0, 100)}${terminosInician ? ` — Términos inician: ${terminosInician}` : ''}`,
              status: 'ACTIVE',
              payload: {
                alert_type: 'NEW_LATEST_ESTADO',
                publicacion_id: latestPub.id,
                fingerprint: latestFingerprint,
                fecha_publicacion: latestPub.published_at,
                fecha_desfijacion: latestPub.fecha_desfijacion,
                terminos_inician: terminosInician,
                pdf_url: latestPub.pdf_url,
                radicado: workItem.radicado,
              },
            });
            
            result.alerts_created++;
            console.log(`[sync-publicaciones] Created NEW_LATEST_ESTADO alert`);
          } else {
            console.log(`[sync-publicaciones] Latest estado unchanged (fingerprint: ${latestFingerprint})`);
          }
        }
      } catch (latestErr) {
        console.warn('[sync-publicaciones] Failed to process latest estado detection:', latestErr);
        // Don't fail the sync
      }
    }
    
    result.ok = true;

    console.log(`[sync-publicaciones] Completed: inserted=${result.inserted_count}, skipped=${result.skipped_count}, alerts=${result.alerts_created}`);

    return jsonResponse(result);

  } catch (err) {
    console.error('[sync-publicaciones] Unhandled error:', err);
    return errorResponse(
      'INTERNAL_ERROR',
      err instanceof Error ? err.message : 'An unexpected error occurred',
      500
    );
  }
});
