/**
 * Egress Proxy — Dedicated Edge Function (v2 Hardened)
 *
 * ALL outbound HTTP calls to external services MUST be routed through this proxy.
 *
 * v2 Enhancements:
 * - Purpose-scoped allowlists (analytics, email, payments, judicial, ai, webhook)
 * - Server-only auth via x-egress-internal-token (service role SHA256)
 * - Per-purpose PII scanners (strict for analytics, relaxed for email/payments)
 * - Payload-free violation logging (no raw bodies/headers stored)
 * - Destination key support (named destinations instead of raw URLs)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-egress-caller, x-egress-tenant-hash, x-egress-internal-token, x-egress-purpose",
};

// ── Purpose Types ────────────────────────────────────────────────────
type EgressPurpose = "analytics" | "error_tracking" | "email" | "payments" | "judicial_source" | "ai" | "webhook";

const VALID_PURPOSES: EgressPurpose[] = ["analytics", "error_tracking", "email", "payments", "judicial_source", "ai", "webhook"];

// ── Purpose-Scoped Domain Allowlists ─────────────────────────────────
const PURPOSE_ALLOWLISTS: Record<EgressPurpose, string[]> = {
  analytics: [
    "app.posthog.com", "us.posthog.com", "eu.posthog.com",
  ],
  error_tracking: [
    "sentry.io", "o0.ingest.sentry.io",
  ],
  email: [
    "api.resend.com",
  ],
  payments: [
    "api.wompi.co", "sandbox.wompi.co", "production.wompi.co",
  ],
  judicial_source: [
    "consultaprocesos.ramajudicial.gov.co", "procesos.ramajudicial.gov.co",
    "samai.consejodeestado.gov.co",
    "www.corteconstitucional.gov.co", "relatoria.corteconstitucional.gov.co",
  ],
  ai: [
    "generativelanguage.googleapis.com",
  ],
  webhook: [], // No pre-approved webhook domains — must be added per-integration
};

// ── Named Destination Keys ───────────────────────────────────────────
// Callers can use a destination_key instead of a raw URL for known endpoints
const DESTINATION_REGISTRY: Record<string, { url: string; purpose: EgressPurpose }> = {
  POSTHOG_CAPTURE: { url: "https://us.posthog.com/capture", purpose: "analytics" },
  POSTHOG_DECIDE: { url: "https://us.posthog.com/decide", purpose: "analytics" },
  SENTRY_ENVELOPE: { url: "https://o0.ingest.sentry.io/api/envelope/", purpose: "error_tracking" },
  RESEND_EMAILS: { url: "https://api.resend.com/emails", purpose: "email" },
  WOMPI_TRANSACTIONS: { url: "https://production.wompi.co/v1/transactions", purpose: "payments" },
  WOMPI_SANDBOX_TXN: { url: "https://sandbox.wompi.co/v1/transactions", purpose: "payments" },
  GEMINI_GENERATE: { url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", purpose: "ai" },
};

function isDomainAllowedForPurpose(url: string, purpose: EgressPurpose): { allowed: boolean } {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const allowedDomains = PURPOSE_ALLOWLISTS[purpose] || [];
    const allowed = allowedDomains.some(d => hostname === d || hostname.endsWith(`.${d}`));
    return { allowed };
  } catch {
    return { allowed: false };
  }
}

// ── Server-Only Auth ─────────────────────────────────────────────────
// The proxy ONLY accepts calls from trusted server contexts.
// Validates a SHA256 hash of the service role key as internal token.
async function validateInternalCaller(req: Request): Promise<boolean> {
  const internalToken = req.headers.get("x-egress-internal-token");
  if (!internalToken) return false;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return false;

  // Accept service role key directly (for backward compat with egressClient)
  // or its SHA256 hash
  if (internalToken === serviceKey) return true;

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(serviceKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    return internalToken === hashHex;
  } catch {
    return false;
  }
}

// ── Purpose-Specific PII Scanners ────────────────────────────────────

// Keys always blocked regardless of purpose
const ALWAYS_BLOCKED_KEYS = [
  "document_text", "case_content", "search_query", "note_text",
  "password", "secret", "api_key", "credential", "raw_text", "normalized_text",
];

// Keys blocked for analytics/error_tracking/webhook but allowed for email/payments
const ANALYTICS_BLOCKED_KEYS = [
  "party_name", "email", "phone", "cedula", "nit", "address",
  "full_name", "first_name", "last_name", "file_name", "token",
];

// Regex patterns always blocked
const STRICT_PII_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "colombian_cedula", regex: /\b\d{6,10}\b/g },
  { name: "colombian_nit", regex: /\b\d{9}-\d\b/g },
  { name: "email_address", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "phone_number", regex: /\+?57\s?\d{10}/g },
  { name: "jwt_token", regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
  { name: "api_key_pattern", regex: /\b(sk_|pk_|key_|secret_)[a-zA-Z0-9]{20,}\b/g },
];

// Patterns only blocked for analytics/webhooks (emails & phones are valid in email/payments)
const ANALYTICS_ONLY_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "email_address", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "phone_number", regex: /\+?57\s?\d{10}/g },
  { name: "ip_address", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
];

interface PiiViolation {
  pattern: string;
  key?: string;
}

function scanPayload(payload: unknown, purpose: EgressPurpose): PiiViolation[] {
  const violations: PiiViolation[] = [];
  if (!payload) return violations;

  const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  const isStrictPurpose = ["analytics", "error_tracking", "webhook"].includes(purpose);

  // Check blocked keys
  if (typeof payload === "object" && payload !== null) {
    const keys = flattenKeys(payload as Record<string, unknown>);
    for (const key of keys) {
      const keyLower = key.toLowerCase();
      // Always-blocked keys
      if (ALWAYS_BLOCKED_KEYS.some(b => keyLower.includes(b))) {
        violations.push({ pattern: "blocked_key", key });
      }
      // Purpose-specific blocked keys (analytics/webhooks)
      if (isStrictPurpose && ANALYTICS_BLOCKED_KEYS.some(b => keyLower.includes(b))) {
        violations.push({ pattern: "blocked_key_analytics", key });
      }
    }
  }

  // Regex patterns — always check strict patterns for all purposes
  for (const { name, regex } of STRICT_PII_PATTERNS) {
    // Skip email/phone for email and payments purposes
    if (!isStrictPurpose && (name === "email_address" || name === "phone_number")) continue;
    regex.lastIndex = 0;
    if (regex.test(jsonStr)) {
      violations.push({ pattern: name });
    }
  }

  // Additional analytics-only patterns
  if (isStrictPurpose) {
    for (const { name, regex } of ANALYTICS_ONLY_PATTERNS) {
      regex.lastIndex = 0;
      if (regex.test(jsonStr)) {
        // Avoid duplicates
        if (!violations.some(v => v.pattern === name)) {
          violations.push({ pattern: name });
        }
      }
    }
  }

  // Large text blob check (> 500 chars) — always block
  if (typeof payload === "object" && payload !== null) {
    checkForLargeBlobs(payload as Record<string, unknown>, violations);
  }

  return violations;
}

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    keys.push(fullKey);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, fullKey));
    }
  }
  return keys;
}

function checkForLargeBlobs(obj: Record<string, unknown>, violations: PiiViolation[], prefix = "") {
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" && v.length > 500) {
      violations.push({ pattern: "large_text_blob", key: fullKey });
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      checkForLargeBlobs(v as Record<string, unknown>, violations, fullKey);
    }
  }
}

// ── Rate Limiting (in-memory, per-instance) ──────────────────────────
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const MAX_REQUESTS_PER_MINUTE = 60;

function checkRateLimit(tenantHash: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(tenantHash);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(tenantHash, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_REQUESTS_PER_MINUTE;
}

// ── Payload-Free Violation Logger ────────────────────────────────────
// CRITICAL: Never stores raw payloads, headers, or query strings
async function logViolation(
  supabaseAdmin: ReturnType<typeof createClient>,
  violation: {
    type: "DOMAIN_BLOCKED" | "PII_DETECTED" | "RATE_LIMITED" | "INVALID_REQUEST" | "AUTH_FAILED";
    caller: string;
    tenantHash: string;
    purpose: string;
    targetDomain: string; // domain only, never full URL
    rule_triggered: string;
    payload_size_bucket: string;
    request_id: string;
  }
) {
  try {
    await supabaseAdmin.from("atenia_ai_observations").insert({
      kind: "EGRESS_VIOLATION",
      severity: violation.type === "PII_DETECTED" ? "CRITICAL" : "WARNING",
      title: `Egress ${violation.type}: ${violation.caller} → ${violation.targetDomain} [${violation.purpose}]`,
      payload: {
        type: violation.type,
        caller: violation.caller,
        tenant_hash: violation.tenantHash,
        purpose: violation.purpose,
        target_domain: violation.targetDomain,
        rule_triggered: violation.rule_triggered,
        payload_size_bucket: violation.payload_size_bucket,
        request_id: violation.request_id,
        timestamp: new Date().toISOString(),
        // NO raw body, NO headers, NO query strings
      },
    });
  } catch (err) {
    console.error("[egress-proxy] Failed to log violation:", err);
  }
}

function getPayloadSizeBucket(payload: unknown): string {
  if (!payload) return "empty";
  const size = JSON.stringify(payload).length;
  if (size < 256) return "<256B";
  if (size < 1024) return "<1KB";
  if (size < 10240) return "<10KB";
  if (size < 102400) return "<100KB";
  return ">100KB";
}

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return "invalid"; }
}

// ── Main Handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  try {
    const body = await req.clone().json().catch(() => null);
    if (body?.health_check === true) {
      return new Response(JSON.stringify({ status: "ok", service: "egress-proxy", version: "2.0" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* not JSON, continue */ }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const requestId = crypto.randomUUID();

  // ── Guard 0: Server-only authentication ──
  const isInternalCaller = await validateInternalCaller(req);
  if (!isInternalCaller) {
    // Check Authorization header as fallback (service role bearer)
    const authHeader = req.headers.get("authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isServiceRole = authHeader === `Bearer ${serviceKey}`;

    if (!isServiceRole) {
      return new Response(
        JSON.stringify({ error: "EGRESS_AUTH_FAILED", reason: "Server-only endpoint. Browser calls are not permitted." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let payload: {
    target_url?: string;
    destination_key?: string; // Named destination instead of raw URL
    purpose: EgressPurpose;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    caller?: string;
    tenant_hash?: string;
  };

  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const {
    purpose,
    method = "POST",
    headers: outboundHeaders = {},
    body: outboundBody,
    caller = "unknown",
    tenant_hash = "unknown",
  } = payload;

  // ── Guard 1: Purpose validation ──
  if (!purpose || !VALID_PURPOSES.includes(purpose)) {
    return new Response(
      JSON.stringify({ error: "EGRESS_INVALID_PURPOSE", reason: `Purpose must be one of: ${VALID_PURPOSES.join(", ")}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Resolve target URL ──
  let targetUrl: string;
  if (payload.destination_key) {
    const dest = DESTINATION_REGISTRY[payload.destination_key];
    if (!dest) {
      return new Response(
        JSON.stringify({ error: "EGRESS_UNKNOWN_DESTINATION", reason: `Unknown destination_key: ${payload.destination_key}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (dest.purpose !== purpose) {
      return new Response(
        JSON.stringify({ error: "EGRESS_PURPOSE_MISMATCH", reason: `Destination ${payload.destination_key} requires purpose '${dest.purpose}', got '${purpose}'` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    targetUrl = dest.url;
  } else if (payload.target_url) {
    targetUrl = payload.target_url;
  } else {
    return new Response(
      JSON.stringify({ error: "EGRESS_NO_TARGET", reason: "Provide target_url or destination_key" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const targetDomain = getDomain(targetUrl);
  const sizeBucket = getPayloadSizeBucket(outboundBody);

  // ── Guard 2: Purpose-scoped domain allowlist ──
  const domainCheck = isDomainAllowedForPurpose(targetUrl, purpose);
  if (!domainCheck.allowed) {
    await logViolation(supabaseAdmin, {
      type: "DOMAIN_BLOCKED",
      caller, tenantHash: tenant_hash, purpose, targetDomain,
      rule_triggered: "domain_not_in_purpose_allowlist",
      payload_size_bucket: sizeBucket, request_id: requestId,
    });
    return new Response(
      JSON.stringify({ error: "EGRESS_BLOCKED", reason: `Domain not allowed for purpose '${purpose}'` }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Guard 3: Rate limiting ──
  if (!checkRateLimit(tenant_hash)) {
    await logViolation(supabaseAdmin, {
      type: "RATE_LIMITED",
      caller, tenantHash: tenant_hash, purpose, targetDomain,
      rule_triggered: "rate_limit_exceeded",
      payload_size_bucket: sizeBucket, request_id: requestId,
    });
    return new Response(
      JSON.stringify({ error: "EGRESS_RATE_LIMITED", reason: "Too many requests" }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Guard 4: Purpose-specific PII scan ──
  const piiViolations = scanPayload(outboundBody, purpose);
  if (piiViolations.length > 0) {
    await logViolation(supabaseAdmin, {
      type: "PII_DETECTED",
      caller, tenantHash: tenant_hash, purpose, targetDomain,
      rule_triggered: piiViolations.map(v => v.pattern).join(","),
      payload_size_bucket: sizeBucket, request_id: requestId,
    });
    return new Response(
      JSON.stringify({
        error: "EGRESS_PII_BLOCKED",
        reason: "Payload contains sensitive data patterns",
        violation_count: piiViolations.length,
        patterns: piiViolations.map(v => v.pattern),
      }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Execute proxied request ──
  try {
    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: {
        "Content-Type": "application/json",
        ...outboundHeaders,
      },
    };

    if (outboundBody && !["GET", "HEAD"].includes(method.toUpperCase())) {
      fetchOptions.body = typeof outboundBody === "string" ? outboundBody : JSON.stringify(outboundBody);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const responseBody = await response.text();

    return new Response(
      JSON.stringify({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
        egress_metadata: {
          purpose,
          domain: targetDomain,
          caller,
          request_id: requestId,
          proxied_at: new Date().toISOString(),
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[egress-proxy] Fetch error:", err);
    return new Response(
      JSON.stringify({
        error: "EGRESS_FETCH_FAILED",
        reason: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
