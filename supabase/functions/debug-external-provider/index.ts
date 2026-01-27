/**
 * debug-external-provider Edge Function
 * 
 * Proxies debug requests to external judicial APIs using configured secrets.
 * 
 * Features:
 * - Platform admins or org admins only
 * - Calls CPNU, SAMAI, TUTELAS, or PUBLICACIONES providers
 * - Returns status, latency, summary, and raw response
 * - Truncates large arrays to safe limits (200 items)
 * - Never exposes secrets in logs or responses
 * - **NEW**: Route probing for CPNU when route missing (HTML 404)
 * - **NEW**: Structured error classification (ROUTE_MISSING vs RECORD_NOT_FOUND)
 * 
 * Input: { provider, identifier: { radicado?, tutela_code? }, mode, timeoutMs }
 * Output: { provider_used, status, latencyMs, summary, raw, truncated, limits, error_code?, retried, attempts }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= CONSTANTS =============

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 30000;
const MAX_ARRAY_ITEMS = 200;
const MAX_RAW_SIZE = 100000;

// ============= ROUTE CANDIDATES =============
// When CPNU returns HTML "Cannot GET", try these paths in order

const CPNU_ROUTE_CANDIDATES = [
  '/proceso/{id}',
  '/api/proceso/{id}',
  '/v1/proceso/{id}',
  '/cgp/proceso/{id}',
  '/api/v1/proceso/{id}',
];

const SAMAI_ROUTE_CANDIDATES = [
  '/proceso/{id}',
  '/api/proceso/{id}',
];

const TUTELAS_ROUTE_CANDIDATES = [
  '/expediente/{id}',
  '/api/expediente/{id}',
];

const PUBLICACIONES_ROUTE_CANDIDATES = [
  '/publicaciones/{id}',
  '/api/publicaciones/{id}',
];

// ============= TYPES =============

type ProviderName = 'cpnu' | 'samai' | 'tutelas' | 'publicaciones';

interface DebugRequest {
  provider: ProviderName;
  identifier: {
    radicado?: string | null;
    tutela_code?: string | null;
  };
  mode?: 'lookup' | 'raw';
  timeoutMs?: number;
}

interface DebugSummary {
  found: boolean;
  actuacionesCount?: number;
  estadosCount?: number;
  publicacionesCount?: number;
  hasExpediente?: boolean;
  hasDocuments?: boolean;
  despacho?: string;
  tipoProceso?: string;
}

interface TruncationLimits {
  actuaciones?: { shown: number; total: number };
  estados?: { shown: number; total: number };
  publicaciones?: { shown: number; total: number };
  sujetos_procesales?: { shown: number; total: number };
}

interface RouteAttempt {
  path: string;
  http_status: number;
  latency_ms: number;
  response_kind: 'JSON' | 'HTML_CANNOT_GET' | 'HTML_OTHER' | 'EMPTY' | 'ERROR';
  error?: string;
}

interface DebugResult {
  ok: boolean;
  provider_used: string;
  // Enhanced diagnostics (no secrets exposed)
  request_url_masked?: string; // Masked URL: <PROVIDER>/path
  request_path?: string; // Path only, no host/secrets
  request_method?: string;
  status: number;
  latencyMs: number;
  summary: DebugSummary;
  raw: unknown;
  error_code?: string;
  message?: string;
  truncated: boolean;
  limits?: TruncationLimits;
  retried: boolean;
  // Route probing results
  attempts?: RouteAttempt[];
  route_probing_used?: boolean;
  // Debug body snippet for errors
  _debug_body_snippet?: string;
}

// ============= HELPERS =============

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number = 400, latencyMs: number = 0): Response {
  const result: DebugResult = {
    ok: false,
    provider_used: 'none',
    status,
    latencyMs,
    summary: { found: false },
    raw: null,
    error_code: code,
    message,
    truncated: false,
    retried: false,
  };
  return jsonResponse(result, status);
}

function normalizeRadicado(radicado: string): string {
  return radicado.replace(/\D/g, '');
}

function isValidRadicado(radicado: string): boolean {
  return normalizeRadicado(radicado).length === 23;
}

function isValidTutelaCode(code: string): boolean {
  return /^T\d{6,10}$/i.test(code);
}

// Safe URL join that handles trailing slashes
function safeJoinUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

// Mask host in URL for safe logging/UI display
function maskHost(provider: ProviderName): string {
  const masks: Record<ProviderName, string> = {
    cpnu: '<CPNU>',
    samai: '<SAMAI>',
    tutelas: '<TUTELAS>',
    publicaciones: '<PUBLICACIONES>',
  };
  return masks[provider] || '<PROVIDER>';
}

// Detect if response body looks like HTML "Cannot GET" (Express 404)
function isHtmlCannotGet(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes('cannot get') ||
    lower.includes('<!doctype html') ||
    lower.includes('<html') ||
    lower.includes('not found</pre>')
  );
}

// Classify response kind
function classifyResponseKind(body: string, status: number): RouteAttempt['response_kind'] {
  if (!body || body.trim() === '') return 'EMPTY';
  
  try {
    JSON.parse(body);
    return 'JSON';
  } catch {
    // Not JSON
    if (isHtmlCannotGet(body)) {
      return 'HTML_CANNOT_GET';
    }
    return 'HTML_OTHER';
  }
}

// Classify error code based on response
function classifyErrorCode(
  httpStatus: number,
  responseKind: RouteAttempt['response_kind'],
  jsonData?: unknown
): string {
  // Route missing (HTML 404 with "Cannot GET")
  if (httpStatus === 404 && responseKind === 'HTML_CANNOT_GET') {
    return 'UPSTREAM_ROUTE_MISSING';
  }
  
  // Record not found (JSON 404 or JSON with found=false)
  if (httpStatus === 404 && responseKind === 'JSON') {
    return 'RECORD_NOT_FOUND';
  }
  
  // Check JSON body for not-found indicators
  if (responseKind === 'JSON' && jsonData && typeof jsonData === 'object') {
    const obj = jsonData as Record<string, unknown>;
    if (obj.found === false || obj.expediente_encontrado === false) {
      return 'RECORD_NOT_FOUND';
    }
  }
  
  // Auth errors
  if (httpStatus === 401) return 'UPSTREAM_AUTH';
  if (httpStatus === 403) return 'UPSTREAM_FORBIDDEN';
  
  // Server errors
  if (httpStatus >= 500) return 'UPSTREAM_UNAVAILABLE';
  
  // Generic
  if (httpStatus >= 400) return `HTTP_${httpStatus}`;
  
  return 'UNKNOWN';
}

function truncateRaw(raw: unknown): { data: unknown; truncated: boolean; limits: TruncationLimits } {
  const limits: TruncationLimits = {};
  let truncated = false;

  if (typeof raw !== 'object' || raw === null) {
    return { data: raw, truncated: false, limits };
  }

  const result = { ...raw } as Record<string, unknown>;
  const arrayKeys = ['actuaciones', 'estados', 'publicaciones', 'sujetos_procesales'] as const;

  for (const key of arrayKeys) {
    if (Array.isArray(result[key])) {
      const arr = result[key] as unknown[];
      if (arr.length > MAX_ARRAY_ITEMS) {
        result[key] = arr.slice(0, MAX_ARRAY_ITEMS);
        limits[key] = { shown: MAX_ARRAY_ITEMS, total: arr.length };
        truncated = true;
      }
    }
  }

  // Also truncate nested proceso.actuaciones if present
  if (typeof result.proceso === 'object' && result.proceso !== null) {
    const proceso = result.proceso as Record<string, unknown>;
    if (Array.isArray(proceso.actuaciones) && proceso.actuaciones.length > MAX_ARRAY_ITEMS) {
      limits.actuaciones = { shown: MAX_ARRAY_ITEMS, total: proceso.actuaciones.length };
      proceso.actuaciones = proceso.actuaciones.slice(0, MAX_ARRAY_ITEMS);
      result.proceso = proceso;
      truncated = true;
    }
  }

  // Final size check
  const jsonStr = JSON.stringify(result);
  if (jsonStr.length > MAX_RAW_SIZE) {
    return {
      data: {
        _truncated: true,
        _message: `Response too large (${jsonStr.length} bytes). Array limits applied but size still exceeds ${MAX_RAW_SIZE} bytes.`,
        _limits: limits,
      },
      truncated: true,
      limits,
    };
  }

  return { data: result, truncated, limits };
}

// ============= SAFE LOGGING =============

function safeLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  context: { 
    provider?: string; 
    status?: number; 
    latencyMs?: number; 
    org_id?: string; 
    work_item_id?: string;
    user_id?: string;
    error_code?: string;
    request_path?: string;
  }
) {
  // Never log EXTERNAL_X_API_KEY or sensitive headers
  const safeContext = {
    provider: context.provider,
    status: context.status,
    latencyMs: context.latencyMs,
    org_id: context.org_id?.slice(0, 8) + '...',
    work_item_id: context.work_item_id?.slice(0, 8) + '...',
    user_id: context.user_id?.slice(0, 8) + '...',
    error_code: context.error_code,
    request_path: context.request_path,
  };

  const logMessage = `[debug-external-provider] ${message}`;
  
  switch (level) {
    case 'info':
      console.log(logMessage, JSON.stringify(safeContext));
      break;
    case 'warn':
      console.warn(logMessage, JSON.stringify(safeContext));
      break;
    case 'error':
      console.error(logMessage, JSON.stringify(safeContext));
      break;
  }
}

// ============= PROVIDER CALLS WITH ROUTE PROBING =============

function getRouteCandidates(provider: ProviderName): string[] {
  switch (provider) {
    case 'cpnu': return CPNU_ROUTE_CANDIDATES;
    case 'samai': return SAMAI_ROUTE_CANDIDATES;
    case 'tutelas': return TUTELAS_ROUTE_CANDIDATES;
    case 'publicaciones': return PUBLICACIONES_ROUTE_CANDIDATES;
  }
}

async function callProviderWithProbing(
  provider: ProviderName,
  identifier: string,
  timeoutMs: number
): Promise<{ 
  status: number; 
  data: unknown; 
  error_code?: string; 
  message?: string;
  request_path?: string;
  body_snippet?: string;
  attempts: RouteAttempt[];
  route_probing_used: boolean;
}> {
  const envMap: Record<ProviderName, string> = {
    cpnu: 'CPNU_BASE_URL',
    samai: 'SAMAI_BASE_URL',
    tutelas: 'TUTELAS_BASE_URL',
    publicaciones: 'PUBLICACIONES_BASE_URL',
  };

  const baseUrl = Deno.env.get(envMap[provider]);
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    return { 
      status: 0, 
      data: null, 
      error_code: 'PROVIDER_NOT_CONFIGURED', 
      message: `${envMap[provider]} not configured`,
      request_path: undefined,
      attempts: [],
      route_probing_used: false,
    };
  }

  const routeCandidates = getRouteCandidates(provider);
  const attempts: RouteAttempt[] = [];
  let routeProbingUsed = false;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  for (let i = 0; i < routeCandidates.length; i++) {
    const pathTemplate = routeCandidates[i];
    const requestPath = pathTemplate.replace('{id}', identifier);
    const fullUrl = safeJoinUrl(baseUrl, requestPath);
    const attemptStart = Date.now();

    safeLog('info', `Attempting route ${i + 1}/${routeCandidates.length}`, { 
      provider, 
      request_path: requestPath,
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(fullUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - attemptStart;
      const bodyText = await response.text();
      const responseKind = classifyResponseKind(bodyText, response.status);

      const attempt: RouteAttempt = {
        path: requestPath,
        http_status: response.status,
        latency_ms: latencyMs,
        response_kind: responseKind,
      };
      attempts.push(attempt);

      // If we get HTML "Cannot GET" 404, try next route
      if (response.status === 404 && responseKind === 'HTML_CANNOT_GET') {
        safeLog('warn', `Route missing (HTML Cannot GET), trying next`, { 
          provider, 
          status: 404, 
          request_path: requestPath,
        });
        
        if (i < routeCandidates.length - 1) {
          routeProbingUsed = true;
          continue; // Try next candidate
        }
        
        // Last candidate also failed
        return {
          status: 404,
          data: null,
          error_code: 'UPSTREAM_ROUTE_MISSING',
          message: `All route candidates returned 404. Check CPNU_BASE_URL configuration.`,
          request_path: requestPath,
          body_snippet: bodyText.slice(0, 2000),
          attempts,
          route_probing_used: routeProbingUsed,
        };
      }

      // Non-404 error or JSON 404 (record not found)
      if (!response.ok) {
        const errorCode = classifyErrorCode(response.status, responseKind, null);
        return {
          status: response.status,
          data: null,
          error_code: errorCode,
          message: bodyText.slice(0, 500),
          request_path: requestPath,
          body_snippet: bodyText.slice(0, 2000),
          attempts,
          route_probing_used: routeProbingUsed,
        };
      }

      // Success - parse JSON
      try {
        const jsonData = JSON.parse(bodyText);
        
        // Check for JSON "not found" indicators
        if (jsonData.found === false || jsonData.expediente_encontrado === false) {
          return {
            status: response.status,
            data: jsonData,
            error_code: 'RECORD_NOT_FOUND',
            message: 'Provider returned JSON but record not found',
            request_path: requestPath,
            attempts,
            route_probing_used: routeProbingUsed,
          };
        }

        return { 
          status: response.status, 
          data: jsonData,
          request_path: requestPath,
          attempts,
          route_probing_used: routeProbingUsed,
        };
      } catch {
        // Got 200 but body is not valid JSON
        return {
          status: response.status,
          data: null,
          error_code: 'INVALID_JSON_RESPONSE',
          message: 'Provider returned 200 but body is not valid JSON',
          request_path: requestPath,
          body_snippet: bodyText.slice(0, 2000),
          attempts,
          route_probing_used: routeProbingUsed,
        };
      }

    } catch (err) {
      const latencyMs = Date.now() - attemptStart;
      
      if (err instanceof Error && err.name === 'AbortError') {
        attempts.push({
          path: requestPath,
          http_status: 0,
          latency_ms: latencyMs,
          response_kind: 'ERROR',
          error: 'TIMEOUT',
        });
        
        return { 
          status: 0, 
          data: null, 
          error_code: 'TIMEOUT', 
          message: `Request timed out after ${timeoutMs}ms`,
          request_path: requestPath,
          attempts,
          route_probing_used: routeProbingUsed,
        };
      }

      attempts.push({
        path: requestPath,
        http_status: 0,
        latency_ms: latencyMs,
        response_kind: 'ERROR',
        error: err instanceof Error ? err.message : 'Unknown',
      });

      return {
        status: 0,
        data: null,
        error_code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Unknown network error',
        request_path: requestPath,
        attempts,
        route_probing_used: routeProbingUsed,
      };
    }
  }

  // Should not reach here, but safety fallback
  return {
    status: 0,
    data: null,
    error_code: 'NO_ROUTES',
    message: 'No route candidates available',
    attempts,
    route_probing_used: false,
  };
}

function buildSummary(provider: ProviderName, data: unknown): DebugSummary {
  if (!data || typeof data !== 'object') {
    return { found: false };
  }

  const obj = data as Record<string, unknown>;
  
  // Check for "not found" indicators
  if (obj.expediente_encontrado === false || obj.found === false) {
    return { found: false };
  }

  switch (provider) {
    case 'cpnu':
    case 'samai': {
      const actuaciones = obj.actuaciones || (obj.proceso as Record<string, unknown>)?.actuaciones || [];
      const estados = obj.estados_electronicos || [];
      const proceso = obj.proceso as Record<string, unknown> | undefined;
      
      return {
        found: Array.isArray(actuaciones) && actuaciones.length > 0,
        actuacionesCount: Array.isArray(actuaciones) ? actuaciones.length : 0,
        estadosCount: Array.isArray(estados) ? estados.length : 0,
        hasExpediente: !!obj.expediente_url,
        despacho: (proceso?.despacho || obj.despacho) as string | undefined,
        tipoProceso: (proceso?.tipo || obj.tipo_proceso) as string | undefined,
      };
    }
    case 'tutelas': {
      const actuaciones = obj.actuaciones || [];
      return {
        found: !!obj.expediente_url || (Array.isArray(actuaciones) && actuaciones.length > 0),
        actuacionesCount: Array.isArray(actuaciones) ? actuaciones.length : 0,
        hasExpediente: !!obj.expediente_url,
        despacho: obj.despacho as string | undefined,
        tipoProceso: 'TUTELA',
      };
    }
    case 'publicaciones': {
      const publicaciones = obj.publicaciones || obj.estados || obj.documents || [];
      return {
        found: Array.isArray(publicaciones) && publicaciones.length > 0,
        publicacionesCount: Array.isArray(publicaciones) ? publicaciones.length : 0,
        hasDocuments: Array.isArray(publicaciones) && publicaciones.some((p: unknown) => 
          typeof p === 'object' && p !== null && 'pdf_url' in p
        ),
      };
    }
  }
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

    // Check if user is platform admin or org admin
    const { data: platformAdmin } = await supabase
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    const isPlatformAdmin = !!platformAdmin;

    if (!isPlatformAdmin) {
      const { data: adminMemberships } = await supabase
        .from('organization_memberships')
        .select('id, role')
        .eq('user_id', userId)
        .in('role', ['OWNER', 'ADMIN'])
        .limit(1);
      
      if (!adminMemberships || adminMemberships.length === 0) {
        return errorResponse('FORBIDDEN', 'This endpoint requires platform admin or organization admin access', 403);
      }
    }

    safeLog('info', 'Access granted', { user_id: userId });

    // Parse request
    let payload: DebugRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400, Date.now() - startTime);
    }

    const { provider, identifier, mode = 'lookup' } = payload;
    // Enforce timeout limits
    const timeoutMs = Math.min(Math.max(payload.timeoutMs || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);

    // Validate provider
    const validProviders: ProviderName[] = ['cpnu', 'samai', 'tutelas', 'publicaciones'];
    if (!validProviders.includes(provider)) {
      return errorResponse(
        'INVALID_PROVIDER', 
        `Provider must be one of: ${validProviders.join(', ')}`, 
        400, 
        Date.now() - startTime
      );
    }

    // Validate identifier based on provider
    let resolvedIdentifier: string;
    
    if (provider === 'tutelas') {
      if (identifier.tutela_code && isValidTutelaCode(identifier.tutela_code)) {
        resolvedIdentifier = identifier.tutela_code.toUpperCase();
      } else if (identifier.radicado && isValidRadicado(identifier.radicado)) {
        resolvedIdentifier = normalizeRadicado(identifier.radicado);
      } else {
        return errorResponse(
          'INVALID_IDENTIFIER', 
          'TUTELAS requires tutela_code (T + 6-10 digits) or valid 23-digit radicado', 
          400,
          Date.now() - startTime
        );
      }
    } else {
      if (!identifier.radicado || !isValidRadicado(identifier.radicado)) {
        return errorResponse(
          'INVALID_RADICADO', 
          `${provider.toUpperCase()} requires a valid 23-digit radicado`, 
          400,
          Date.now() - startTime
        );
      }
      resolvedIdentifier = normalizeRadicado(identifier.radicado);
    }

    safeLog('info', `Calling ${provider} with route probing`, { provider, status: 0, latencyMs: 0 });

    // Call provider with route probing
    const callStartTime = Date.now();
    const result = await callProviderWithProbing(provider, resolvedIdentifier, timeoutMs);
    const latencyMs = Date.now() - callStartTime;

    // Build response
    const summary = result.data ? buildSummary(provider, result.data) : { found: false };
    const { data: rawData, truncated, limits } = result.data 
      ? truncateRaw(result.data) 
      : { data: null, truncated: false, limits: {} };

    const maskedUrl = result.request_path 
      ? `${maskHost(provider)}${result.request_path}` 
      : undefined;

    const debugResult: DebugResult = {
      ok: result.status >= 200 && result.status < 300 && !result.error_code,
      provider_used: provider,
      request_url_masked: maskedUrl,
      request_path: result.request_path,
      request_method: 'GET',
      status: result.status,
      latencyMs,
      summary,
      raw: rawData,
      truncated,
      limits: Object.keys(limits).length > 0 ? limits : undefined,
      retried: result.route_probing_used,
      attempts: result.attempts,
      route_probing_used: result.route_probing_used,
    };

    if (result.error_code) {
      debugResult.error_code = result.error_code;
      debugResult.message = result.message;
      
      // Include body snippet for debugging route issues
      if (result.body_snippet) {
        debugResult._debug_body_snippet = result.body_snippet.slice(0, 2000);
      }
    }

    safeLog('info', 'Provider call completed', { 
      provider, 
      status: result.status, 
      latencyMs,
      error_code: result.error_code,
      request_path: result.request_path,
    });

    return jsonResponse(debugResult);

  } catch (err) {
    const latencyMs = Date.now() - startTime;
    safeLog('error', 'Unhandled error', { latencyMs, error_code: 'INTERNAL_ERROR' });
    
    const result: DebugResult = {
      ok: false,
      provider_used: 'none',
      status: 500,
      latencyMs,
      summary: { found: false },
      raw: null,
      error_code: 'INTERNAL_ERROR',
      message: err instanceof Error ? err.message : 'An unexpected error occurred',
      truncated: false,
      retried: false,
    };
    
    return jsonResponse(result, 500);
  }
});
