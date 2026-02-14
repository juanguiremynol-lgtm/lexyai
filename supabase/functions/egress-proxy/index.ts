/**
 * Egress Proxy — Dedicated Edge Function
 *
 * ALL outbound HTTP calls to external services (analytics, webhooks, connectors)
 * MUST be routed through this proxy. It enforces:
 *
 * 1. Domain allowlist — only approved destinations
 * 2. Payload PII scanner — blocks sensitive data patterns
 * 3. Request quotas — per-tenant rate limiting
 * 4. Violation logging — immutable audit trail
 *
 * Architecture: Other edge functions call this proxy instead of fetch() directly
 * for any external-facing HTTP request.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-egress-caller, x-egress-tenant-hash",
};

// ── Domain Allowlist ─────────────────────────────────────────────────
// Only these domains can be contacted. Wildcards supported via suffix match.
const DOMAIN_ALLOWLIST: { domain: string; category: string }[] = [
  // Analytics
  { domain: "app.posthog.com", category: "analytics" },
  { domain: "us.posthog.com", category: "analytics" },
  { domain: "eu.posthog.com", category: "analytics" },
  // Error tracking
  { domain: "sentry.io", category: "error_tracking" },
  { domain: "o0.ingest.sentry.io", category: "error_tracking" },
  // Email
  { domain: "api.resend.com", category: "email" },
  // Payments
  { domain: "api.wompi.co", category: "payments" },
  { domain: "sandbox.wompi.co", category: "payments" },
  { domain: "production.wompi.co", category: "payments" },
  // Judicial sources (scraping)
  { domain: "consultaprocesos.ramajudicial.gov.co", category: "judicial_source" },
  { domain: "procesos.ramajudicial.gov.co", category: "judicial_source" },
  { domain: "samai.consejodeestado.gov.co", category: "judicial_source" },
  { domain: "www.corteconstitucional.gov.co", category: "judicial_source" },
  { domain: "relatoria.corteconstitucional.gov.co", category: "judicial_source" },
  // AI
  { domain: "generativelanguage.googleapis.com", category: "ai" },
];

function isDomainAllowed(url: string): { allowed: boolean; category: string } {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    for (const entry of DOMAIN_ALLOWLIST) {
      if (
        hostname === entry.domain ||
        hostname.endsWith(`.${entry.domain}`)
      ) {
        return { allowed: true, category: entry.category };
      }
    }
    return { allowed: false, category: "unknown" };
  } catch {
    return { allowed: false, category: "invalid_url" };
  }
}

// ── PII Scanner ──────────────────────────────────────────────────────
// Patterns that MUST NOT appear in outbound payloads
const PII_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "colombian_cedula", regex: /\b\d{6,10}\b/g }, // Cédula-like numbers (6-10 digits)
  { name: "colombian_nit", regex: /\b\d{9}-\d\b/g }, // NIT format
  { name: "email_address", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "phone_number", regex: /\+?57\s?\d{10}/g }, // Colombian phone
  { name: "ip_address", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: "jwt_token", regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
  { name: "api_key_pattern", regex: /\b(sk_|pk_|key_|secret_)[a-zA-Z0-9]{20,}\b/g },
  { name: "uuid_raw", regex: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi },
];

// Keys that should never appear in outbound JSON
const BLOCKED_PAYLOAD_KEYS = [
  "party_name", "document_text", "case_content", "email", "phone",
  "cedula", "nit", "address", "search_query", "note_text", "file_name",
  "full_name", "first_name", "last_name", "password", "token", "secret",
  "api_key", "credential", "raw_text", "normalized_text",
];

interface PiiViolation {
  pattern: string;
  key?: string;
  sample?: string; // Truncated, never the full value
}

function scanPayloadForPii(payload: unknown): PiiViolation[] {
  const violations: PiiViolation[] = [];
  if (!payload) return violations;

  const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);

  // Check for blocked keys in JSON objects
  if (typeof payload === "object" && payload !== null) {
    const flat = flattenKeys(payload as Record<string, unknown>);
    for (const key of flat) {
      const keyLower = key.toLowerCase();
      if (BLOCKED_PAYLOAD_KEYS.some((b) => keyLower.includes(b))) {
        violations.push({ pattern: "blocked_key", key, sample: `[key: ${key}]` });
      }
    }
  }

  // Check for PII regex patterns in serialized payload
  // Skip UUID check for analytics payloads (hashed IDs are UUIDs)
  for (const { name, regex } of PII_PATTERNS) {
    if (name === "uuid_raw") continue; // UUIDs are common in valid payloads
    regex.lastIndex = 0;
    const match = regex.exec(jsonStr);
    if (match) {
      violations.push({
        pattern: name,
        sample: match[0].slice(0, 8) + "***",
      });
    }
  }

  // Check for large text blobs (> 500 chars in a single value) — likely document content
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
      violations.push({
        pattern: "large_text_blob",
        key: fullKey,
        sample: `[${v.length} chars]`,
      });
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

// ── Violation Logger ─────────────────────────────────────────────────
async function logViolation(
  supabaseAdmin: ReturnType<typeof createClient>,
  violation: {
    type: "DOMAIN_BLOCKED" | "PII_DETECTED" | "RATE_LIMITED" | "INVALID_REQUEST";
    caller: string;
    tenantHash: string;
    targetUrl: string;
    details: unknown;
  }
) {
  try {
    await supabaseAdmin.from("atenia_ai_observations").insert({
      kind: "EGRESS_VIOLATION",
      severity: violation.type === "PII_DETECTED" ? "critical" : "warning",
      title: `Egress ${violation.type}: ${violation.caller} → ${violation.targetUrl}`,
      payload: {
        ...violation,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[egress-proxy] Failed to log violation:", err);
  }
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
      return new Response(JSON.stringify({ status: "ok", service: "egress-proxy" }), {
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

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let payload: {
    target_url: string;
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
    target_url,
    method = "POST",
    headers: outboundHeaders = {},
    body: outboundBody,
    caller = "unknown",
    tenant_hash = "unknown",
  } = payload;

  if (!target_url) {
    return new Response(JSON.stringify({ error: "target_url is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Guard 1: Domain allowlist ──
  const domainCheck = isDomainAllowed(target_url);
  if (!domainCheck.allowed) {
    await logViolation(supabaseAdmin, {
      type: "DOMAIN_BLOCKED",
      caller,
      tenantHash: tenant_hash,
      targetUrl: target_url,
      details: { reason: "Domain not in allowlist" },
    });
    return new Response(
      JSON.stringify({ error: "EGRESS_BLOCKED", reason: "Domain not in allowlist" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Guard 2: Rate limiting ──
  if (!checkRateLimit(tenant_hash)) {
    await logViolation(supabaseAdmin, {
      type: "RATE_LIMITED",
      caller,
      tenantHash: tenant_hash,
      targetUrl: target_url,
      details: { limit: MAX_REQUESTS_PER_MINUTE },
    });
    return new Response(
      JSON.stringify({ error: "EGRESS_RATE_LIMITED", reason: "Too many requests" }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Guard 3: PII payload scan ──
  const piiViolations = scanPayloadForPii(outboundBody);
  if (piiViolations.length > 0) {
    await logViolation(supabaseAdmin, {
      type: "PII_DETECTED",
      caller,
      tenantHash: tenant_hash,
      targetUrl: target_url,
      details: { violations: piiViolations },
    });
    return new Response(
      JSON.stringify({
        error: "EGRESS_PII_BLOCKED",
        reason: "Payload contains sensitive data patterns",
        violation_count: piiViolations.length,
        // Only return pattern names, never samples
        patterns: piiViolations.map((v) => v.pattern),
      }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Guard 4: Scan outbound headers for leaked secrets ──
  const headerStr = JSON.stringify(outboundHeaders);
  const headerViolations = scanPayloadForPii({ _headers: headerStr });
  if (headerViolations.length > 0) {
    await logViolation(supabaseAdmin, {
      type: "PII_DETECTED",
      caller,
      tenantHash: tenant_hash,
      targetUrl: target_url,
      details: { violations: headerViolations, location: "headers" },
    });
    // Don't block header violations for auth tokens (expected), but log them
    // Only block if blocked keys are found
    const hasBlockedKeys = headerViolations.some((v) => v.pattern === "blocked_key");
    if (hasBlockedKeys) {
      return new Response(
        JSON.stringify({ error: "EGRESS_PII_BLOCKED", reason: "Headers contain blocked keys" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
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
      fetchOptions.body =
        typeof outboundBody === "string"
          ? outboundBody
          : JSON.stringify(outboundBody);
    }

    const response = await fetch(target_url, fetchOptions);
    const responseBody = await response.text();

    return new Response(
      JSON.stringify({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
        egress_metadata: {
          domain_category: domainCheck.category,
          caller,
          proxied_at: new Date().toISOString(),
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
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
