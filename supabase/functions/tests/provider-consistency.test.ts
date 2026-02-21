/**
 * Provider Consistency Tests — Prevents future provider key drift.
 *
 * These tests validate the canonical provider registry that governs
 * all 5 external judicial data providers in ATENIA.
 */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CANONICAL_PROVIDERS,
  ALL_PROVIDER_KEYS,
  ACTUACIONES_PROVIDERS,
  ESTADOS_PROVIDERS,
  getProvidersForCategory,
  normalizeProviderKey,
  isValidProviderKey,
  normalizeSources,
} from "../_shared/providerRegistry.ts";

Deno.test("exactly 5 canonical providers exist", () => {
  assertEquals(ALL_PROVIDER_KEYS.length, 5);
  assert(ALL_PROVIDER_KEYS.includes("cpnu"));
  assert(ALL_PROVIDER_KEYS.includes("samai"));
  assert(ALL_PROVIDER_KEYS.includes("publicaciones"));
  assert(ALL_PROVIDER_KEYS.includes("samai_estados"));
  assert(ALL_PROVIDER_KEYS.includes("tutelas"));
});

Deno.test("every category has at least one actuaciones provider", () => {
  for (const category of ["CGP", "CPACA", "TUTELA", "LABORAL", "PENAL_906"]) {
    const { actuaciones } = getProvidersForCategory(category);
    assert(actuaciones.length > 0, `${category} must have at least one actuaciones provider`);
  }
});

Deno.test("every category has publicaciones as estados provider", () => {
  for (const category of ["CGP", "CPACA", "TUTELA", "LABORAL", "PENAL_906"]) {
    const { estados } = getProvidersForCategory(category);
    assert(estados.includes("publicaciones"), `${category} must include publicaciones`);
  }
});

Deno.test("CPACA includes samai_estados", () => {
  const { estados } = getProvidersForCategory("CPACA");
  assert(estados.includes("samai_estados"));
});

Deno.test("TUTELA fan-out includes cpnu, tutelas, and samai", () => {
  const { actuaciones } = getProvidersForCategory("TUTELA");
  assert(actuaciones.includes("cpnu"));
  assert(actuaciones.includes("tutelas"));
  assert(actuaciones.includes("samai"));
});

Deno.test("actuaciones providers target work_item_acts", () => {
  for (const key of ACTUACIONES_PROVIDERS) {
    assertEquals(CANONICAL_PROVIDERS[key].targetTable, "work_item_acts");
    assertEquals(CANONICAL_PROVIDERS[key].scope, "ACTUACIONES");
  }
});

Deno.test("estados providers target work_item_publicaciones", () => {
  for (const key of ESTADOS_PROVIDERS) {
    assertEquals(CANONICAL_PROVIDERS[key].targetTable, "work_item_publicaciones");
    assertEquals(CANONICAL_PROVIDERS[key].scope, "ESTADOS");
  }
});

Deno.test("normalizeProviderKey handles all known aliases", () => {
  // Canonical keys
  assertEquals(normalizeProviderKey("cpnu"), "cpnu");
  assertEquals(normalizeProviderKey("samai"), "samai");
  assertEquals(normalizeProviderKey("publicaciones"), "publicaciones");
  assertEquals(normalizeProviderKey("samai_estados"), "samai_estados");
  assertEquals(normalizeProviderKey("tutelas"), "tutelas");

  // Legacy aliases
  assertEquals(normalizeProviderKey("tutelas-api"), "tutelas");
  assertEquals(normalizeProviderKey("Rama Judicial"), "cpnu");
  assertEquals(normalizeProviderKey("RAMA_JUDICIAL"), "cpnu");
  assertEquals(normalizeProviderKey("publicaciones_v3"), "publicaciones");
  assertEquals(normalizeProviderKey("ext:SAMAI Estados API"), "samai_estados");

  // Rejected values
  assertEquals(normalizeProviderKey(null), null);
  assertEquals(normalizeProviderKey(undefined), null);
  assertEquals(normalizeProviderKey(""), null);
  assertEquals(normalizeProviderKey("none"), null);
  assertEquals(normalizeProviderKey("unknown"), null);
});

Deno.test("normalizeSources handles scalar, array, null", () => {
  assertEquals(normalizeSources(["cpnu", "samai"]), ["cpnu", "samai"]);
  assertEquals(normalizeSources("cpnu"), ["cpnu"]);
  assertEquals(normalizeSources(null), []);
  assertEquals(normalizeSources(undefined), []);
  assertEquals(normalizeSources([1, "cpnu", null, "samai"]), ["cpnu", "samai"]);
});

Deno.test("isValidProviderKey accepts only canonical keys", () => {
  assert(isValidProviderKey("cpnu"));
  assert(isValidProviderKey("tutelas"));
  assert(!isValidProviderKey("tutelas-api"));
  assert(!isValidProviderKey("Rama Judicial"));
  assert(!isValidProviderKey(""));
});

Deno.test("CGP routing matches canonical policy", () => {
  const r = getProvidersForCategory("CGP");
  assertEquals(r.actuaciones, ["cpnu"]);
  assertEquals(r.estados, ["publicaciones"]);
});

Deno.test("CPACA routing matches canonical policy", () => {
  const r = getProvidersForCategory("CPACA");
  assertEquals(r.actuaciones, ["samai"]);
  assertEquals(r.estados, ["publicaciones", "samai_estados"]);
});

Deno.test("LABORAL routing matches canonical policy", () => {
  const r = getProvidersForCategory("LABORAL");
  assertEquals(r.actuaciones, ["cpnu"]);
  assertEquals(r.estados, ["publicaciones"]);
});

Deno.test("PENAL_906 routing matches canonical policy", () => {
  const r = getProvidersForCategory("PENAL_906");
  assertEquals(r.actuaciones, ["cpnu"]);
  assertEquals(r.estados, ["publicaciones"]);
});

Deno.test("unknown category returns empty arrays", () => {
  const r = getProvidersForCategory("UNKNOWN");
  assertEquals(r.actuaciones, []);
  assertEquals(r.estados, []);
});
