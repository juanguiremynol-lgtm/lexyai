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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Required secret names for judicial providers
const REQUIRED_SECRETS = [
  "CPNU_BASE_URL",
  "SAMAI_BASE_URL",
  "TUTELAS_BASE_URL",
  "PUBLICACIONES_BASE_URL",
  "EXTERNAL_X_API_KEY",
];

// Optional provider-specific API keys (take precedence over EXTERNAL_X_API_KEY)
const OPTIONAL_API_KEYS = ["CPNU_X_API_KEY", "SAMAI_X_API_KEY", "TUTELAS_X_API_KEY", "PUBLICACIONES_X_API_KEY"];

// Email gateway secrets (Cloud Run Option B)
const EMAIL_GATEWAY_SECRETS = ["EMAIL_GATEWAY_BASE_URL", "EMAIL_GATEWAY_API_KEY", "EMAIL_FROM_ADDRESS"];

// Safe fingerprint generation (first 8 chars of sha256)
async function hashFingerprint(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex.slice(0, 8);
}

// Get API key for a provider with safe diagnostics
async function getApiKeyInfo(
  provider: string,
): Promise<{ source: string; present: boolean; fingerprint: string | null }> {
  const providerKeyMap: Record<string, string> = {
    cpnu: "CPNU_X_API_KEY",
    samai: "SAMAI_X_API_KEY",
    tutelas: "TUTELAS_X_API_KEY",
    publicaciones: "PUBLICACIONES_X_API_KEY",
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
  const sharedKey = Deno.env.get("EXTERNAL_X_API_KEY");
  if (sharedKey && sharedKey.length > 0) {
    return {
      source: "EXTERNAL_X_API_KEY",
      present: true,
      fingerprint: await hashFingerprint(sharedKey),
    };
  }

  return { source: "MISSING", present: false, fingerprint: null };
}

// Provider connectivity check (GET /health - no auth assumed)
interface ProviderConnectivityCheck {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
}

// Provider auth check (GET /snapshot with test radicado - requires valid API key)
interface ProviderAuthCheck {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  error_code?: string; // UPSTREAM_AUTH, UPSTREAM_ROUTE_MISSING, RECORD_NOT_FOUND, SKIPPED, etc.
  api_key_source: string;
  api_key_present: boolean;
  api_key_fingerprint: string | null;
  test_identifier_used?: string; // The test radicado used (masked)
  auth_endpoint_used?: string; // The actual endpoint path used for auth test
  hint?: string; // Actionable hint for the user
  response_kind?: "JSON" | "HTML_CANNOT_GET" | "HTML_OTHER" | "EMPTY" | "ERROR";
  response_headers_snippet?: Record<string, string>; // Sanitized headers (e.g., WWW-Authenticate)
}

// Combined provider health check result
interface ProviderHealthCheck {
  connectivity: ProviderConnectivityCheck;
  auth?: ProviderAuthCheck;
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
  // NEW: Combined connectivity + auth checks per provider
  provider_health?: Record<string, ProviderHealthCheck>;
  // NEW: Test identifier configuration
  test_identifiers?: {
    cpnu_test_radicado_set: boolean;
    samai_test_radicado_set: boolean;
  };
  timestamp: string;
  user_role?: string;
}

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string, status: number = 400): Response {
  return jsonResponse({ ok: false, code, message }, status);
}

// Detect if response body looks like HTML "Cannot GET" (Express 404)
function isHtmlCannotGet(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes("cannot get") ||
    lower.includes("<!doctype html") ||
    lower.includes("<html") ||
    lower.includes("not found</pre>") ||
    lower.includes("404 not found") ||
    lower.includes("<title>404")
  );
}

