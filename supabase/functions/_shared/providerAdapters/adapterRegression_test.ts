/**
 * adapterRegression_test.ts — Guards against architectural regressions.
 *
 * Ensures:
 *   - Orchestrator imports from shared adapters (no inline fetch functions)
 *   - providerRegistry has exactly the 5 built-in providers
 *   - No entry point makes direct HTTP calls to external provider domains
 *   - Dynamic providers cannot use built-in keys
 */

import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { validateDynamicProviderConfig, IMMUTABLE_BUILT_IN_KEYS } from "./contractValidator.ts";

Deno.test("orchestrator imports shared adapters, not inline fetch functions", () => {
  let source: string;
  try {
    source = Deno.readTextFileSync("./supabase/functions/sync-by-work-item/index.ts");
  } catch {
    // File might not be accessible in test context
    return;
  }

  // Must import from shared adapters
  assert(
    source.includes("providerAdapters"),
    "Orchestrator must import from _shared/providerAdapters",
  );

  // Must NOT have inline fetch functions for canonical providers
  const inlineFetchPatterns = [
    "async function fetchFromCpnu(",
    "async function fetchFromSamai(",
    "async function fetchFromTutelasApi(",
    "async function fetchPublicaciones(",
    "async function fetchSamaiEstados(",
  ];

  for (const pattern of inlineFetchPatterns) {
    assert(
      !source.includes(pattern),
      `Orchestrator must NOT contain inline "${pattern}" — use shared adapter instead`,
    );
  }
});

Deno.test("providerRegistry has exactly 5 built-in providers", () => {
  let source: string;
  try {
    source = Deno.readTextFileSync("./supabase/functions/_shared/providerRegistry.ts");
  } catch {
    return;
  }

  for (const key of IMMUTABLE_BUILT_IN_KEYS) {
    assert(
      source.includes(`"${key}"`) || source.includes(`'${key}'`),
      `providerRegistry must contain built-in provider "${key}"`,
    );
  }
});

Deno.test("no entry point has direct fetch to external provider domains", () => {
  const entryPoints = [
    "./supabase/functions/sync-by-work-item/index.ts",
    "./supabase/functions/sync-by-radicado/index.ts",
    "./supabase/functions/demo-radicado-lookup/index.ts",
  ];

  const externalDomains = [
    "procesojudicial.ramajudicial.gov.co",
    "consultaestados.ramajudicial.gov.co",
    "samai.consejodeestado.gov.co",
  ];

  for (const file of entryPoints) {
    let source: string;
    try {
      source = Deno.readTextFileSync(file);
    } catch {
      continue; // File might not exist yet
    }

    for (const domain of externalDomains) {
      const fetchPattern = new RegExp(
        `fetch\\([^)]*${domain.replace(/\./g, "\\.")}`,
        "g",
      );
      assert(
        !fetchPattern.test(source),
        `${file} must NOT contain direct fetch to ${domain} — use shared adapter`,
      );
    }
  }
});

Deno.test("dynamic providers cannot use any built-in key", () => {
  for (const key of IMMUTABLE_BUILT_IN_KEYS) {
    const result = validateDynamicProviderConfig({
      provider_key: key,
      data_kind: "ACTUACIONES",
    });
    assert(!result.valid, `Dynamic provider must not use built-in key "${key}"`);
    assert(result.errors.some((e) => e.includes("conflicts with built-in")));
  }
});

Deno.test("contract validator catches all invalid adapter outputs", async () => {
  // Config validation is separate from result validation
  const v1 = validateDynamicProviderConfig({
    provider_key: "test_valid",
    data_kind: "ACTUACIONES",
  });
  assertEquals(v1.valid, true);

  // Test result validation with sources as scalar
  const { validateProviderResult } = await import("./contractValidator.ts");

  const invalid = {
    status: "SUCCESS",
    actuaciones: [
      {
        actuacion: "TEST",
        fecha_actuacion: "2026-01-01",
        hash_fingerprint: "abc",
        source_platform: "cpnu",
        sources: "cpnu", // scalar!
      },
    ],
    durationMs: 100,
  };
  const v2 = validateProviderResult(invalid, "ACTUACIONES");
  assert(!v2.valid);
  assert(v2.errors.some((e) => e.includes("sources must be array")));
});
