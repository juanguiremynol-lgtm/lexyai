import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isExclusiveSamaiPublication, retryItemDisposition, retryItemEligible, samaiEnrollmentDecision } from './retryEligibility.ts';

Deno.test('pause and deletion are ineligible; a later active snapshot is eligible again', () => {
  const active = { lifecycle_state: 'ACTIVE', deleted_at: null, monitoring_enabled: true };
  assertEquals(retryItemEligible(active), true);
  assertEquals(retryItemEligible({ ...active, monitoring_enabled: false }), false);
  assertEquals(retryItemEligible({ ...active, deleted_at: '2026-10-28T00:00:00Z' }), false);
  assertEquals(retryItemEligible({ ...active, lifecycle_state: 'PAUSED' }), false);
  assertEquals(retryItemEligible(active), true);
  assertEquals(retryItemDisposition({ ...active, monitoring_enabled: false }), 'PAUSED');
  assertEquals(retryItemDisposition({ ...active, deleted_at: '2026-10-28T00:00:00Z' }), 'DELETED');
  assertEquals(retryItemDisposition(null), 'MISSING');
  assertEquals(retryItemDisposition(active), 'ACTIVE');
});

Deno.test('SAMAI publication enrolment must be explicit and the lookup must succeed', () => {
  assertEquals(samaiEnrollmentDecision(null, { enabled: true }), 'ENABLED');
  assertEquals(samaiEnrollmentDecision(null, { enabled: false }), 'DISABLED');
  assertEquals(samaiEnrollmentDecision(null, null), 'DISABLED');
  assertEquals(samaiEnrollmentDecision(new Error('offline'), null), 'UNAVAILABLE');
});

Deno.test('CPACA publication retries use SAMAI; tutela and acts are not suppressed by its breaker', () => {
  assertEquals(isExclusiveSamaiPublication('PUB_RETRY', 'CPACA'), true);
  assertEquals(isExclusiveSamaiPublication('PUB_RETRY', 'TUTELA'), false);
  assertEquals(isExclusiveSamaiPublication('ACT_SCRAPE_RETRY', 'CPACA'), false);
});
