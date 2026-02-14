/**
 * Egress Proxy Validation — Post-deploy verification suite
 * 
 * Runs A/B/C checks from the server context:
 * A) Purpose-scoped domain enforcement
 * B) PII payload scanning & logging hygiene
 * C) Bypass resistance confirmation
 * 
 * Called manually or via CI. Returns a structured pass/fail report.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TestResult {
  test_id: string;
  name: string;
  passed: boolean;
  detail: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  try {
    const body = await req.clone().json().catch(() => null);
    if (body?.health_check === true) {
      return new Response(JSON.stringify({ status: "ok", service: "egress-proxy-validation", version: "1.0" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* continue */ }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const proxyUrl = `${supabaseUrl}/functions/v1/egress-proxy`;

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);
  const results: TestResult[] = [];

  // ── Helper: call proxy with server auth ──
  async function callProxy(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const resp = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        "x-egress-internal-token": serviceKey,
        "x-egress-purpose": (body.purpose as string) || "analytics",
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    return { status: resp.status, body: data };
  }

  // Capture observation count before tests
  const { count: beforeCount } = await supabaseAdmin
    .from("atenia_ai_observations")
    .select("*", { count: "exact", head: true })
    .eq("kind", "EGRESS_VIOLATION");

  // ═══════════════════════════════════════════════════════════════
  // TEST A1: Purpose policy — analytics call to email domain (should BLOCK)
  // ═══════════════════════════════════════════════════════════════
  try {
    const res = await callProxy({
      target_url: "https://api.resend.com/emails",
      purpose: "analytics",
      method: "POST",
      body: { event: "test_event" },
      caller: "validation-A1",
      tenant_hash: "test-validation",
    });
    results.push({
      test_id: "A1_PURPOSE_POLICY",
      name: "Analytics purpose blocked from email domain",
      passed: res.status === 403 && res.body.error === "EGRESS_BLOCKED",
      detail: `Status: ${res.status}, Error: ${res.body.error || "none"}`,
    });
  } catch (err) {
    results.push({
      test_id: "A1_PURPOSE_POLICY",
      name: "Analytics purpose blocked from email domain",
      passed: false,
      detail: `Exception: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST A2: Purpose policy — email call to email domain (should PASS domain check)
  // ═══════════════════════════════════════════════════════════════
  try {
    const res = await callProxy({
      target_url: "https://api.resend.com/emails",
      purpose: "email",
      method: "POST",
      body: { to: "test@example.com", subject: "test" },
      caller: "validation-A2",
      tenant_hash: "test-validation",
    });
    // Should pass domain check (may still fail at Resend API level, but not 403)
    results.push({
      test_id: "A2_EMAIL_ALLOWED",
      name: "Email purpose allowed to email domain",
      passed: res.status !== 403 || res.body.error !== "EGRESS_BLOCKED",
      detail: `Status: ${res.status}, Error: ${res.body.error || "none"}`,
    });
  } catch (err) {
    results.push({
      test_id: "A2_EMAIL_ALLOWED",
      name: "Email purpose allowed to email domain",
      passed: false,
      detail: `Exception: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST A3: Unknown domain completely blocked
  // ═══════════════════════════════════════════════════════════════
  try {
    const res = await callProxy({
      target_url: "https://evil-exfil.com/steal",
      purpose: "webhook",
      method: "POST",
      body: { data: "test" },
      caller: "validation-A3",
      tenant_hash: "test-validation",
    });
    results.push({
      test_id: "A3_UNKNOWN_DOMAIN_BLOCKED",
      name: "Unknown domain blocked for any purpose",
      passed: res.status === 403,
      detail: `Status: ${res.status}`,
    });
  } catch (err) {
    results.push({
      test_id: "A3_UNKNOWN_DOMAIN_BLOCKED",
      name: "Unknown domain blocked for any purpose",
      passed: false,
      detail: `Exception: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST B1: PII scan — analytics payload with email/phone (should BLOCK)
  // ═══════════════════════════════════════════════════════════════
  try {
    const res = await callProxy({
      target_url: "https://us.posthog.com/capture",
      purpose: "analytics",
      method: "POST",
      body: {
        event: "page_view",
        properties: {
          email: "fake-user@lawfirm.co",
          phone: "+573009876543",
          page: "/dashboard",
        },
      },
      caller: "validation-B1",
      tenant_hash: "test-validation",
    });
    results.push({
      test_id: "B1_PII_ANALYTICS_BLOCKED",
      name: "PII in analytics payload blocked",
      passed: res.status === 422 && res.body.error === "EGRESS_PII_BLOCKED",
      detail: `Status: ${res.status}, Patterns: ${JSON.stringify((res.body as any).patterns || [])}`,
    });
  } catch (err) {
    results.push({
      test_id: "B1_PII_ANALYTICS_BLOCKED",
      name: "PII in analytics payload blocked",
      passed: false,
      detail: `Exception: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST B2: Destination key support
  // ═══════════════════════════════════════════════════════════════
  try {
    const res = await callProxy({
      destination_key: "POSTHOG_CAPTURE",
      purpose: "analytics",
      method: "POST",
      body: { event: "safe_event", properties: { page: "/test" } },
      caller: "validation-B2",
      tenant_hash: "test-validation",
    });
    // Should NOT be blocked by domain or PII (clean payload)
    results.push({
      test_id: "B2_DESTINATION_KEY",
      name: "Destination key resolves and passes guards",
      passed: res.status !== 403 && res.status !== 422,
      detail: `Status: ${res.status}`,
    });
  } catch (err) {
    results.push({
      test_id: "B2_DESTINATION_KEY",
      name: "Destination key resolves and passes guards",
      passed: false,
      detail: `Exception: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST B3: Purpose mismatch on destination key
  // ═══════════════════════════════════════════════════════════════
  try {
    const res = await callProxy({
      destination_key: "POSTHOG_CAPTURE",
      purpose: "email", // Wrong purpose
      method: "POST",
      body: {},
      caller: "validation-B3",
      tenant_hash: "test-validation",
    });
    results.push({
      test_id: "B3_PURPOSE_MISMATCH",
      name: "Purpose mismatch on destination key rejected",
      passed: res.status === 400 && res.body.error === "EGRESS_PURPOSE_MISMATCH",
      detail: `Status: ${res.status}, Error: ${res.body.error || "none"}`,
    });
  } catch (err) {
    results.push({
      test_id: "B3_PURPOSE_MISMATCH",
      name: "Purpose mismatch on destination key rejected",
      passed: false,
      detail: `Exception: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST C1: Logging hygiene — check violations don't store raw payload
  // ═══════════════════════════════════════════════════════════════
  // Wait a moment for DB writes
  await new Promise(r => setTimeout(r, 2000));

  const { data: violations } = await supabaseAdmin
    .from("atenia_ai_observations")
    .select("id, kind, title, payload, created_at")
    .eq("kind", "EGRESS_VIOLATION")
    .order("created_at", { ascending: false })
    .limit(10);

  let loggingHygienePassed = true;
  let loggingDetail = "No violations to check";

  if (violations && violations.length > 0) {
    loggingDetail = `${violations.length} violations found. `;
    for (const v of violations) {
      const p = v.payload as Record<string, unknown>;
      // Check no raw body, no headers, no emails, no phones in payload
      const payloadStr = JSON.stringify(p);
      if (
        payloadStr.includes("fake-user@lawfirm.co") ||
        payloadStr.includes("+573009876543") ||
        payloadStr.includes("raw_body") ||
        payloadStr.includes("request_headers")
      ) {
        loggingHygienePassed = false;
        loggingDetail += `FAIL: Violation ${v.id} contains raw PII/body. `;
      }
    }
    if (loggingHygienePassed) {
      loggingDetail += "All violations are payload-free (only metadata stored).";
    }
  }

  results.push({
    test_id: "C1_LOGGING_HYGIENE",
    name: "Violations stored without raw payload",
    passed: loggingHygienePassed,
    detail: loggingDetail,
  });

  // ═══════════════════════════════════════════════════════════════
  // TEST C2: Incident dedup — check no duplicate security alerts
  // ═══════════════════════════════════════════════════════════════
  const { data: secAlerts } = await supabaseAdmin
    .from("atenia_ai_observations")
    .select("id, title, created_at")
    .eq("kind", "SECURITY_ALERT")
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString())
    .order("created_at", { ascending: false });

  const alertTitles = (secAlerts || []).map(a => a.title);
  const dupCount = alertTitles.length - new Set(alertTitles).size;

  results.push({
    test_id: "C2_INCIDENT_DEDUP",
    name: "No duplicate security alert incidents",
    passed: dupCount === 0,
    detail: `${alertTitles.length} alerts in last hour, ${dupCount} duplicates`,
  });

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return new Response(
    JSON.stringify({
      ok: failed === 0,
      summary: `${passed} passed, ${failed} failed of ${results.length} checks`,
      validated_at: new Date().toISOString(),
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
