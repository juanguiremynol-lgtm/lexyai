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

// Extract date from title like "REGISTRO 1 DE JULIO DE 2024.pdf"
function extractDateFromTitle(title: string): string | undefined {
  const dateMatch = title.match(/(\d{1,2})\s+DE\s+(\w+)\s+DE\s+(\d{4})/i);
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const monthName = dateMatch[2].toUpperCase();
    const year = dateMatch[3];
    const month = SPANISH_MONTHS[monthName];
    if (month) {
      return `${year}-${month}-${day}`;
    }
  }
  return undefined;
}

/**
 * POLLING-BASED STRATEGY for Publicaciones API
 * 
 * The /snapshot endpoint does NOT exist - every call returns 404.
 * This caused infinite scraping loops where each sync created new jobs.
 * 
 * NEW FLOW:
 * 1. Call /buscar to trigger scraping job
 * 2. Poll /resultado/{job_id} every 5s for up to 60s
 * 3. If polling times out, try fallback direct query: GET /publicaciones?radicado=XXX
 * 4. Return results when job completes or fallback succeeds
 * 
 * This eliminates infinite loops and returns results immediately.
 */
async function fetchPublicaciones(radicado: string): Promise<FetchPublicacionesResult> {
  const startTime = Date.now();
  const baseUrl = Deno.env.get('PUBLICACIONES_BASE_URL');
  // Support provider-specific key with fallback
  const apiKey = Deno.env.get('PUBLICACIONES_X_API_KEY') || Deno.env.get('EXTERNAL_X_API_KEY');

  console.log(`[sync-publicaciones] === STARTING FETCH ===`);
  console.log(`[sync-publicaciones] Radicado: ${radicado}`);
  console.log(`[sync-publicaciones] Base URL configured: ${!!baseUrl}`);
  console.log(`[sync-publicaciones] API Key present: ${!!apiKey}, length: ${apiKey?.length || 0}`);

  if (!baseUrl) {
    console.log('[sync-publicaciones] PUBLICACIONES_BASE_URL not configured');
    return {
      ok: false,
      publicaciones: [],
      error: 'Publicaciones API not configured (missing PUBLICACIONES_BASE_URL)',
      latencyMs: Date.now() - startTime,
    };
  }

  if (!apiKey) {
    console.log('[sync-publicaciones] API key not configured (PUBLICACIONES_X_API_KEY or EXTERNAL_X_API_KEY)');
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
  let lastResultData: Record<string, unknown> | null = null;

  try {
    // Step 1: Trigger scraping job via /buscar
    const buscarUrl = `${cleanBaseUrl}/buscar?radicado=${radicado}`;
    console.log(`[sync-publicaciones] Step 1: Triggering scraping job`);
    console.log(`[sync-publicaciones] Calling: ${buscarUrl}`);

    const buscarResponse = await fetch(buscarUrl, {
      method: 'GET',
      headers,
    });

    console.log(`[sync-publicaciones] /buscar response status: ${buscarResponse.status}`);

    if (!buscarResponse.ok) {
      const errorText = await buscarResponse.text();
      console.error(`[sync-publicaciones] Scraping trigger failed: HTTP ${buscarResponse.status}`, errorText);
      return {
        ok: false,
        publicaciones: [],
        error: `Scraping trigger failed: HTTP ${buscarResponse.status}`,
        latencyMs: Date.now() - startTime,
        httpStatus: buscarResponse.status,
      };
    }

    const buscarData = await buscarResponse.json();
    console.log(`[sync-publicaciones] /buscar response body:`, JSON.stringify(buscarData).substring(0, 500));
    
    const jobId = buscarData.job_id || buscarData.jobId;

    if (!jobId) {
      console.error('[sync-publicaciones] No job_id in response:', buscarData);
      return {
        ok: false,
        publicaciones: [],
        error: 'No job_id returned from scraping API',
        latencyMs: Date.now() - startTime,
      };
    }

    console.log(`[sync-publicaciones] Step 2: Scraping job created: ${jobId}, polling for results...`);

    // Step 2: Poll /resultado/{job_id} for completion
    const resultadoUrl = `${cleanBaseUrl}/resultado/${jobId}`;
    const maxAttempts = 12; // 12 attempts x 5 seconds = 60 seconds max
    const pollIntervalMs = 5000; // 5 seconds between polls

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Wait before polling (except first attempt)
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }

      console.log(`[sync-publicaciones] Poll ${attempt}/${maxAttempts}: ${resultadoUrl}`);

      const resultResponse = await fetch(resultadoUrl, {
        method: 'GET',
        headers,
      });

      console.log(`[sync-publicaciones] Poll ${attempt}: HTTP ${resultResponse.status}`);

      if (!resultResponse.ok) {
        console.log(`[sync-publicaciones] Poll ${attempt}: HTTP error ${resultResponse.status}, continuing...`);
        continue;
      }

      const data = await resultResponse.json();
      lastResultData = data;
      const status = data.status;

      console.log(`[sync-publicaciones] Poll ${attempt}: status="${status}", keys=${Object.keys(data).join(',')}`);

      // Job still processing
      if (status === 'queued' || status === 'processing' || status === 'running' || status === 'pending') {
        console.log(`[sync-publicaciones] Job still ${status}, waiting...`);
        continue;
      }

      // Job completed successfully - accept multiple success status values
      if (status === 'done' || status === 'completed' || status === 'success' || status === 'finished') {
        console.log('[sync-publicaciones] Job completed! Extracting results...');
        return extractPublicacionesFromResponse(data, startTime);
      }

      // Job failed
      if (status === 'failed' || status === 'error') {
        const errorMsg = data.error || data.message || 'Unknown error';
        console.error(`[sync-publicaciones] Job failed: ${errorMsg}`);
        return {
          ok: false,
          publicaciones: [],
          error: `Scraping job failed: ${errorMsg}`,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // Polling timeout - try FALLBACK DIRECT QUERY
    console.log(`[sync-publicaciones] === POLLING TIMEOUT after ${maxAttempts * pollIntervalMs / 1000}s ===`);
    console.log(`[sync-publicaciones] Last response was:`, JSON.stringify(lastResultData).substring(0, 500));
    console.log(`[sync-publicaciones] Step 3: Trying fallback direct endpoint...`);

    const fallbackResult = await fetchPublicacionesFallback(radicado, apiKey, cleanBaseUrl);
    if (fallbackResult) {
      console.log(`[sync-publicaciones] Fallback succeeded! Found ${fallbackResult.length} publications`);
      return {
        ok: true,
        publicaciones: fallbackResult,
        latencyMs: Date.now() - startTime,
        httpStatus: 200,
      };
    }

    console.error(`[sync-publicaciones] Fallback also failed. Returning timeout error.`);
    return {
      ok: false,
      publicaciones: [],
      error: `Scraping timeout - job did not complete within ${maxAttempts * pollIntervalMs / 1000} seconds and fallback failed`,
      latencyMs: Date.now() - startTime,
    };

  } catch (err) {
    console.error('[sync-publicaciones] Fetch error:', err);
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
    // Extract date from title if not provided
    let publishedAt = pub.published_at || pub.fecha_publicacion || pub.fecha;
    if (!publishedAt && pub.title) {
      publishedAt = extractDateFromTitle(String(pub.title));
    }

    return {
      title: String(pub.title || pub.titulo || 'Sin título'),
      annotation: pub.annotation || pub.anotacion || pub.detalle
        ? String(pub.annotation || pub.anotacion || pub.detalle)
        : undefined,
      pdf_url: pub.pdf_url ? String(pub.pdf_url) : undefined,
      entry_url: pub.entry_url ? String(pub.entry_url) : undefined,
      pdf_available: Boolean(pub.pdf_available ?? true),
      published_at: publishedAt ? String(publishedAt) : undefined,
      fecha_fijacion: extractDateString(pub, ['fecha_fijacion', 'fijacion', 'fecha_inicio', 'start_date']),
      fecha_desfijacion: extractDateString(pub, ['fecha_desfijacion', 'desfijacion', 'fecha_fin', 'end_date', 'fecha_retiro']),
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
      // If scraping was initiated, return 202 with scraping info
      if (fetchResult.scrapingInitiated) {
        return jsonResponse({
          ...result,
          ok: false,
          scrapingInitiated: true,
          scrapingJobId: fetchResult.scrapingJobId,
          scrapingMessage: fetchResult.scrapingMessage,
          errors: [fetchResult.scrapingMessage || 'Búsqueda iniciada'],
        }, 202);
      }
      
      result.errors.push(fetchResult.error || 'Failed to fetch publications');
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
