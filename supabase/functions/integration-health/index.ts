/**
 * integration-health Edge Function
 * 
 * Verifies that required secrets are present and can reach external provider hosts.
 * Includes email gateway health check for Cloud Run Option B architecture.
 * 
 * Features:
 * - Reports boolean presence for each secret (never exposes values)
 * - Optional reachability checks for each provider
 * - Email gateway configuration status
 * - Access control: Only platform admins or org admins
 * 
 * Output: { env: {...}, email_gateway: {...}, reachability?: {...}, timestamp }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Required secret names for judicial providers
const REQUIRED_SECRETS = [
  'CPNU_BASE_URL',
  'SAMAI_BASE_URL',
  'TUTELAS_BASE_URL',
  'PUBLICACIONES_BASE_URL',
  'EXTERNAL_X_API_KEY',
];

// Optional provider-specific API keys (take precedence over EXTERNAL_X_API_KEY)
const OPTIONAL_API_KEYS = [
  'CPNU_X_API_KEY',
  'SAMAI_X_API_KEY',
  'TUTELAS_X_API_KEY',
  'PUBLICACIONES_X_API_KEY',
];

// Email gateway secrets (Cloud Run Option B)
const EMAIL_GATEWAY_SECRETS = [
  'EMAIL_GATEWAY_BASE_URL',
  'EMAIL_GATEWAY_API_KEY',
  'EMAIL_FROM_ADDRESS',
];

// Safe fingerprint generation (first 8 chars of sha256)
async function hashFingerprint(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 8);
}

// Get API key for a provider with safe diagnostics
async function getApiKeyInfo(provider: string): Promise<{ source: string; present: boolean; fingerprint: string | null }> {
  const providerKeyMap: Record<string, string> = {
    cpnu: 'CPNU_X_API_KEY',
    samai: 'SAMAI_X_API_KEY',
    tutelas: 'TUTELAS_X_API_KEY',
    publicaciones: 'PUBLICACIONES_X_API_KEY',
  };

  // Try provider-specific key first
  const providerKeyName = providerKeyMap[provider];
  if (providerKeyName) {
    const providerKey = Deno.env.get(providerKeyName);
    if (providerKey && providerKey.length > 0) {
      return {
        source: providerKeyName,
        present: true,
        fingerprint: await hashFingerprint(providerKey),
      };
    }
  }

  // Fall back to shared key
  const sharedKey = Deno.env.get('EXTERNAL_X_API_KEY');
  if (sharedKey && sharedKey.length > 0) {
    return {
      source: 'EXTERNAL_X_API_KEY',
      present: true,
      fingerprint: await hashFingerprint(sharedKey),
    };
  }

  return { source: 'MISSING', present: false, fingerprint: null };
}

interface ProviderAuthCheck {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  api_key_source: string;
  api_key_present: boolean;
  api_key_fingerprint: string | null;
}

interface HealthResult {
  ok: boolean;
  env: Record<string, boolean>;
  optional_keys: Record<string, boolean>;
  email_gateway: {
    configured: boolean;
    base_url_set: boolean;
    api_key_set: boolean;
    from_address_set: boolean;
  };
  reachability?: Record<string, { ok: boolean; status?: number; latencyMs?: number; error?: string }>;
  auth_checks?: Record<string, ProviderAuthCheck>;
  timestamp: string;
  user_role?: string;
}

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, message: string, status: number = 400): Response {
  return jsonResponse({ ok: false, code, message }, status);
}

async function checkReachability(name: string, baseUrl: string | undefined, apiKey: string | undefined): Promise<{ ok: boolean; status?: number; latencyMs?: number; error?: string }> {
  if (!baseUrl) {
    return { ok: false, error: 'URL not configured' };
  }

  try {
    const start = Date.now();
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    // Try a simple health/ping endpoint or just the base URL
    const healthUrl = new URL('/health', baseUrl).toString();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      return {
        ok: response.ok,
        status: response.status,
        latencyMs,
      };
    } catch (fetchErr) {
      // If /health 404s, try base URL with HEAD
      clearTimeout(timeoutId);
      
      try {
        const headStart = Date.now();
        const headResponse = await fetch(baseUrl, {
          method: 'HEAD',
          headers,
          signal: AbortSignal.timeout(5000),
        });
        
        return {
          ok: headResponse.status < 500,
          status: headResponse.status,
          latencyMs: Date.now() - headStart,
        };
      } catch (headErr) {
        return {
          ok: false,
          error: headErr instanceof Error ? headErr.message : 'Connection failed',
          latencyMs: Date.now() - start,
        };
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

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

    // Check if user is platform admin
    const { data: platformAdmin } = await supabase
      .from('platform_admins')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    const isPlatformAdmin = !!platformAdmin;

    // If not platform admin, check if user is org admin of any org
    let isOrgAdmin = false;
    if (!isPlatformAdmin) {
      const { data: adminMemberships } = await supabase
        .from('organization_memberships')
        .select('id, role')
        .eq('user_id', userId)
        .in('role', ['OWNER', 'ADMIN'])
        .limit(1);
      
      isOrgAdmin = (adminMemberships?.length ?? 0) > 0;
    }

    if (!isPlatformAdmin && !isOrgAdmin) {
      return errorResponse('FORBIDDEN', 'This endpoint requires platform admin or organization admin access', 403);
    }

    console.log(`[integration-health] Access granted: user=${userId}, platformAdmin=${isPlatformAdmin}, orgAdmin=${isOrgAdmin}`);

    // Check if reachability tests are requested
    const url = new URL(req.url);
    const checkReach = url.searchParams.get('reachability') === 'true';
    const checkAuth = url.searchParams.get('auth_check') === 'true';

    // Build env presence report (never expose values!)
    const envReport: Record<string, boolean> = {};
    for (const secretName of REQUIRED_SECRETS) {
      const value = Deno.env.get(secretName);
      envReport[secretName] = !!value && value.length > 0;
    }

    // Build optional keys presence report
    const optionalKeysReport: Record<string, boolean> = {};
    for (const keyName of OPTIONAL_API_KEYS) {
      const value = Deno.env.get(keyName);
      optionalKeysReport[keyName] = !!value && value.length > 0;
    }

    // Build email gateway health report
    const emailGatewayBaseUrl = Deno.env.get('EMAIL_GATEWAY_BASE_URL');
    const emailGatewayApiKey = Deno.env.get('EMAIL_GATEWAY_API_KEY');
    const emailFromAddress = Deno.env.get('EMAIL_FROM_ADDRESS');

    const emailGatewayReport = {
      configured: !!(emailGatewayBaseUrl && emailGatewayApiKey),
      base_url_set: !!emailGatewayBaseUrl && emailGatewayBaseUrl.length > 0,
      api_key_set: !!emailGatewayApiKey && emailGatewayApiKey.length > 0,
      from_address_set: !!emailFromAddress && emailFromAddress.length > 0,
    };

    const result: HealthResult = {
      ok: Object.values(envReport).every(Boolean) && emailGatewayReport.configured,
      env: envReport,
      optional_keys: optionalKeysReport,
      email_gateway: emailGatewayReport,
      timestamp: new Date().toISOString(),
      user_role: isPlatformAdmin ? 'platform_admin' : 'org_admin',
    };

    // Optional reachability checks (basic connectivity)
    if (checkReach) {
      const providers = ['cpnu', 'samai', 'tutelas', 'publicaciones'] as const;
      result.reachability = {};
      
      for (const provider of providers) {
        const apiKeyInfo = await getApiKeyInfo(provider);
        const baseUrl = Deno.env.get(`${provider.toUpperCase()}_BASE_URL`);
        result.reachability[provider] = await checkReachability(provider, baseUrl, apiKeyInfo.present ? Deno.env.get(apiKeyInfo.source) : undefined);
      }

      // Also check email gateway if configured
      if (emailGatewayBaseUrl) {
        result.reachability.email_gateway = await checkReachability(
          'email_gateway', 
          emailGatewayBaseUrl, 
          emailGatewayApiKey
        );
      }
    }

    // Optional auth checks (verify API key is accepted)
    if (checkAuth) {
      const providers = ['cpnu', 'samai', 'tutelas', 'publicaciones'] as const;
      result.auth_checks = {};
      
      for (const provider of providers) {
        const apiKeyInfo = await getApiKeyInfo(provider);
        const baseUrl = Deno.env.get(`${provider.toUpperCase()}_BASE_URL`);
        
        if (!baseUrl) {
          result.auth_checks[provider] = {
            ok: false,
            error: 'URL not configured',
            api_key_source: apiKeyInfo.source,
            api_key_present: apiKeyInfo.present,
            api_key_fingerprint: apiKeyInfo.fingerprint,
          };
          continue;
        }
        
        // Call /health with the selected API key
        const start = Date.now();
        try {
          const headers: Record<string, string> = { 'Accept': 'application/json' };
          if (apiKeyInfo.present) {
            const keyValue = Deno.env.get(apiKeyInfo.source);
            if (keyValue) headers['X-API-Key'] = keyValue;
          }
          
          const healthUrl = new URL('/health', baseUrl).toString();
          const response = await fetch(healthUrl, { 
            method: 'GET', 
            headers,
            signal: AbortSignal.timeout(10000),
          });
          
          const latencyMs = Date.now() - start;
          
          result.auth_checks[provider] = {
            ok: response.ok,
            status: response.status,
            latencyMs,
            error: response.ok ? undefined : (response.status === 401 || response.status === 403 
              ? `Auth failed (${response.status}). Check ${apiKeyInfo.source} or Cloud Run API_KEYS.`
              : `HTTP ${response.status}`),
            api_key_source: apiKeyInfo.source,
            api_key_present: apiKeyInfo.present,
            api_key_fingerprint: apiKeyInfo.fingerprint,
          };
        } catch (err) {
          result.auth_checks[provider] = {
            ok: false,
            latencyMs: Date.now() - start,
            error: err instanceof Error ? err.message : 'Connection failed',
            api_key_source: apiKeyInfo.source,
            api_key_present: apiKeyInfo.present,
            api_key_fingerprint: apiKeyInfo.fingerprint,
          };
        }
      }
    }

    console.log(`[integration-health] Result: all_present=${result.ok}, email_configured=${emailGatewayReport.configured}`);

    return jsonResponse(result);

  } catch (err) {
    console.error('[integration-health] Error:', err);
    return errorResponse(
      'INTERNAL_ERROR',
      err instanceof Error ? err.message : 'An unexpected error occurred',
      500
    );
  }
});
