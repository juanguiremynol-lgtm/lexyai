/**
 * sync-publicaciones-by-work-item Edge Function
 * 
 * Syncs court publications (estados electrónicos, edictos, PDFs) for registered work items.
 * 
 * Features:
 * - Multi-tenant safe: validates user is member of work_item's organization
 * - Only for work items with a valid 23-digit radicado
 * - Fetches from PUBLICACIONES_BASE_URL using EXTERNAL_X_API_KEY
 * - Stores metadata + PDF URLs in work_item_publicaciones table
 * - Idempotent: uses hash_fingerprint to prevent duplicates
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
}

interface SyncResult {
  ok: boolean;
  work_item_id: string;
  inserted_count: number;
  skipped_count: number;
  newest_publication_date: string | null;
  warnings: string[];
  errors: string[];
}

interface PublicacionRaw {
  title: string;
  annotation?: string;
  pdf_url?: string;
  published_at?: string;
  source_id?: string;
  raw?: Record<string, unknown>;
}

interface FetchResult {
  ok: boolean;
  publicaciones: PublicacionRaw[];
  error?: string;
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

// ============= PUBLICACIONES API PROVIDER =============
// CRITICAL FIX: Use query-param format /publicaciones?radicado={radicado}
// NOT path-based format /publicaciones/{radicado}

interface FetchPublicacionesResult extends FetchResult {
  scrapingInitiated?: boolean;
  scrapingJobId?: string;
  scrapingPollUrl?: string;
  scrapingMessage?: string;
}

async function fetchPublicaciones(radicado: string): Promise<FetchPublicacionesResult> {
  const baseUrl = Deno.env.get('PUBLICACIONES_BASE_URL');
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    console.log('[sync-publicaciones] PUBLICACIONES_BASE_URL not configured');
    return { 
      ok: false, 
      publicaciones: [], 
      error: 'Publicaciones API not configured (missing PUBLICACIONES_BASE_URL). Contact administrator.' 
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    // FIXED: Use query-param format (not path-based)
    const url = `${baseUrl.replace(/\/+$/, '')}/publicaciones?radicado=${radicado}`;
    console.log(`[sync-publicaciones] Calling: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[sync-publicaciones] No publications found (404) for ${radicado}. Auto-triggering scraping...`);
        
        // AUTO-SCRAPING: Try /buscar endpoint to initiate async scraping
        const buscarUrl = `${baseUrl.replace(/\/+$/, '')}/buscar?radicado=${radicado}`;
        console.log(`[sync-publicaciones] Triggering scraping: ${buscarUrl}`);
        
        try {
          const buscarResponse = await fetch(buscarUrl, {
            method: 'GET',
            headers,
          });
          
          if (buscarResponse.ok) {
            const buscarData = await buscarResponse.json();
            const jobId = String(buscarData.jobId || buscarData.job_id || buscarData.id || '');
            const pollUrl = String(buscarData.poll_url || buscarData.pollUrl || '');
            
            if (jobId) {
              console.log(`[sync-publicaciones] Scraping job created: jobId=${jobId}`);
              return { 
                ok: false, 
                publicaciones: [], 
                error: 'RECORD_NOT_FOUND',
                scrapingInitiated: true,
                scrapingJobId: jobId,
                scrapingPollUrl: pollUrl || `${baseUrl}/resultado/${jobId}`,
                scrapingMessage: `No publications found. Scraping initiated (job ${jobId}). Retry in 30-60 seconds.`,
              };
            }
          }
        } catch (buscarErr) {
          console.warn('[sync-publicaciones] Scraping trigger failed:', buscarErr);
        }
        
        // If scraping failed or no jobId, return empty result
        return { ok: true, publicaciones: [] };
      }
      const errorText = await response.text();
      console.log(`[sync-publicaciones] HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      return { 
        ok: false, 
        publicaciones: [], 
        error: `HTTP ${response.status}` 
      };
    }

    const data = await response.json();
    
    // Extract publications array - support multiple response formats
    const publicaciones = data.publicaciones || data.estados || data.documents || [];
    
    console.log(`[sync-publicaciones] Found ${publicaciones.length} publications for ${radicado}`);
    
    return {
      ok: true,
      publicaciones: publicaciones.map((pub: Record<string, unknown>) => ({
        title: String(pub.titulo || pub.title || pub.tipo_publicacion || pub.descripcion || 'Sin título'),
        annotation: pub.anotacion || pub.annotation || pub.detalle ? String(pub.anotacion || pub.annotation || pub.detalle) : undefined,
        pdf_url: pub.pdf_url || pub.url || pub.documento_url ? String(pub.pdf_url || pub.url || pub.documento_url) : undefined,
        published_at: pub.fecha_publicacion || pub.published_at || pub.fecha ? String(pub.fecha_publicacion || pub.published_at || pub.fecha) : undefined,
        source_id: pub.id ? String(pub.id) : undefined,
        raw: pub as Record<string, unknown>,
      })),
    };
  } catch (err) {
    console.error('[sync-publicaciones] Fetch error:', err);
    return { 
      ok: false, 
      publicaciones: [], 
      error: err instanceof Error ? err.message : 'Publicaciones API failed' 
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

    console.log(`[sync-publicaciones] Starting sync for work_item_id=${work_item_id}, user=${userId}`);

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
      newest_publication_date: null,
      warnings: [],
      errors: [],
    };

    // ============= FETCH PUBLICACIONES =============
    const fetchResult = await fetchPublicaciones(normalizedRadicado);

    if (!fetchResult.ok) {
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

      // Insert new publication - ALWAYS use parent work_item's organization_id for integrity
      const { error: insertError } = await supabase
        .from('work_item_publicaciones')
        .insert({
          work_item_id,
          organization_id: workItem.organization_id, // CRITICAL: Always from parent work_item
          source: 'publicaciones-procesales',
          title: pub.title,
          annotation: pub.annotation || null,
          pdf_url: pub.pdf_url || null,
          published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
          hash_fingerprint: fingerprint,
          raw_data: pub.raw || null,
        });

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
      }
    }

    result.newest_publication_date = newestDate;
    result.ok = true;

    console.log(`[sync-publicaciones] Completed: inserted=${result.inserted_count}, skipped=${result.skipped_count}`);

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
