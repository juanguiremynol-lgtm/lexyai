/**
 * Regression tests for alert type constants alignment.
 * Ensures the canonical constants match what DB triggers produce.
 */
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  JUDICIAL_ALERT_TYPES,
  ALERT_TYPE_ACTUACION_NUEVA,
  ALERT_TYPE_ESTADO_NUEVO,
  isActuacionType,
  isEstadoType,
  isKnownJudicialType,
  validateAlertPayload,
} from "./alertTypeConstants.ts";

// ── 1. Canonical values match DB trigger strings exactly ──
Deno.test("ACTUACION_NUEVA matches DB trigger string", () => {
  assertEquals(ALERT_TYPE_ACTUACION_NUEVA, "ACTUACION_NUEVA");
});

Deno.test("ESTADO_NUEVO matches DB trigger string", () => {
  assertEquals(ALERT_TYPE_ESTADO_NUEVO, "ESTADO_NUEVO");
});

// ── 2. Old/wrong names are NOT in the constants (regression for the original bug) ──
Deno.test("ACTUACION_NEW (old wrong name) is not a known type", () => {
  assertEquals(isKnownJudicialType("ACTUACION_NEW"), false);
});

Deno.test("PUBLICACION_NEW (old wrong name) is not a known type", () => {
  assertEquals(isKnownJudicialType("PUBLICACION_NEW"), false);
});

Deno.test("PUBLICACION_NUEVA (old wrong prefix) is not a known type", () => {
  assertEquals(isKnownJudicialType("PUBLICACION_NUEVA"), false);
});

// ── 3. Prefix grouping works correctly ──
Deno.test("isActuacionType groups correctly", () => {
  assertEquals(isActuacionType("ACTUACION_NUEVA"), true);
  assertEquals(isActuacionType("ACTUACION_MODIFIED"), true);
  assertEquals(isActuacionType("ESTADO_NUEVO"), false);
  assertEquals(isActuacionType("PUBLICACION_NEW"), false);
  assertEquals(isActuacionType(null), false);
});

Deno.test("isEstadoType groups correctly (not PUBLICACION)", () => {
  assertEquals(isEstadoType("ESTADO_NUEVO"), true);
  assertEquals(isEstadoType("ESTADO_MODIFIED"), true);
  assertEquals(isEstadoType("PUBLICACION_NEW"), false);
  assertEquals(isEstadoType("ACTUACION_NUEVA"), false);
});

// ── 4. All 4 canonical types are present ──
Deno.test("Exactly 4 judicial alert types defined", () => {
  assertEquals(JUDICIAL_ALERT_TYPES.length, 4);
});

// ── 5. Payload validation catches missing fields ──
Deno.test("Payload validation warns on null payload", () => {
  const { warnings } = validateAlertPayload("ACTUACION_NUEVA", null);
  assertNotEquals(warnings.length, 0);
});

Deno.test("Payload validation warns on missing act_id for actuacion", () => {
  const { warnings } = validateAlertPayload("ACTUACION_NUEVA", { description: "test", source: "CPNU" });
  const hasActIdWarning = warnings.some(w => w.includes("act_id"));
  assertEquals(hasActIdWarning, true);
});

Deno.test("Payload validation passes with complete actuacion payload", () => {
  const { warnings } = validateAlertPayload("ACTUACION_NUEVA", {
    description: "test", source: "CPNU", act_id: "abc", act_date: "2024-01-01",
    annotation: "nota", despacho: "Juzgado 1",
  });
  assertEquals(warnings.length, 0);
});