/**
 * CRITICAL: Detect if response is a FastAPI/Starlette generic "route not found" 404
 * 
 * FastAPI returns {"detail":"Not Found"} when the ROUTE doesn't exist.
 * This is different from application-level "record not found" responses which
 * typically have more specific error messages or fields.
 * 
 * Examples of ROUTE_NOT_FOUND (framework-level 404):
 * - {"detail":"Not Found"}  (FastAPI/Starlette default)
 * - {"detail":"Method Not Allowed"} (FastAPI)
 * - {"message":"Not Found"} (Express JSON)
 * 
 * Examples of RECORD_NOT_FOUND (application-level 404):
 * - {"success":false,"error":"Radicado not found in cache"}
 * - {"found":false,"message":"No records for this radicado"}
 * - {"status":"not_cached","job_id":"..."}
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
        errorMsg.includes("no snapshot")) {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

// Classify response kind with enhanced logic
function classifyResponseKind(body: string): ProviderAuthCheck["response_kind"] {
  if (!body || body.trim() === "") return "EMPTY";

  try {
    JSON.parse(body);
    return "JSON";
  } catch {
    if (isHtmlCannotGet(body)) {
      return "HTML_CANNOT_GET";
    }
    return "HTML_OTHER";
  }
}

// Safe URL join that handles base, prefix, and path
function joinUrl(baseUrl: string, prefix: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  let cleanPrefix = (prefix || "").trim();
  if (cleanPrefix === "/") cleanPrefix = "";
  if (cleanPrefix && !cleanPrefix.startsWith("/")) {
    cleanPrefix = "/" + cleanPrefix;
  }
  cleanPrefix = cleanPrefix.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPrefix}${cleanPath}`;
}

// Check connectivity only (GET /health - no auth assumptions)
async function checkConnectivity(
  provider: string,
  baseUrl: string | undefined,
  pathPrefix: string,
): Promise<ProviderConnectivityCheck> {
  if (!baseUrl) {
    return { ok: false, error: "URL not configured" };
  }

  try {
    const start = Date.now();
    const healthUrl = joinUrl(baseUrl, pathPrefix, "/health");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(healthUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

// Provider-specific auth test endpoints
// Each provider has different API contracts for authenticated lookups
// NOTE: SAMAI only has /buscar (triggers scraping) and /resultado/{jobId} (poll results)
// NOTE: PUBLICACIONES uses /buscar for async job creation or /publicaciones for direct lookup
const AUTH_TEST_ENDPOINTS: Record<string, (testId: string) => string> = {
  cpnu: (id) => `/snapshot?numero_radicacion=${id}`,
  samai: (id) => `/buscar?numero_radicacion=${id}`, // SAMAI uses /buscar which returns 200 + jobId
  tutelas: (id) => `/expediente/${id}`, // Tutelas uses path-based
  publicaciones: (id) => `/buscar?radicado=${id}`, // Publicaciones uses /buscar for async jobs
};

// Check auth by calling an authenticated endpoint (provider-specific - requires valid API key)
async function checkAuthWithSnapshot(
  provider: string,
  baseUrl: string | undefined,
  pathPrefix: string,
  testRadicado: string | undefined,
  apiKeyInfo: { source: string; present: boolean; fingerprint: string | null; value?: string },
): Promise<ProviderAuthCheck> {
  const result: ProviderAuthCheck = {
    ok: false,
    api_key_source: apiKeyInfo.source,
    api_key_present: apiKeyInfo.present,
    api_key_fingerprint: apiKeyInfo.fingerprint,
  };

  // Skip if no test radicado configured
  if (!testRadicado || testRadicado.trim() === "") {
    result.error_code = "SKIPPED";
    result.error = "No test radicado configured";
    result.hint = `Set ${provider.toUpperCase()}_TEST_RADICADO to enable auth check.`;
    return result;
  }

  // Skip if no API key
  if (!apiKeyInfo.present || !apiKeyInfo.value) {
    result.error_code = "MISSING_KEY";
    result.error = "No API key configured";
    result.hint = `Set ${provider.toUpperCase()}_X_API_KEY or EXTERNAL_X_API_KEY.`;
    return result;
  }

  if (!baseUrl) {
    result.error_code = "NOT_CONFIGURED";
    result.error = "Base URL not configured";
    return result;
  }

  // Get provider-specific endpoint builder
  const getEndpoint = AUTH_TEST_ENDPOINTS[provider];
  if (!getEndpoint) {
    result.error_code = "UNKNOWN_PROVIDER";
    result.error = `Unknown provider: ${provider}`;
    result.hint = `Provider '${provider}' is not configured for auth testing.`;
    return result;
  }

  try {
    const start = Date.now();
    const authPath = getEndpoint(testRadicado.trim());
    const authUrl = joinUrl(baseUrl, pathPrefix, authPath);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(authUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKeyInfo.value, // ✅ FIXED: Changed to lowercase
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;
    const bodyText = await response.text();
    const responseKind = classifyResponseKind(bodyText);

    result.status = response.status;
    result.latencyMs = latencyMs;
    result.response_kind = responseKind;
    result.test_identifier_used = `${testRadicado.slice(0, 6)}...${testRadicado.slice(-4)}`;
    result.auth_endpoint_used = authPath; // Return the actual endpoint used for display

    // Extract useful response headers (sanitized)
    const wwwAuth = response.headers.get("WWW-Authenticate");
    if (wwwAuth) {
      result.response_headers_snippet = { "WWW-Authenticate": wwwAuth.slice(0, 200) };
    }

    // Classify the result
    if (response.ok) {
      result.ok = true;
      result.error_code = undefined;
      return result;
    }

    // Auth failure
    if (response.status === 401 || response.status === 403) {
      result.error_code = "UPSTREAM_AUTH";
      result.error = `Auth failed (HTTP ${response.status})`;
      result.hint = `/health is reachable; protected endpoints are rejecting the key. Verify Cloud Run API_KEYS parsing/middleware. Key source: ${apiKeyInfo.source}, fingerprint: ${apiKeyInfo.fingerprint}`;
      return result;
    }

    // Route mismatch (HTML 404)
    if (response.status === 404 && responseKind === "HTML_CANNOT_GET") {
      result.error_code = "UPSTREAM_ROUTE_MISSING";
      result.error = "Route not found (HTML Cannot GET)";
      result.hint =
        `The ${authPath} endpoint may not exist on this service. Check BASE_URL and PATH_PREFIX configuration.`;
      return result;
    }

    // CRITICAL: FastAPI generic 404 {"detail":"Not Found"} means ROUTE doesn't exist
    // This is NOT the same as "record not found" - the endpoint itself is missing
    if (response.status === 404 && responseKind === "JSON" && isFastApiRouteNotFound(bodyText)) {
      result.error_code = "UPSTREAM_ROUTE_MISSING";
      result.error = "Route not found (FastAPI 404)";
      result.hint =
        `The ${authPath} endpoint returned {"detail":"Not Found"} which indicates the route does not exist. ` +
        `Check PUBLICACIONES_BASE_URL and ensure the correct path prefix is set.`;
      return result;
    }

    // Domain-specific record not found (JSON 404 with application-level error)
    // This IS a valid route - auth worked, record just doesn't exist
    if (response.status === 404 && responseKind === "JSON" && isDomainRecordNotFound(bodyText)) {
      result.ok = true; // Auth worked, route exists, record just doesn't exist
      result.error_code = "RECORD_NOT_FOUND";
      result.error = "Test radicado not found (auth succeeded)";
      result.hint =
        "Auth check passed. The endpoint exists and auth is working, but the test radicado is not in the system.";
      return result;
    }

    // Generic JSON 404 - could be either, default to route missing for safety
    if (response.status === 404 && responseKind === "JSON") {
      result.error_code = "UPSTREAM_ROUTE_MISSING";
      result.error = "Route possibly not found (ambiguous JSON 404)";
      result.hint =
        `The ${authPath} endpoint returned a JSON 404 that doesn't match expected patterns. ` +
        `Verify the endpoint path exists on this service.`;
      return result;
    }

    // Other errors
    result.error_code = `HTTP_${response.status}`;
    result.error = `Unexpected response: HTTP ${response.status}`;
    return result;
  } catch (err) {
    result.error_code = "NETWORK_ERROR";
    result.error = err instanceof Error ? err.message : "Network error";
    return result;
  }
}

// Legacy reachability check (backward compatible)
async function checkReachability(
  name: string,
  baseUrl: string | undefined,
  apiKey: string | undefined,
): Promise<{ ok: boolean; status?: number; latencyMs?: number; error?: string }> {
  if (!baseUrl) {
    return { ok: false, error: "URL not configured" };
  }

  try {
    const start = Date.now();
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (apiKey) {
      headers["x-api-key"] = apiKey; // ✅ FIXED: Changed to lowercase
    }

    const healthUrl = new URL("/health", baseUrl).toString();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(healthUrl, {
        method: "GET",
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
      clearTimeout(timeoutId);

      try {
        const headStart = Date.now();
        const headResponse = await fetch(baseUrl, {
          method: "HEAD",
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
          error: headErr instanceof Error ? headErr.message : "Connection failed",
          latencyMs: Date.now() - start,
        };
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("MISSING_ENV", "Missing Supabase environment variables", 500);
    }

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("UNAUTHORIZED", "Missing Authorization header", 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "");

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authError } = await anonClient.auth.getClaims(token);

    if (authError || !claims?.claims?.sub) {
      return errorResponse("UNAUTHORIZED", "Invalid or expired token", 401);
    }

    const userId = claims.claims.sub as string;

    // Check if user is platform admin
    const { data: platformAdmin } = await supabase
      .from("platform_admins")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    const isPlatformAdmin = !!platformAdmin;

    // If not platform admin, check if user is org admin of any org
    let isOrgAdmin = false;
    if (!isPlatformAdmin) {
      const { data: adminMemberships } = await supabase
        .from("organization_memberships")
        .select("id, role")
        .eq("user_id", userId)
        .in("role", ["OWNER", "ADMIN"])
        .limit(1);

      isOrgAdmin = (adminMemberships?.length ?? 0) > 0;
    }

    if (!isPlatformAdmin && !isOrgAdmin) {
      return errorResponse("FORBIDDEN", "This endpoint requires platform admin or organization admin access", 403);
    }

    console.log(
      `[integration-health] Access granted: user=${userId}, platformAdmin=${isPlatformAdmin}, orgAdmin=${isOrgAdmin}`,
    );

    // Check if reachability tests are requested
    const url = new URL(req.url);
    const checkReach = url.searchParams.get("reachability") === "true";
    const checkAuth = url.searchParams.get("auth_check") === "true";

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
    const emailGatewayBaseUrl = Deno.env.get("EMAIL_GATEWAY_BASE_URL");
    const emailGatewayApiKey = Deno.env.get("EMAIL_GATEWAY_API_KEY");
    const emailFromAddress = Deno.env.get("EMAIL_FROM_ADDRESS");

    const emailGatewayReport = {
      configured: !!(emailGatewayBaseUrl && emailGatewayApiKey),
      base_url_set: !!emailGatewayBaseUrl && emailGatewayBaseUrl.length > 0,
      api_key_set: !!emailGatewayApiKey && emailGatewayApiKey.length > 0,
      from_address_set: !!emailFromAddress && emailFromAddress.length > 0,
    };

    // Check for test identifiers (for auth checks)
    const cpnuTestRadicado = Deno.env.get("CPNU_TEST_RADICADO");
    const samaiTestRadicado = Deno.env.get("SAMAI_TEST_RADICADO");

    const result: HealthResult = {
      ok: Object.values(envReport).every(Boolean) && emailGatewayReport.configured,
      env: envReport,
      optional_keys: optionalKeysReport,
      email_gateway: emailGatewayReport,
      test_identifiers: {
        cpnu_test_radicado_set: !!cpnuTestRadicado && cpnuTestRadicado.length > 0,
        samai_test_radicado_set: !!samaiTestRadicado && samaiTestRadicado.length > 0,
      },
      timestamp: new Date().toISOString(),
      user_role: isPlatformAdmin ? "platform_admin" : "org_admin",
    };

    // Optional reachability checks (basic connectivity - legacy)
    if (checkReach) {
      const providers = ["cpnu", "samai", "tutelas", "publicaciones"] as const;
      result.reachability = {};

      for (const provider of providers) {
        const apiKeyInfo = await getApiKeyInfo(provider);
        const baseUrl = Deno.env.get(`${provider.toUpperCase()}_BASE_URL`);
        result.reachability[provider] = await checkReachability(
          provider,
          baseUrl,
          apiKeyInfo.present ? Deno.env.get(apiKeyInfo.source) : undefined,
        );
      }

      // Also check email gateway if configured
      if (emailGatewayBaseUrl) {
        result.reachability.email_gateway = await checkReachability(
          "email_gateway",
          emailGatewayBaseUrl,
          emailGatewayApiKey,
        );
      }
    }

    // NEW: Combined provider health checks (connectivity + auth)
    // Now includes PUBLICACIONES alongside CPNU and SAMAI
    const providers = ["cpnu", "samai", "publicaciones"] as const;
    result.provider_health = {};

    // Get test radicados for all providers
    const publicacionesTestRadicado = Deno.env.get("PUBLICACIONES_TEST_RADICADO") || cpnuTestRadicado;

    for (const provider of providers) {
      const baseUrl = Deno.env.get(`${provider.toUpperCase()}_BASE_URL`);
      const pathPrefix = Deno.env.get(`${provider.toUpperCase()}_PATH_PREFIX`) || "";
      
      // Use appropriate test radicado per provider
      let testRadicado: string | undefined;
      if (provider === "cpnu") testRadicado = cpnuTestRadicado;
      else if (provider === "samai") testRadicado = samaiTestRadicado;
      else if (provider === "publicaciones") testRadicado = publicacionesTestRadicado;
      
      const apiKeyInfo = await getApiKeyInfo(provider);

      // A) Connectivity check (GET /health - no auth assumptions)
      const connectivity = await checkConnectivity(provider, baseUrl, pathPrefix);

      // B) Auth check (GET /snapshot or /buscar with test radicado - requires valid API key)
      const authCheck = await checkAuthWithSnapshot(provider, baseUrl, pathPrefix, testRadicado, {
        source: apiKeyInfo.source,
        present: apiKeyInfo.present,
        fingerprint: apiKeyInfo.fingerprint,
        value: apiKeyInfo.present ? Deno.env.get(apiKeyInfo.source) : undefined,
      });

      result.provider_health[provider] = {
        connectivity,
        auth: authCheck,
      };
    }

    // Add publicaciones test radicado to the report
    result.test_identifiers = {
      cpnu_test_radicado_set: !!cpnuTestRadicado && cpnuTestRadicado.length > 0,
      samai_test_radicado_set: !!samaiTestRadicado && samaiTestRadicado.length > 0,
      publicaciones_test_radicado_set: !!publicacionesTestRadicado && publicacionesTestRadicado.length > 0,
    } as any;

    // Optional legacy auth checks (backward compatibility - calls /health with key)
    if (checkAuth) {
      const allProviders = ["cpnu", "samai", "tutelas", "publicaciones"] as const;
      result.auth_checks = {};

      for (const provider of allProviders) {
        const apiKeyInfo = await getApiKeyInfo(provider);
        const baseUrl = Deno.env.get(`${provider.toUpperCase()}_BASE_URL`);

        if (!baseUrl) {
          result.auth_checks[provider] = {
            ok: false,
            error: "URL not configured",
            api_key_source: apiKeyInfo.source,
            api_key_present: apiKeyInfo.present,
            api_key_fingerprint: apiKeyInfo.fingerprint,
          };
          continue;
        }

        // Call /health with the selected API key
        const start = Date.now();
        try {
          const headers: Record<string, string> = { Accept: "application/json" };
          if (apiKeyInfo.present) {
            const keyValue = Deno.env.get(apiKeyInfo.source);
            if (keyValue) headers["x-api-key"] = keyValue; // ✅ FIXED: Changed to lowercase
          }

          const healthUrl = new URL("/health", baseUrl).toString();
          const response = await fetch(healthUrl, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(10000),
          });

          const latencyMs = Date.now() - start;

          result.auth_checks[provider] = {
            ok: response.ok,
            status: response.status,
            latencyMs,
            error: response.ok
              ? undefined
              : response.status === 401 || response.status === 403
                ? `Auth failed (${response.status}). Check ${apiKeyInfo.source} or Cloud Run API_KEYS.`
                : `HTTP ${response.status}`,
            api_key_source: apiKeyInfo.source,
            api_key_present: apiKeyInfo.present,
            api_key_fingerprint: apiKeyInfo.fingerprint,
          };
        } catch (err) {
          result.auth_checks[provider] = {
            ok: false,
            latencyMs: Date.now() - start,
            error: err instanceof Error ? err.message : "Connection failed",
            api_key_source: apiKeyInfo.source,
            api_key_present: apiKeyInfo.present,
            api_key_fingerprint: apiKeyInfo.fingerprint,
          };
        }
      }
    }

    console.log(
      `[integration-health] Result: all_present=${result.ok}, email_configured=${emailGatewayReport.configured}, cpnu_connectivity=${result.provider_health?.cpnu?.connectivity?.ok}, cpnu_auth=${result.provider_health?.cpnu?.auth?.ok}`,
    );

    return jsonResponse(result);
  } catch (err) {
    console.error("[integration-health] Error:", err);
    return errorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : "An unexpected error occurred", 500);
  }
});
