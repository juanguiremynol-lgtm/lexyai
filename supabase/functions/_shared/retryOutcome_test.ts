import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { breakerDeferral, retryOutcome } from "./retryOutcome.ts";

Deno.test("a denied shared permit is deferred; real upstream errors consume a retry", () => {
  const payload = { samai_estados_summary: { error: "PROVIDER_BREAKER_OPEN:2999-01-01T00:00:00Z" } };
  assertEquals(breakerDeferral(payload), { code: "PROVIDER_BREAKER_OPEN", delaySeconds: 1800 });
  assertEquals(breakerDeferral({ samai_estados_summary: { error: "HTTP 502" } }), null);
  assertEquals(retryOutcome(200, { ok: false, result_code: "PENDING_UPSTREAM" }).outcome, "RETRY");
  assertEquals(breakerDeferral({ samai_estados_summary: { error: "PROVIDER_BREAKER_UNAVAILABLE" } }), { code: "PROVIDER_BREAKER_UNAVAILABLE", delaySeconds: 130 });
});

Deno.test("source disabled after the queue check is excluded without a provider retry", () => {
  assertEquals(retryOutcome(200, { ok: false, status: "SKIPPED", result_code: "ROUTING_SKIP_SOURCE_DISABLED" }),
    { outcome: "INELIGIBLE", code: "SOURCE_NOT_ENABLED" });
  assertEquals(retryOutcome(503, { ok: false, status: "SKIPPED", result_code: "ROUTING_SKIP_SOURCE_DISABLED" }).outcome,
    "RETRY");
});
