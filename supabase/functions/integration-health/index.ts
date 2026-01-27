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

// Email gateway secrets (Cloud Run Option B)
const EMAIL_GATEWAY_SECRETS = [
  'EMAIL_GATEWAY_BASE_URL',
  'EMAIL_GATEWAY_API_KEY',
  'EMAIL_FROM_ADDRESS',
];

interface HealthResult {
  ok: boolean;
  env: Record<string, boolean>;
  email_gateway: {
    configured: boolean;
    base_url_set: boolean;
    api_key_set: boolean;
    from_address_set: boolean;
  };
  reachability?: Record<string, { ok: boolean; status?: number; latencyMs?: number; error?: string }>;
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

    // Build env presence report (never expose values!)
    const envReport: Record<string, boolean> = {};
    for (const secretName of REQUIRED_SECRETS) {
      const value = Deno.env.get(secretName);
      envReport[secretName] = !!value && value.length > 0;
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
      email_gateway: emailGatewayReport,
      timestamp: new Date().toISOString(),
      user_role: isPlatformAdmin ? 'platform_admin' : 'org_admin',
    };

    // Optional reachability checks
    if (checkReach) {
      const apiKey = Deno.env.get('EXTERNAL_X_API_KEY');
      
      result.reachability = {
        cpnu: await checkReachability('cpnu', Deno.env.get('CPNU_BASE_URL'), apiKey),
        samai: await checkReachability('samai', Deno.env.get('SAMAI_BASE_URL'), apiKey),
        tutelas: await checkReachability('tutelas', Deno.env.get('TUTELAS_BASE_URL'), apiKey),
        publicaciones: await checkReachability('publicaciones', Deno.env.get('PUBLICACIONES_BASE_URL'), apiKey),
      };

      // Also check email gateway if configured
      if (emailGatewayBaseUrl) {
        result.reachability.email_gateway = await checkReachability(
          'email_gateway', 
          emailGatewayBaseUrl, 
          emailGatewayApiKey
        );
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
