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

import { createClient } from "npm:@supabase/supabase-js@2";

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
// CPNU Cloud Run service exposes routes at ROOT: /health, /snapshot, /buscar, /resultado/{jobId}
// The primary lookup route is /snapshot?numero_radicacion={radicado}

// For CPNU, we use query-param based routes (not path-based like /proceso/{id})
// The {id} placeholder is replaced with the radicado in the query string
const CPNU_ROUTE_CANDIDATES = [
  '/snapshot?numero_radicacion={id}',      // Primary: synchronous snapshot
  '/buscar?numero_radicacion={id}',        // Fallback: async job creation
];

// SAMAI uses similar routes
const SAMAI_ROUTE_CANDIDATES = [
  '/snapshot?numero_radicacion={id}',
  '/buscar?numero_radicacion={id}',
];

const TUTELAS_ROUTE_CANDIDATES = [
  '/expediente/{id}',
  '/api/expediente/{id}',
];

// PUBLICACIONES v3: Synchronous API (no job queues, no polling)
// GET /snapshot/{radicado} → synchronous scraping, returns results directly
// GET /search/{radicado} → legacy compatibility endpoint
const PUBLICACIONES_ROUTE_CANDIDATES = [
  '/snapshot/{id}',                           // Primary: synchronous scraping (v3 API)
  '/search/{id}',                             // Legacy compatibility endpoint
  '/health',                                   // Health check (no identifier needed)
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

// Auth diagnostics (safe to expose - no secrets)
interface AuthDiagnostics {
  auth_header_used: string;
  api_key_source: 'CPNU_X_API_KEY' | 'SAMAI_X_API_KEY' | 'TUTELAS_X_API_KEY' | 'PUBLICACIONES_X_API_KEY' | 'EXTERNAL_X_API_KEY' | 'MISSING';
  api_key_present: boolean;
  api_key_fingerprint: string | null; // First 8 chars of sha256 hash (safe)
}

interface DebugResult {
  ok: boolean;
  provider_used: string;
  // Enhanced diagnostics (no secrets exposed)
  request_url_masked?: string; // Masked URL: <PROVIDER>/path
  request_path?: string; // Path only, no host/secrets
  request_method?: string;
  // Path prefix diagnostics
  path_prefix_used?: string; // The prefix applied (e.g., "" or "/cpnu")
  path_prefix_note?: string; // Hint about prefix configuration
  // Auth diagnostics (safe)
  auth?: AuthDiagnostics;
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

// Safe URL join that handles base, prefix, and path
// Rules:
// - base has no trailing slash
// - prefix is either "" or starts with "/" and has no trailing slash (normalized)
// - path always starts with "/"
// - result has exactly one slash between segments (never "//health")
function joinUrl(baseUrl: string, prefix: string, path: string): string {
  // Normalize base: remove trailing slashes
  const cleanBase = baseUrl.replace(/\/+$/, '');
  
  // Normalize prefix: if it's just "/" or whitespace, treat as empty
  let cleanPrefix = (prefix || '').trim();
  if (cleanPrefix === '/') cleanPrefix = '';
  
  // Ensure prefix starts with "/" if non-empty, and has no trailing slash
  if (cleanPrefix && !cleanPrefix.startsWith('/')) {
    cleanPrefix = '/' + cleanPrefix;
  }
  cleanPrefix = cleanPrefix.replace(/\/+$/, '');
  
  // Ensure path starts with "/"
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  // Join: base + prefix + path (each segment properly separated)
  return `${cleanBase}${cleanPrefix}${cleanPath}`;
}

// Legacy helper for backward compatibility
function safeJoinUrl(baseUrl: string, path: string): string {
  return joinUrl(baseUrl, '', path);
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
    lower.includes('not found</pre>') ||
    lower.includes('404 not found') ||
    lower.includes('<title>404')
  );
}

/**
 * CRITICAL: Detect if response is a FastAPI/Starlette generic "route not found" 404
 * 
 * FastAPI returns {"detail":"Not Found"} when the ROUTE doesn't exist.
 * This is different from application-level "record not found" responses.
 */
function isFastApiRouteNotFound(body: string): boolean {
  try {
    const json = JSON.parse(body);
    
    // FastAPI default 404: exactly {"detail":"Not Found"}
    if (json.detail === "Not Found") return true;
    
    // FastAPI method not allowed
    if (json.detail === "Method Not Allowed") return true;
    
    // Generic framework-style error with just "message" or "error" = "Not Found"
    if (json.message === "Not Found" && Object.keys(json).length === 1) return true;
    if (json.error === "Not Found" && Object.keys(json).length === 1) return true;
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Detect if response indicates a domain-specific "record not found" or "scraping needed"
 * This means the ROUTE EXISTS but the record isn't available yet.
 */
function isDomainRecordNotFound(body: string): boolean {
  try {
    const json = JSON.parse(body);
    
    // Domain-specific indicators that route exists but record doesn't
    if (json.found === false) return true;
    if (json.success === false && json.error) return true;
    if (json.expediente_encontrado === false) return true;
    if (json.status === "not_cached") return true;
    if (json.status === "pending") return true;
    if (json.job_id || json.jobId) return true; // Scraping job created
    
    // Check for scraping-related keywords in error messages
    const errorMsg = String(json.error || json.message || json.detail || "").toLowerCase();
    if (errorMsg.includes("not cached") || 
        errorMsg.includes("scraping") ||
        errorMsg.includes("processing") ||
        errorMsg.includes("no snapshot") ||
        errorMsg.includes("radicado not found")) {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
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

// Classify error code based on response with STRICT 404 handling
function classifyErrorCode(
  httpStatus: number,
  responseKind: RouteAttempt['response_kind'],
  bodyText?: string,
  jsonData?: unknown
): string {
  // Route missing (HTML 404 with "Cannot GET")
  if (httpStatus === 404 && responseKind === 'HTML_CANNOT_GET') {
    return 'UPSTREAM_ROUTE_MISSING';
  }
  
  // CRITICAL: FastAPI generic 404 {"detail":"Not Found"} = ROUTE missing, not record
  if (httpStatus === 404 && responseKind === 'JSON' && bodyText && isFastApiRouteNotFound(bodyText)) {
    return 'UPSTREAM_ROUTE_MISSING';
  }
  
  // Domain-specific record not found (JSON 404 with application-level error)
  if (httpStatus === 404 && responseKind === 'JSON' && bodyText && isDomainRecordNotFound(bodyText)) {
    return 'RECORD_NOT_FOUND';
  }
  
  // Generic JSON 404 - default to route missing for safety
  if (httpStatus === 404 && responseKind === 'JSON') {
    return 'UPSTREAM_ROUTE_MISSING';
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

// ============= API KEY SELECTION =============
// Provider-specific keys take precedence over the shared EXTERNAL_X_API_KEY
// This allows different credentials per upstream service

interface ApiKeyInfo {
  source: AuthDiagnostics['api_key_source'];
  value: string | null;
  fingerprint: string | null;
}

async function hashFingerprint(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 8); // First 8 chars of sha256 (safe fingerprint)
}

async function getApiKeyForProvider(provider: ProviderName): Promise<ApiKeyInfo> {
  // Provider-specific key env vars
  const providerKeyMap: Record<ProviderName, string> = {
    cpnu: 'CPNU_X_API_KEY',
    samai: 'SAMAI_X_API_KEY',
    tutelas: 'TUTELAS_X_API_KEY',
    publicaciones: 'PUBLICACIONES_X_API_KEY',
  };

  const sourceNameMap: Record<ProviderName, AuthDiagnostics['api_key_source']> = {
    cpnu: 'CPNU_X_API_KEY',
    samai: 'SAMAI_X_API_KEY',
    tutelas: 'TUTELAS_X_API_KEY',
    publicaciones: 'PUBLICACIONES_X_API_KEY',
  };

  // Try provider-specific key first
  const providerKey = Deno.env.get(providerKeyMap[provider]);
  if (providerKey && providerKey.length > 0) {
    return {
      source: sourceNameMap[provider],
      value: providerKey,
      fingerprint: await hashFingerprint(providerKey),
    };
  }

  // Fall back to shared key
  const sharedKey = Deno.env.get('EXTERNAL_X_API_KEY');
  if (sharedKey && sharedKey.length > 0) {
    return {
      source: 'EXTERNAL_X_API_KEY',
      value: sharedKey,
      fingerprint: await hashFingerprint(sharedKey),
    };
  }

  // No key available
  return {
    source: 'MISSING',
    value: null,
    fingerprint: null,
  };
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
  path_prefix_used?: string;
  body_snippet?: string;
  attempts: RouteAttempt[];
  route_probing_used: boolean;
  auth: AuthDiagnostics;
}> {
  const envMap: Record<ProviderName, string> = {
    cpnu: 'CPNU_BASE_URL',
    samai: 'SAMAI_BASE_URL',
    tutelas: 'TUTELAS_BASE_URL',
    publicaciones: 'PUBLICACIONES_BASE_URL',
  };
  
  // Path prefix env vars (optional, default to empty string)
  // TODAY: Cloud Run services exposed at root -> prefix should be empty
  // FUTURE: Single gateway domain -> prefix may be /cpnu, /samai, etc.
  const prefixEnvMap: Record<ProviderName, string> = {
    cpnu: 'CPNU_PATH_PREFIX',
    samai: 'SAMAI_PATH_PREFIX',
    tutelas: 'TUTELAS_PATH_PREFIX',
    publicaciones: 'PUBLICACIONES_PATH_PREFIX',
  };

  const baseUrl = Deno.env.get(envMap[provider]);
  const pathPrefix = Deno.env.get(prefixEnvMap[provider]) || ''; // Default to empty
  
  // Get API key with provider-specific selection
  const apiKeyInfo = await getApiKeyForProvider(provider);
  
  const authDiagnostics: AuthDiagnostics = {
    auth_header_used: 'x-api-key',
    api_key_source: apiKeyInfo.source,
    api_key_present: apiKeyInfo.value !== null,
    api_key_fingerprint: apiKeyInfo.fingerprint,
  };

  if (!baseUrl) {
    return { 
      status: 0, 
      data: null, 
      error_code: 'PROVIDER_NOT_CONFIGURED', 
      message: `${envMap[provider]} not configured`,
      request_path: undefined,
      path_prefix_used: pathPrefix,
      attempts: [],
      route_probing_used: false,
      auth: authDiagnostics,
    };
  }

  const routeCandidates = getRouteCandidates(provider);
  const attempts: RouteAttempt[] = [];
  let routeProbingUsed = false;
  
  // Normalize the path prefix for logging
  let normalizedPrefix = (pathPrefix || '').trim();
  if (normalizedPrefix === '/') normalizedPrefix = '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  // Only add auth header if key is present
  if (apiKeyInfo.value) {
    headers['x-api-key'] = apiKeyInfo.value;
  }

  for (let i = 0; i < routeCandidates.length; i++) {
    const pathTemplate = routeCandidates[i];
    const requestPath = pathTemplate.replace('{id}', identifier);
    // Use joinUrl with the prefix
    const fullUrl = joinUrl(baseUrl, pathPrefix, requestPath);
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

      // If we get a 404 that indicates route missing (HTML or FastAPI generic), try next route
      const isRouteMissing = response.status === 404 && (
        responseKind === 'HTML_CANNOT_GET' ||
        isFastApiRouteNotFound(bodyText)
      );
      
      if (isRouteMissing) {
        // Check if this might be a prefix mismatch
        const prefixHint = normalizedPrefix 
          ? `Path prefix "${normalizedPrefix}" may be incorrect for this service.`
          : 'Service may require a path prefix (e.g., PUBLICACIONES_PATH_PREFIX=/api).';
        
        safeLog('warn', `Route missing (${responseKind === 'HTML_CANNOT_GET' ? 'HTML' : 'FastAPI'} 404), trying next. ${prefixHint}`, { 
          provider, 
          status: 404, 
          request_path: requestPath,
        });
        
        if (i < routeCandidates.length - 1) {
          routeProbingUsed = true;
          continue; // Try next candidate
        }
        
        // Last candidate also failed - all routes are missing
        const errorMessage = normalizedPrefix
          ? `All route candidates returned 404. Prefix "${normalizedPrefix}" may be wrong for a root-exposed service. Try setting ${envMap[provider].replace('_BASE_URL', '_PATH_PREFIX')} to empty.`
          : `All route candidates returned 404. Check ${envMap[provider]} configuration or set a path prefix if using a gateway.`;
        
        return {
          status: 404,
          data: null,
          error_code: 'UPSTREAM_ROUTE_MISSING',
          message: errorMessage,
          request_path: requestPath,
          path_prefix_used: normalizedPrefix,
          body_snippet: bodyText.slice(0, 2000),
          attempts,
          route_probing_used: routeProbingUsed,
          auth: authDiagnostics,
        };
      }

      // Non-404 error or JSON 404 (record not found / cache miss)
      if (!response.ok) {
        const errorCode = classifyErrorCode(response.status, responseKind, bodyText, undefined);
        
        // ENHANCED: Provide better message for RECORD_NOT_FOUND (cache miss)
        // This indicates auth worked but record is not cached
        let message = bodyText.slice(0, 500);
        if (errorCode === 'RECORD_NOT_FOUND') {
          message = 'Auth OK — Record not in cache. Provider may need to scrape this radicado. Use /buscar to trigger scraping.';
        }
        
        return {
          status: response.status,
          data: null,
          error_code: errorCode,
          message,
          request_path: requestPath,
          path_prefix_used: normalizedPrefix,
          body_snippet: bodyText.slice(0, 2000),
          attempts,
          route_probing_used: routeProbingUsed,
          auth: authDiagnostics,
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
            path_prefix_used: normalizedPrefix,
            attempts,
            route_probing_used: routeProbingUsed,
            auth: authDiagnostics,
          };
        }

        return { 
          status: response.status, 
          data: jsonData,
          request_path: requestPath,
          path_prefix_used: normalizedPrefix,
          attempts,
          route_probing_used: routeProbingUsed,
          auth: authDiagnostics,
        };
      } catch {
        // Got 200 but body is not valid JSON
        return {
          status: response.status,
          data: null,
          error_code: 'INVALID_JSON_RESPONSE',
          message: 'Provider returned 200 but body is not valid JSON',
          request_path: requestPath,
          path_prefix_used: normalizedPrefix,
          body_snippet: bodyText.slice(0, 2000),
          attempts,
          route_probing_used: routeProbingUsed,
          auth: authDiagnostics,
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
          path_prefix_used: normalizedPrefix,
          attempts,
          route_probing_used: routeProbingUsed,
          auth: authDiagnostics,
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
        path_prefix_used: normalizedPrefix,
        attempts,
        route_probing_used: routeProbingUsed,
        auth: authDiagnostics,
      };
    }
  }

  // Should not reach here, but safety fallback
  return {
    status: 0,
    data: null,
    error_code: 'NO_ROUTES',
    message: 'No route candidates available',
    path_prefix_used: normalizedPrefix,
    attempts,
    route_probing_used: false,
    auth: authDiagnostics,
  };
}

// ============= CPNU ASYNC JOB FLOW =============
// If /snapshot doesn't work or returns pending, we can try /buscar -> /resultado

async function tryBuscarResultadoFlow(
  baseUrl: string,
  pathPrefix: string,
  radicado: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ ok: boolean; data?: unknown; error?: string; jobId?: string }> {
  const buscarPath = `/buscar?numero_radicacion=${radicado}`;
  const buscarUrl = joinUrl(baseUrl, pathPrefix, buscarPath);
  
  try {
    const buscarResponse = await fetch(buscarUrl, { method: 'GET', headers });
    const buscarBody = await buscarResponse.text();
    
    if (!buscarResponse.ok) {
      return { ok: false, error: `buscar returned ${buscarResponse.status}` };
    }
    
    let buscarData: Record<string, unknown>;
    try {
      buscarData = JSON.parse(buscarBody);
    } catch {
      return { ok: false, error: 'buscar returned non-JSON' };
    }
    
    // Extract job ID
    const jobId = (buscarData.jobId || buscarData.id || buscarData.resultId || buscarData.job_id) as string | undefined;
    if (!jobId) {
      return { ok: false, error: 'buscar did not return a jobId' };
    }
    
    // Wait briefly then fetch resultado
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const resultadoPath = `/resultado/${jobId}`;
    const resultadoUrl = joinUrl(baseUrl, pathPrefix, resultadoPath);
    
    const resultadoResponse = await fetch(resultadoUrl, { method: 'GET', headers });
    const resultadoBody = await resultadoResponse.text();
    
    if (!resultadoResponse.ok) {
      return { ok: false, error: `resultado returned ${resultadoResponse.status}`, jobId };
    }
    
    try {
      const resultadoData = JSON.parse(resultadoBody);
      return { ok: true, data: resultadoData, jobId };
    } catch {
      return { ok: false, error: 'resultado returned non-JSON', jobId };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'buscar/resultado failed' };
  }
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

    // Generate prefix note for UI
    const prefixUsed = result.path_prefix_used || '';
    let prefixNote: string | undefined;
    if (result.error_code === 'UPSTREAM_ROUTE_MISSING') {
      prefixNote = prefixUsed
        ? `⚠️ Path prefix "${prefixUsed}" is set. If service is exposed at root, set ${provider.toUpperCase()}_PATH_PREFIX to empty.`
        : `ℹ️ No path prefix set. If using a gateway, you may need to set ${provider.toUpperCase()}_PATH_PREFIX (e.g., /${provider}).`;
    }

    const debugResult: DebugResult = {
      ok: result.status >= 200 && result.status < 300 && !result.error_code,
      provider_used: provider,
      request_url_masked: maskedUrl,
      request_path: result.request_path,
      request_method: 'GET',
      path_prefix_used: prefixUsed,
      path_prefix_note: prefixNote,
      auth: result.auth, // Include auth diagnostics
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
