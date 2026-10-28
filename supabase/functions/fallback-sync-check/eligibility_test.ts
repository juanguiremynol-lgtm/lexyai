import { fallbackEligibility } from "./eligibility.ts";
function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const item = { id: "case-a", radicado: "05001333301020240013900", workflow_type: "CPACA" };

Deno.test("an active enrollment is required and disabled alternatives block generic dispatch", () => {
  assertEquals(fallbackEligibility(item, []), { eligible: false, reason: "NO_ACTS_ENROLLMENT" });
  assertEquals(fallbackEligibility(item, [
    { work_item_id: "case-a", provider_key: "samai", enabled: true },
    { work_item_id: "case-a", provider_key: "cpnu", enabled: false },
  ]), { eligible: false, reason: "DISABLED_SOURCE_REQUIRES_BOUNDARY_GUARD" });
});

Deno.test("different items' enrollment and a malformed radicado do not authorize work", () => {
  assertEquals(fallbackEligibility(item, [{ work_item_id: "case-b", provider_key: "samai", enabled: true }]),
    { eligible: false, reason: "NO_ACTS_ENROLLMENT" });
  assertEquals(fallbackEligibility({ ...item, radicado: "123" }, []),
    { eligible: false, reason: "INSUFFICIENT_RADICADO" });
});

Deno.test("the preferred enrolled provider is selected without treating stage as eligibility", () => {
  assertEquals(fallbackEligibility(item, [
    { work_item_id: "case-a", provider_key: "cpnu", enabled: true },
    { work_item_id: "case-a", provider_key: "samai", enabled: true },
  ]), { eligible: true, provider: "samai" });
});
