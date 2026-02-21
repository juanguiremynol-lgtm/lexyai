/**
 * tutelasAdapter_test.ts — Unit tests for Tutelas adapter normalization.
 */
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeTutelasActuaciones,
  normalizeTutelasEstados,
  extractTutelasMetadata,
  extractTutelasParties,
  computeTutelasFingerprint,
  mapCorteStatus,
} from './tutelasAdapter.ts';

// ── Corte Status Mapping ──

Deno.test("mapCorteStatus: SELECCIONADA", () => {
  assertEquals(mapCorteStatus("Seleccionada para Revisión"), "SELECCIONADA");
});

Deno.test("mapCorteStatus: NO_SELECCIONADA", () => {
  assertEquals(mapCorteStatus("No Seleccionada"), "NO_SELECCIONADA");
});

Deno.test("mapCorteStatus: SENTENCIA_EMITIDA", () => {
  assertEquals(mapCorteStatus("Sentencia T-123/2025"), "SENTENCIA_EMITIDA");
});

Deno.test("mapCorteStatus: PENDIENTE (default)", () => {
  assertEquals(mapCorteStatus("En trámite"), "PENDIENTE");
  assertEquals(mapCorteStatus(""), "PENDIENTE");
});

// ── Actuaciones Normalization ──

Deno.test("normalizeTutelasActuaciones: normalizes raw actuaciones", () => {
  const proceso = {
    actuaciones: [
      { fecha_actuacion: "2025-01-15", actuacion: "Admite tutela", anotacion: "Se admite la acción de tutela" },
      { fecha: "2025-02-01", descripcion: "Fallo primera instancia", detalle: "Se concede la tutela" },
    ],
  };

  const result = normalizeTutelasActuaciones(proceso, { workItemId: 'wi-test' });
  assertEquals(result.length, 2);
  assertEquals(result[0].fecha_actuacion, "2025-01-15");
  assertEquals(result[0].actuacion, "Admite tutela");
  assertEquals(result[0].source_platform, "tutelas");
  assertExists(result[0].hash_fingerprint);
});

Deno.test("normalizeTutelasActuaciones: handles eventos array", () => {
  const proceso = {
    eventos: [
      { fecha: "2025-03-01", tipo: "Sentencia" },
    ],
  };
  const result = normalizeTutelasActuaciones(proceso);
  assertEquals(result.length, 1);
  assertEquals(result[0].actuacion, "Sentencia");
});

Deno.test("normalizeTutelasActuaciones: empty input", () => {
  assertEquals(normalizeTutelasActuaciones({}).length, 0);
  assertEquals(normalizeTutelasActuaciones({ actuaciones: [] }).length, 0);
});

// ── Estados Normalization ──

Deno.test("normalizeTutelasEstados: normalizes raw estados", () => {
  const proceso = {
    estados: [
      { fecha: "2025-01-20", tipo: "Estado Electrónico", descripcion: "Publicación del auto" },
    ],
  };
  const result = normalizeTutelasEstados(proceso);
  assertEquals(result.length, 1);
  assertEquals(result[0].tipo_publicacion, "Estado Electrónico");
  assertEquals(result[0].source_platform, "tutelas");
});

// ── Metadata Extraction ──

Deno.test("extractTutelasMetadata: extracts Corte metadata", () => {
  const proceso = {
    sala: "Sala Séptima de Revisión",
    magistrado_ponente: "Cristina Pardo",
    estado: "Seleccionada para Revisión",
    tutela_code: "T-1234567",
    sentencia: "T-123/2025",
    ciudad: "Bogotá",
  };
  const meta = extractTutelasMetadata(proceso);
  assertExists(meta);
  assertEquals(meta!.despacho, "Sala Séptima de Revisión");
  assertEquals(meta!.ponente, "Cristina Pardo");
  assertEquals(meta!.corte_status, "SELECCIONADA");
  assertEquals(meta!.tutela_code, "T-1234567");
  assertEquals(meta!.sentencia_ref, "T-123/2025");
  assertEquals(meta!.tipo_proceso, "TUTELA");
});

Deno.test("extractTutelasMetadata: null on empty input", () => {
  assertEquals(extractTutelasMetadata(null), null);
});

// ── Parties Extraction ──

Deno.test("extractTutelasParties: extracts accionante/accionado", () => {
  const proceso = { accionante: "Juan Pérez", accionado: "EPS Salud" };
  const parties = extractTutelasParties(proceso);
  assertExists(parties);
  assertEquals(parties!.demandante, "Juan Pérez");
  assertEquals(parties!.demandado, "EPS Salud");
});

Deno.test("extractTutelasParties: null when no parties", () => {
  assertEquals(extractTutelasParties({}), null);
});

// ── Fingerprinting ──

Deno.test("computeTutelasFingerprint: deterministic", () => {
  const fp1 = computeTutelasFingerprint("2025-01-15", "Auto", "Nota", "wi-1");
  const fp2 = computeTutelasFingerprint("2025-01-15", "Auto", "Nota", "wi-1");
  assertEquals(fp1, fp2);
});

Deno.test("computeTutelasFingerprint: different data produces different fingerprints", () => {
  const fp1 = computeTutelasFingerprint("2025-01-15", "Auto", "Nota A", "wi-1");
  const fp2 = computeTutelasFingerprint("2025-01-15", "Auto", "Nota B", "wi-1");
  assertEquals(fp1 !== fp2, true);
});

Deno.test("computeTutelasFingerprint: cross-provider scope", () => {
  const fp = computeTutelasFingerprint("2025-01-15", "Auto", "Nota", "wi-1", true);
  assertEquals(fp.startsWith("tut_x_"), true);
});
