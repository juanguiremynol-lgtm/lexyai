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
async function fetchPublicaciones(radicado: string): Promise<FetchPublicacionesResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('PUBLICACIONES_BASE_URL');
  const apiKey = Deno.env.get('PUBLICACIONES_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY');

  console.log(`[sync-pub] === STARTING FETCH ===`);
  console.log(`[sync-pub] Radicado: ${radicado}`);
  console.log(`[sync-pub] Base URL: ${baseUrl ? 'configured' : 'MISSING'}`);
  console.log(`[sync-pub] API Key: present=${!!apiKey}, length=${apiKey?.length || 0}`);

  if (!baseUrl) {
    return {
      ok: false,
      publicaciones: [],
      error: 'PUBLICACIONES_BASE_URL not configured',
      latencyMs: Date.now() - startTime,
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      publicaciones: [],
      error: 'API key not configured',
      latencyMs: Date.now() - startTime,
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-api-key': apiKey,
  };

  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');

  try {
    // ========= STEP 1: Call /buscar (triggers scraping or returns deduped) =========
    const buscarUrl = `${cleanBaseUrl}/buscar?radicado=${radicado}`;
    console.log(`[sync-pub] Step 1: Calling /buscar: ${buscarUrl}`);

    const buscarResponse = await fetch(buscarUrl, { method: 'GET', headers });
    console.log(`[sync-pub] /buscar HTTP status: ${buscarResponse.status}`);

    if (!buscarResponse.ok) {
      const errorText = await buscarResponse.text();
      console.error(`[sync-pub] /buscar failed: ${buscarResponse.status}`, errorText.slice(0, 200));
      return {
        ok: false,
        publicaciones: [],
        error: `Buscar failed: HTTP ${buscarResponse.status}`,
        latencyMs: Date.now() - startTime,
        httpStatus: buscarResponse.status,
      };
    }

    const buscarData = await buscarResponse.json();
    // CRITICAL: Log FULL /buscar response to see ALL fields
    console.log(`[sync-pub] FULL /buscar response:`, JSON.stringify(buscarData));

    const jobId = buscarData.job_id || buscarData.jobId;
    const isDeduped = buscarData.deduped === true;
    const isDone = buscarData.status === 'done' || buscarData.status === 'completed';

    // ========= CASE 1: Job already done (deduped with inline result) =========
    if (isDone && buscarData.result) {
      console.log(`[sync-pub] /buscar returned completed result directly!`);
      return extractPublicacionesFromResponse(buscarData, startTime);
    }

    // ========= CASE 2: "cached" job_id with no inline result — try fallbacks first, then poll if real job_id =========
    // IMPORTANT: Only skip to fallbacks if job_id === 'cached' (can't poll) 
    // If we have a real job_id, we can poll it even if deduped=true
    if (jobId === 'cached') {
      console.log(`[sync-pub] Job was cached (job_id=cached). Trying fallbacks first...`);
      
      // Fallback A: Try /snapshot?radicado=XXX
      console.log(`[sync-pub] Fallback A: /snapshot?radicado=${radicado}`);
      try {
        const snapshotUrl = `${cleanBaseUrl}/snapshot?radicado=${radicado}`;
        const snapshotResponse = await fetch(snapshotUrl, { method: 'GET', headers });
        console.log(`[sync-pub] /snapshot HTTP ${snapshotResponse.status}`);
        
        if (snapshotResponse.ok) {
          const snapshotData = await snapshotResponse.json();
          console.log(`[sync-pub] /snapshot response:`, JSON.stringify(snapshotData).slice(0, 500));
          const result = snapshotData.result || snapshotData;
          const publications = result.results || result.publicaciones || result.estados || [];
          
          if (publications.length > 0) {
            console.log(`[sync-pub] Fallback A SUCCESS: /snapshot returned ${publications.length} publications`);
            return extractPublicacionesFromResponse(snapshotData, startTime);
          }
        }
        console.log(`[sync-pub] Fallback A: /snapshot returned no data`);
      } catch (snapshotErr) {
        console.log(`[sync-pub] Fallback A: /snapshot failed:`, snapshotErr);
      }

      // Fallback B: Try /publicaciones/{radicado} (path-based direct lookup)
      console.log(`[sync-pub] Fallback B: /publicaciones/${radicado} (path-based)`);
      try {
        const directPathUrl = `${cleanBaseUrl}/publicaciones/${radicado}`;
        const directPathResponse = await fetch(directPathUrl, { method: 'GET', headers });
        console.log(`[sync-pub] /publicaciones/{radicado} HTTP ${directPathResponse.status}`);
        
        if (directPathResponse.ok) {
          const directPathData = await directPathResponse.json();
          console.log(`[sync-pub] /publicaciones/{radicado} response:`, JSON.stringify(directPathData).slice(0, 500));
          
          // Try to extract publications
          const result = directPathData.result || directPathData;
          const publications = result.results || result.publicaciones || result.data || result.estados || [];
          
          if (Array.isArray(publications) && publications.length > 0) {
            console.log(`[sync-pub] Fallback B SUCCESS: /publicaciones/{radicado} returned ${publications.length} publications!`);
            return extractPublicacionesFromResponse(directPathData, startTime);
          }
          
          // Maybe the response IS the array directly
          if (Array.isArray(directPathData) && directPathData.length > 0) {
            console.log(`[sync-pub] Fallback B SUCCESS: Response is array with ${directPathData.length} items`);
            return extractPublicacionesFromResponse({ result: { results: directPathData } }, startTime);
          }
        }
        console.log(`[sync-pub] Fallback B: /publicaciones/{radicado} returned no usable data`);
      } catch (directPathErr) {
        console.log(`[sync-pub] Fallback B: /publicaciones/{radicado} failed:`, directPathErr);
      }

      // Fallback C: Try /publicaciones?radicado=XXX (query-param variant)
      console.log(`[sync-pub] Fallback C: /publicaciones?radicado=${radicado} (query-param)`);
      try {
        const directQueryUrl = `${cleanBaseUrl}/publicaciones?radicado=${radicado}`;
        const directQueryResponse = await fetch(directQueryUrl, { method: 'GET', headers });
        console.log(`[sync-pub] /publicaciones?radicado HTTP ${directQueryResponse.status}`);
        
        if (directQueryResponse.ok) {
          const directQueryData = await directQueryResponse.json();
          console.log(`[sync-pub] /publicaciones?radicado response:`, JSON.stringify(directQueryData).slice(0, 500));
          
          const result = directQueryData.result || directQueryData;
          const publications = result.results || result.publicaciones || result.data || [];
          
          if (Array.isArray(publications) && publications.length > 0) {
            console.log(`[sync-pub] Fallback C SUCCESS: /publicaciones?radicado returned ${publications.length} publications!`);
            return extractPublicacionesFromResponse(directQueryData, startTime);
          }
          
          if (Array.isArray(directQueryData) && directQueryData.length > 0) {
            console.log(`[sync-pub] Fallback C SUCCESS: Response is array with ${directQueryData.length} items`);
            return extractPublicacionesFromResponse({ result: { results: directQueryData } }, startTime);
          }
        }
        console.log(`[sync-pub] Fallback C: /publicaciones?radicado returned no usable data`);
      } catch (directQueryErr) {
        console.log(`[sync-pub] Fallback C: /publicaciones?radicado failed:`, directQueryErr);
      }

      // Fallback D: Try /buscar?radicado=XXX&force=true to bypass dedup
      console.log(`[sync-pub] Fallback D: /buscar?force=true to bypass dedup`);
      try {
        const forceUrl = `${cleanBaseUrl}/buscar?radicado=${radicado}&force=true`;
        const forceResponse = await fetch(forceUrl, { method: 'GET', headers });
        console.log(`[sync-pub] /buscar?force=true HTTP ${forceResponse.status}`);
        
        if (forceResponse.ok) {
          const forceData = await forceResponse.json();
          console.log(`[sync-pub] /buscar?force=true response:`, JSON.stringify(forceData).slice(0, 500));
          
          const forceJobId = forceData.job_id || forceData.jobId;
          
          // If force returned inline result
          if ((forceData.status === 'done' || forceData.status === 'completed') && forceData.result) {
            console.log(`[sync-pub] Fallback D SUCCESS: /buscar?force returned inline result`);
            return extractPublicacionesFromResponse(forceData, startTime);
          }
          
          // If we got a REAL job_id (not "cached"), poll for it - even if deduped=true
          // The job might still be processing and could complete with data
          if (forceJobId && forceJobId !== 'cached') {
            console.log(`[sync-pub] Fallback D: Got job_id=${forceJobId} (deduped=${forceData.deduped}), polling...`);
            return await pollForResults(cleanBaseUrl, forceJobId, headers, radicado, startTime);
          }
        }
        console.log(`[sync-pub] Fallback D: /buscar?force=true did not help`);
      } catch (forceErr) {
        console.log(`[sync-pub] Fallback D: /buscar?force=true failed:`, forceErr);
      }

      // All fallbacks failed
      console.log(`[sync-pub] All dedup fallbacks exhausted. This radicado may not have publicaciones.`);
      return {
        ok: false,
        publicaciones: [],
        error: 'No publications found (deduped, all fallbacks exhausted)',
        isEmpty: true,
        latencyMs: Date.now() - startTime,
      };
    }

    // ========= CASE 3: New job created — use pollForResults helper =========
    if (!jobId) {
      console.log(`[sync-pub] No job_id in /buscar response`);
      return {
        ok: false,
        publicaciones: [],
        error: 'No job_id returned from API',
        latencyMs: Date.now() - startTime,
      };
    }

    console.log(`[sync-pub] Step 2: Got real job_id=${jobId}, using pollForResults helper...`);
    return await pollForResults(cleanBaseUrl, jobId, headers, radicado, startTime);

  } catch (err) {
    console.error('[sync-pub] Fetch error:', err);
    return {
      ok: false,
      publicaciones: [],
      error: err instanceof Error ? err.message : 'Fetch failed',
      latencyMs: Date.now() - startTime,
      httpStatus: 0,
    };
  }
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

    if (!fetchResult.ok) {
      // ============= HANDLE SCRAPING IN PROGRESS (NOT A HARD ERROR) =============
      // If polling timed out but scraping is still processing, return a retryable status
      if (fetchResult.status === 'SCRAPING_IN_PROGRESS' || fetchResult.status === 'SCRAPING_TIMEOUT') {
        console.log(`[sync-publicaciones] Scraping still in progress: ${fetchResult.status}, job_id=${fetchResult.scrapingJobId}`);
        return jsonResponse({
          ...result,
          ok: false,
          status: fetchResult.status,
          scrapingInitiated: true,
          scrapingJobId: fetchResult.scrapingJobId,
          scrapingMessage: fetchResult.error || `Scraping en progreso (${fetchResult.status})`,
          retryAfterSeconds: fetchResult.retryAfterSeconds || 60,
          errors: [fetchResult.error || 'Scraping en progreso, reintente en 60 segundos'],
        }, 202); // 202 Accepted = operation started but not complete
      }
      
      // If scraping was initiated (legacy path)
      if (fetchResult.scrapingInitiated) {
        return jsonResponse({
          ...result,
          ok: false,
          status: 'SCRAPING_IN_PROGRESS',
          scrapingInitiated: true,
          scrapingJobId: fetchResult.scrapingJobId,
          scrapingMessage: fetchResult.scrapingMessage,
          retryAfterSeconds: 60,
          errors: [fetchResult.scrapingMessage || 'Búsqueda iniciada'],
        }, 202);
      }
      
      // Actual hard error
      result.errors.push(fetchResult.error || 'Failed to fetch publications');
      result.status = 'ERROR';
      return jsonResponse(result);
    }

    if (fetchResult.publicaciones.length === 0) {
      result.ok = true;
      result.warnings.push('No publications found for this radicado');
      return jsonResponse(result);
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
