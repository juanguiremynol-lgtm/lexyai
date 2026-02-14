/**
 * Egress Client — Safe outbound fetch helper for edge functions (v2)
 *
 * All external HTTP calls from edge functions MUST use this helper.
 * Routes through the egress-proxy with:
 * - Purpose declaration (required)
 * - Server-only auth token
 * - Optional destination_key (preferred over raw URLs)
 *
 * Usage:
 *   import { egressFetch } from "../_shared/egressClient.ts";
 *   const result = await egressFetch({
 *     destinationKey: "POSTHOG_CAPTURE",  // preferred
 *     purpose: "analytics",
 *     body: { event: "test" },
 *     caller: "posthog-adapter",
 *     tenantHash: "abc123",
 *   });
 *
 *   // Or with raw URL (less preferred):
 *   const result = await egressFetch({
 *     targetUrl: "https://api.resend.com/emails",
 *     purpose: "email",
 *     body: { to: "user@example.com" },
 *     caller: "email-sender",
 *   });
 */

export type EgressPurpose = "analytics" | "error_tracking" | "email" | "payments" | "judicial_source" | "judicial_demo" | "ai" | "webhook";

interface EgressRequest {
  targetUrl?: string;
  destinationKey?: string;  // Named destination (preferred)
  purpose: EgressPurpose;
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
    purpose: string;
    domain: string;
    caller: string;
    request_id: string;
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

  if (!request.purpose) {
    throw new Error("[egressFetch] Purpose is required for all egress requests");
  }

  if (!request.targetUrl && !request.destinationKey) {
    throw new Error("[egressFetch] Provide targetUrl or destinationKey");
  }

  const proxyUrl = `${supabaseUrl}/functions/v1/egress-proxy`;

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        "x-egress-internal-token": serviceKey,
        "x-egress-purpose": request.purpose,
      },
      body: JSON.stringify({
        target_url: request.targetUrl,
        destination_key: request.destinationKey,
        purpose: request.purpose,
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
 * Known destination keys — for documentation and pre-validation
 */
export const KNOWN_DESTINATIONS = {
  POSTHOG_CAPTURE: "analytics",
  POSTHOG_DECIDE: "analytics",
  SENTRY_ENVELOPE: "error_tracking",
  RESEND_EMAILS: "email",
  WOMPI_TRANSACTIONS: "payments",
  WOMPI_SANDBOX_TXN: "payments",
  GEMINI_GENERATE: "ai",
  CPNU_DEMO_LOOKUP: "judicial_demo",
  PUBLICACIONES_DEMO_SNAPSHOT: "judicial_demo",
  SAMAI_DEMO_FALLBACK: "judicial_demo",
} as const;
