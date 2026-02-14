/**
 * Egress Client — Safe outbound fetch helper for edge functions
 *
 * All external HTTP calls from edge functions MUST use this helper
 * instead of raw fetch(). Routes through the egress-proxy for
 * domain allowlist enforcement and PII scanning.
 *
 * Usage in edge functions:
 *   import { egressFetch } from "../_shared/egressClient.ts";
 *   const result = await egressFetch({
 *     targetUrl: "https://app.posthog.com/capture",
 *     method: "POST",
 *     body: { event: "test" },
 *     caller: "posthog-adapter",
 *     tenantHash: "abc123",
 *   });
 */

interface EgressRequest {
  targetUrl: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  caller: string;
  tenantHash?: string;
}

interface EgressResponse {
  ok: boolean;
  status: number;
  body: string;
  egress_metadata?: {
    domain_category: string;
    caller: string;
    proxied_at: string;
  };
  error?: string;
  reason?: string;
}

export async function egressFetch(request: EgressRequest): Promise<EgressResponse> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    throw new Error("[egressFetch] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const proxyUrl = `${supabaseUrl}/functions/v1/egress-proxy`;

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        target_url: request.targetUrl,
        method: request.method || "POST",
        headers: request.headers || {},
        body: request.body,
        caller: request.caller,
        tenant_hash: request.tenantHash || "system",
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        body: "",
        error: result.error,
        reason: result.reason,
      };
    }

    return {
      ok: true,
      status: result.status || 200,
      body: result.body || "",
      egress_metadata: result.egress_metadata,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: "",
      error: "EGRESS_CLIENT_ERROR",
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Check if a URL would be allowed by the egress proxy
 * (client-side pre-check, not authoritative)
 */
export function isEgressAllowed(url: string): boolean {
  const KNOWN_DOMAINS = [
    "app.posthog.com", "us.posthog.com", "eu.posthog.com",
    "sentry.io", "o0.ingest.sentry.io",
    "api.resend.com",
    "api.wompi.co", "sandbox.wompi.co", "production.wompi.co",
    "consultaprocesos.ramajudicial.gov.co", "procesos.ramajudicial.gov.co",
    "samai.consejodeestado.gov.co",
    "generativelanguage.googleapis.com",
  ];

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return KNOWN_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}
