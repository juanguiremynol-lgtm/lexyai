/**
 * providerCoverageMatrix_test.ts — Tests for the provider coverage matrix.
 *
 * Covers:
 *   1. CPACA: SAMAI→ACTUACIONES, SAMAI_ESTADOS→ESTADOS
 *   2. CGP: CPNU→ACTUACIONES, Publicaciones→ESTADOS
 *   3. Compatibility gating: incompatible providers are rejected
 *   4. Debug override bypasses compatibility
 *   5. routeScopeToDataKinds mapping
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  getProviderCoverage,
  isProviderCompatible,
  routeScopeToDataKinds,
} from "../_shared/providerCoverageMatrix.ts";

// ── 1. CPACA coverage ──

Deno.test("CPACA ACTUACIONES: primary is SAMAI", () => {
  const result = getProviderCoverage("CPACA", "ACTUACIONES");
  assertEquals(result.compatible, true);
  assertEquals(result.providers.length, 1);
  assertEquals(result.providers[0].key, "samai");
  assertEquals(result.providers[0].role, "PRIMARY");
  assertEquals(result.providers[0].type, "BUILTIN");
});

Deno.test("CPACA ESTADOS: primary is SAMAI_ESTADOS (external)", () => {
  const result = getProviderCoverage("CPACA", "ESTADOS");
  assertEquals(result.compatible, true);
  assertEquals(result.providers.length, 1);
  assertEquals(result.providers[0].key, "SAMAI_ESTADOS");
  assertEquals(result.providers[0].role, "PRIMARY");
  assertEquals(result.providers[0].type, "EXTERNAL");
});

// ── 2. CGP coverage ──

Deno.test("CGP ACTUACIONES: primary is CPNU", () => {
  const result = getProviderCoverage("CGP", "ACTUACIONES");
  assertEquals(result.compatible, true);
  assertEquals(result.providers[0].key, "cpnu");
  assertEquals(result.providers[0].role, "PRIMARY");
});

Deno.test("CGP ESTADOS: primary is publicaciones", () => {
  const result = getProviderCoverage("CGP", "ESTADOS");
  assertEquals(result.compatible, true);
  assertEquals(result.providers[0].key, "publicaciones");
});

// ── 3. TUTELA coverage ──

Deno.test("TUTELA ACTUACIONES: CPNU primary, SAMAI + tutelas-api fallback", () => {
  const result = getProviderCoverage("TUTELA", "ACTUACIONES");
  assertEquals(result.compatible, true);
  assertEquals(result.providers.length, 3);
  assertEquals(result.providers[0].role, "PRIMARY");
  assertEquals(result.providers[1].role, "FALLBACK");
  assertEquals(result.providers[2].role, "FALLBACK");
});

Deno.test("TUTELA ESTADOS: no providers", () => {
  const result = getProviderCoverage("TUTELA", "ESTADOS");
  assertEquals(result.compatible, false);
});

// ── 4. Compatibility gating ──

Deno.test("SAMAI_ESTADOS is compatible with CPACA/ESTADOS", () => {
  const result = isProviderCompatible("SAMAI_ESTADOS", "CPACA", "ESTADOS");
  assertEquals(result.compatible, true);
});

Deno.test("SAMAI_ESTADOS is NOT compatible with CPACA/ACTUACIONES", () => {
  const result = isProviderCompatible("SAMAI_ESTADOS", "CPACA", "ACTUACIONES");
  assertEquals(result.compatible, false);
});

Deno.test("CPNU is compatible with CGP/ACTUACIONES", () => {
  const result = isProviderCompatible("cpnu", "CGP", "ACTUACIONES");
  assertEquals(result.compatible, true);
});

Deno.test("SAMAI is NOT compatible with CGP/ACTUACIONES", () => {
  const result = isProviderCompatible("samai", "CGP", "ACTUACIONES");
  assertEquals(result.compatible, false);
});

Deno.test("SAMAI_ESTADOS is NOT compatible with CGP/ESTADOS", () => {
  const result = isProviderCompatible("SAMAI_ESTADOS", "CGP", "ESTADOS");
  assertEquals(result.compatible, false);
});

// ── 5. Debug override ──

Deno.test("Debug override bypasses compatibility", () => {
  const result = isProviderCompatible("SAMAI_ESTADOS", "CGP", "ACTUACIONES", true);
  assertEquals(result.compatible, true);
  assertEquals(result.reason, "DEBUG_OVERRIDE: compatibility check bypassed");
});

// ── 6. Unknown workflow ──

Deno.test("Unknown workflow returns incompatible", () => {
  const result = getProviderCoverage("UNKNOWN_WF", "ACTUACIONES");
  assertEquals(result.compatible, false);
});

// ── 7. routeScopeToDataKinds ──

Deno.test("ACTS scope maps to ACTUACIONES", () => {
  assertEquals(routeScopeToDataKinds("ACTS"), ["ACTUACIONES"]);
});

Deno.test("PUBS scope maps to ESTADOS", () => {
  assertEquals(routeScopeToDataKinds("PUBS"), ["ESTADOS"]);
});

Deno.test("BOTH scope maps to both data kinds", () => {
  assertEquals(routeScopeToDataKinds("BOTH"), ["ACTUACIONES", "ESTADOS"]);
});

// ── 8. Connector key normalization (dashes, underscores, case) ──

Deno.test("samai-estados (dashes) matches SAMAI_ESTADOS compatibility", () => {
  const result = isProviderCompatible("samai-estados", "CPACA", "ESTADOS");
  assertEquals(result.compatible, true);
});

Deno.test("SAMAI_ESTADOS (uppercase underscores) matches compatibility", () => {
  const result = isProviderCompatible("SAMAI_ESTADOS", "CPACA", "ESTADOS");
  assertEquals(result.compatible, true);
});

// ── 9. Dual-chain acceptance criteria ──

Deno.test("CGP ACTS chain: CPNU is primary, no SAMAI_ESTADOS", () => {
  const actsResult = getProviderCoverage("CGP", "ACTUACIONES");
  assertEquals(actsResult.compatible, true);
  assertEquals(actsResult.providers[0].key, "cpnu");
  assertEquals(actsResult.providers[0].role, "PRIMARY");
  // SAMAI_ESTADOS must NOT appear in CGP ACTUACIONES
  const hasSamaiEstados = actsResult.providers.some(p => p.key === "SAMAI_ESTADOS");
  assertEquals(hasSamaiEstados, false);
});

Deno.test("CGP PUBS chain: Publicaciones is primary", () => {
  const pubsResult = getProviderCoverage("CGP", "ESTADOS");
  assertEquals(pubsResult.compatible, true);
  assertEquals(pubsResult.providers[0].key, "publicaciones");
  assertEquals(pubsResult.providers[0].role, "PRIMARY");
});

Deno.test("CPACA ACTS chain: SAMAI is primary, no Publicaciones", () => {
  const actsResult = getProviderCoverage("CPACA", "ACTUACIONES");
  assertEquals(actsResult.compatible, true);
  assertEquals(actsResult.providers[0].key, "samai");
  const hasPubs = actsResult.providers.some(p => p.key === "publicaciones");
  assertEquals(hasPubs, false);
});

Deno.test("CPACA PUBS chain: SAMAI_ESTADOS is primary, no CPNU", () => {
  const pubsResult = getProviderCoverage("CPACA", "ESTADOS");
  assertEquals(pubsResult.compatible, true);
  assertEquals(pubsResult.providers[0].key, "SAMAI_ESTADOS");
  const hasCpnu = pubsResult.providers.some(p => p.key === "cpnu");
  assertEquals(hasCpnu, false);
});

Deno.test("BOTH-scope routes: routeScopeToDataKinds returns both data kinds", () => {
  const kinds = routeScopeToDataKinds("BOTH");
  assertEquals(kinds.length, 2);
  assertEquals(kinds.includes("ACTUACIONES"), true);
  assertEquals(kinds.includes("ESTADOS"), true);
});

Deno.test("ACTS-scope never maps to ESTADOS", () => {
  const kinds = routeScopeToDataKinds("ACTS");
  assertEquals(kinds.length, 1);
  assertEquals(kinds[0], "ACTUACIONES");
  assertEquals(kinds.includes("ESTADOS"), false);
});

Deno.test("PUBS-scope never maps to ACTUACIONES", () => {
  const kinds = routeScopeToDataKinds("PUBS");
  assertEquals(kinds.length, 1);
  assertEquals(kinds[0], "ESTADOS");
  assertEquals(kinds.includes("ACTUACIONES"), false);
});

// ── 10. Cross-contamination prevention ──

Deno.test("publicaciones provider is NOT compatible with CPACA/ESTADOS", () => {
  const result = isProviderCompatible("publicaciones", "CPACA", "ESTADOS");
  assertEquals(result.compatible, false);
});

Deno.test("publicaciones provider IS compatible with CGP/ESTADOS", () => {
  const result = isProviderCompatible("publicaciones", "CGP", "ESTADOS");
  assertEquals(result.compatible, true);
});

Deno.test("PENAL_906 ACTUACIONES: CPNU primary, SAMAI fallback", () => {
  const result = getProviderCoverage("PENAL_906", "ACTUACIONES");
  assertEquals(result.compatible, true);
  assertEquals(result.providers[0].key, "cpnu");
  assertEquals(result.providers[0].role, "PRIMARY");
  assertEquals(result.providers[1].key, "samai");
  assertEquals(result.providers[1].role, "FALLBACK");
});

Deno.test("LABORAL mirrors CGP: CPNU for ACTS, publicaciones for ESTADOS", () => {
  const acts = getProviderCoverage("LABORAL", "ACTUACIONES");
  assertEquals(acts.providers[0].key, "cpnu");
  const pubs = getProviderCoverage("LABORAL", "ESTADOS");
  assertEquals(pubs.providers[0].key, "publicaciones");
});
