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
 * 
 * Input: { provider, identifier: { radicado?, tutela_code? }, mode, timeoutMs }
 * Output: { provider_used, status, latencyMs, summary, raw, truncated, limits, error_code?, retried }
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

interface DebugResult {
  ok: boolean;
  provider_used: string;
  // Enhanced diagnostics (no secrets exposed)
  request_url?: string; // Masked URL: base path only, no host/secrets
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

// ============= PROVIDER CALLS =============

async function callProvider(
  provider: ProviderName,
  identifier: string,
  timeoutMs: number
): Promise<{ 
  status: number; 
  data: unknown; 
  error_code?: string; 
  message?: string;
  request_path?: string; // Path only, no host/secrets
  body_snippet?: string; // First ~2KB of response for debugging
}> {
  const envMap: Record<ProviderName, string> = {
    cpnu: 'CPNU_BASE_URL',
    samai: 'SAMAI_BASE_URL',
    tutelas: 'TUTELAS_BASE_URL',
    publicaciones: 'PUBLICACIONES_BASE_URL',
  };

  const baseUrl = Deno.env.get(envMap[provider]);
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  // Build path based on provider (for diagnostics, no host exposed)
  let requestPath: string;
  switch (provider) {
    case 'cpnu':
    case 'samai':
      requestPath = `/proceso/${identifier}`;
      break;
    case 'tutelas':
      requestPath = `/expediente/${identifier}`;
      break;
    case 'publicaciones':
      requestPath = `/publicaciones/${identifier}`;
      break;
  }

  if (!baseUrl) {
    return { 
      status: 0, 
      data: null, 
      error_code: 'PROVIDER_NOT_CONFIGURED', 
      message: `${envMap[provider]} not configured`,
      request_path: requestPath,
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

    // Build full endpoint URL
    const endpoint = new URL(requestPath, baseUrl).toString();

    // Log without sensitive data
    safeLog('info', `Calling provider`, { provider, status: 0, latencyMs: 0 });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        status: response.status,
        data: null,
        error_code: `HTTP_${response.status}`,
        message: errorText.slice(0, 500),
        request_path: requestPath,
        body_snippet: errorText.slice(0, 2000), // Truncated response body for debugging
      };
    }

    const data = await response.json();
    return { 
      status: response.status, 
      data,
      request_path: requestPath,
    };

  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { 
        status: 0, 
        data: null, 
        error_code: 'TIMEOUT', 
        message: `Request timed out after ${timeoutMs}ms`,
        request_path: requestPath,
      };
    }
    return {
      status: 0,
      data: null,
      error_code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : 'Unknown network error',
      request_path: requestPath,
    };
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

    safeLog('info', `Calling ${provider}`, { provider, status: 0, latencyMs: 0 });

    // Call provider
    const callStartTime = Date.now();
    const result = await callProvider(provider, resolvedIdentifier, timeoutMs);
    const latencyMs = Date.now() - callStartTime;

    // Build response
    const summary = result.data ? buildSummary(provider, result.data) : { found: false };
    const { data: rawData, truncated, limits } = result.data 
      ? truncateRaw(result.data) 
      : { data: null, truncated: false, limits: {} };

    const debugResult: DebugResult = {
      ok: result.status >= 200 && result.status < 300 && !result.error_code,
      provider_used: provider,
      status: result.status,
      latencyMs,
      summary,
      raw: rawData,
      truncated,
      limits: Object.keys(limits).length > 0 ? limits : undefined,
      retried: false,
      // Enhanced diagnostics - request_url shows path only (no host/secrets)
      request_url: result.request_path || undefined,
      request_method: 'GET',
    };

    if (result.error_code) {
      debugResult.error_code = result.error_code;
      debugResult.message = result.message;
      // Include body snippet for 404/error debugging
      if (result.body_snippet && !summary.found) {
        debugResult.raw = { 
          _debug_body_snippet: result.body_snippet.slice(0, 2000),
          _note: 'Upstream response body (first 2KB, sanitized)'
        };
      }
    }

    safeLog('info', 'Provider call completed', { 
      provider, 
      status: result.status, 
      latencyMs,
      error_code: result.error_code,
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
