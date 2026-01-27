/**
 * debug-external-provider Edge Function
 * 
 * Proxies debug requests to external judicial APIs using configured secrets.
 * 
 * Features:
 * - Platform admins or org admins only
 * - Calls CPNU, SAMAI, TUTELAS, or PUBLICACIONES providers
 * - Returns status, latency, summary, and raw response
 * - Never exposes secrets
 * 
 * Input: { provider, identifier: { radicado?, tutela_code? }, mode, timeoutMs }
 * Output: { provider_used, status, latencyMs, summary, raw }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

interface DebugResult {
  ok: boolean;
  provider_used: string;
  status: number;
  latencyMs: number;
  summary: DebugSummary;
  raw: unknown;
  error?: string;
  truncated?: boolean;
}

// ============= HELPERS =============

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number = 400): Response {
  return jsonResponse({ ok: false, code, message }, status);
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

function truncateRaw(raw: unknown, maxSize: number = 50000): { data: unknown; truncated: boolean } {
  const jsonStr = JSON.stringify(raw);
  if (jsonStr.length <= maxSize) {
    return { data: raw, truncated: false };
  }
  
  // Truncate arrays in the response
  if (typeof raw === 'object' && raw !== null) {
    const truncated = { ...raw } as Record<string, unknown>;
    const arrayKeys = ['actuaciones', 'estados', 'publicaciones', 'sujetos_procesales'];
    
    for (const key of arrayKeys) {
      if (Array.isArray(truncated[key]) && truncated[key].length > 20) {
        truncated[key] = truncated[key].slice(0, 20);
        truncated[`${key}_truncated`] = true;
        truncated[`${key}_total`] = (raw as Record<string, unknown[]>)[key].length;
      }
    }
    
    return { data: truncated, truncated: true };
  }
  
  return { data: { message: 'Response too large', size: jsonStr.length }, truncated: true };
}

// ============= PROVIDER CALLS =============

async function callProvider(
  provider: ProviderName,
  identifier: string,
  timeoutMs: number
): Promise<{ status: number; data: unknown; error?: string }> {
  const envMap: Record<ProviderName, string> = {
    cpnu: 'CPNU_BASE_URL',
    samai: 'SAMAI_BASE_URL',
    tutelas: 'TUTELAS_BASE_URL',
    publicaciones: 'PUBLICACIONES_BASE_URL',
  };

  const baseUrl = Deno.env.get(envMap[provider]);
  const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');

  if (!baseUrl) {
    return { status: 0, data: null, error: `${envMap[provider]} not configured` };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    // Build endpoint URL based on provider
    let endpoint: string;
    switch (provider) {
      case 'cpnu':
      case 'samai':
        endpoint = new URL(`/proceso/${identifier}`, baseUrl).toString();
        break;
      case 'tutelas':
        endpoint = new URL(`/expediente/${identifier}`, baseUrl).toString();
        break;
      case 'publicaciones':
        endpoint = new URL(`/publicaciones/${identifier}`, baseUrl).toString();
        break;
    }

    console.log(`[debug-external-provider] Calling ${provider}: ${endpoint}`);

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
        error: errorText.slice(0, 500),
      };
    }

    const data = await response.json();
    return { status: response.status, data };

  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 0, data: null, error: `Timeout after ${timeoutMs}ms` };
    }
    return {
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : 'Unknown error',
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
      .select('id')
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

    console.log(`[debug-external-provider] Access granted: user=${userId}`);

    // Parse request
    let payload: DebugRequest;
    try {
      payload = await req.json();
    } catch {
      return errorResponse('INVALID_JSON', 'Could not parse request body', 400);
    }

    const { provider, identifier, mode = 'lookup', timeoutMs = 15000 } = payload;

    // Validate provider
    const validProviders: ProviderName[] = ['cpnu', 'samai', 'tutelas', 'publicaciones'];
    if (!validProviders.includes(provider)) {
      return errorResponse('INVALID_PROVIDER', `Provider must be one of: ${validProviders.join(', ')}`, 400);
    }

    // Validate identifier based on provider
    let resolvedIdentifier: string;
    
    if (provider === 'tutelas') {
      if (identifier.tutela_code && isValidTutelaCode(identifier.tutela_code)) {
        resolvedIdentifier = identifier.tutela_code.toUpperCase();
      } else if (identifier.radicado && isValidRadicado(identifier.radicado)) {
        resolvedIdentifier = normalizeRadicado(identifier.radicado);
      } else {
        return errorResponse('INVALID_IDENTIFIER', 'TUTELAS requires tutela_code (T + 6-10 digits) or valid 23-digit radicado', 400);
      }
    } else {
      if (!identifier.radicado || !isValidRadicado(identifier.radicado)) {
        return errorResponse('INVALID_RADICADO', `${provider.toUpperCase()} requires a valid 23-digit radicado`, 400);
      }
      resolvedIdentifier = normalizeRadicado(identifier.radicado);
    }

    console.log(`[debug-external-provider] Calling ${provider} with identifier=${resolvedIdentifier}`);

    // Call provider
    const startTime = Date.now();
    const result = await callProvider(provider, resolvedIdentifier, timeoutMs);
    const latencyMs = Date.now() - startTime;

    // Build response
    const summary = result.data ? buildSummary(provider, result.data) : { found: false };
    const { data: rawData, truncated } = result.data ? truncateRaw(result.data) : { data: null, truncated: false };

    const debugResult: DebugResult = {
      ok: result.status >= 200 && result.status < 300 && !result.error,
      provider_used: provider,
      status: result.status,
      latencyMs,
      summary,
      raw: rawData,
      truncated,
    };

    if (result.error) {
      debugResult.error = result.error;
    }

    console.log(`[debug-external-provider] Result: status=${result.status}, found=${summary.found}, latency=${latencyMs}ms`);

    return jsonResponse(debugResult);

  } catch (err) {
    console.error('[debug-external-provider] Error:', err);
    return errorResponse(
      'INTERNAL_ERROR',
      err instanceof Error ? err.message : 'An unexpected error occurred',
      500
    );
  }
});
