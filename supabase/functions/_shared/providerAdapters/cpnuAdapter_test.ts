/**
 * cpnuAdapter_test.ts — Tests for the shared CPNU adapter.
 *
 * Validates normalization logic, fingerprint generation, and party extraction
 * using fixture data. Does NOT make real HTTP calls.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  normalizeCpnuActuaciones,
  extractCpnuParties,
  computeCpnuFingerprint,
} from "./cpnuAdapter.ts";

// ═══════════════════════════════════════════
// Normalization Tests
// ═══════════════════════════════════════════

Deno.test("normalizeCpnuActuaciones: handles Cloud Run format", () => {
  const rawActs = [
    {
      idActuacion: 1001,
      fechaActuacion: "2025-06-01",
      actuacion: "AUTO ADMISORIO DE LA DEMANDA",
      anotacion: "Se admite demanda ejecutiva singular.",
      nombreDespacho: "Juzgado 002 Civil Municipal de Medellín",
      fechaInicial: "2025-06-01",
      fechaFinal: "2025-06-01",
      consActuacion: 3,
      conDocumentos: true,
      documentos: [
        { nombre: "Auto Admisorio", url: "https://example.com/auto.pdf" },
      ],
    },
    {
      fechaActuacion: "2025-05-20",
      actuacion: "RADICACIÓN DEMANDA",
      anotacion: "Se radica demanda ejecutiva.",
      consActuacion: 2,
    },
  ];

  const result = normalizeCpnuActuaciones(
    rawActs as any,
    "05001400300220250105400",
    "Juzgado 002 Civil Municipal de Medellín",
  );

  assertEquals(result.length, 2);

  // First actuacion
  assertEquals(result[0].fecha_actuacion, "2025-06-01");
  assertEquals(result[0].actuacion, "AUTO ADMISORIO DE LA DEMANDA");
  assertEquals(result[0].anotacion, "Se admite demanda ejecutiva singular.");
  assertEquals(result[0].source_platform, "cpnu");
  assertEquals(result[0].sources, ["cpnu"]);
  assertEquals(result[0].indice, "3");
  assertEquals(result[0].anexos_count, 1);
  assertExists(result[0].documentos);
  assertEquals(result[0].documentos!.length, 1);
  assertEquals(result[0].documentos![0].nombre, "Auto Admisorio");
  assertEquals(result[0].fecha_inicia_termino, "2025-06-01");
  assertEquals(result[0].fecha_finaliza_termino, "2025-06-01");
  assertExists(result[0].hash_fingerprint);

  // Second actuacion
  assertEquals(result[1].fecha_actuacion, "2025-05-20");
  assertEquals(result[1].indice, "2");
});

Deno.test("normalizeCpnuActuaciones: handles public API format (fechaActuacion ISO datetime)", () => {
  const rawActs = [
    {
      fechaActuacion: "2025-06-01T00:00:00",
      actuacion: "NOTIFICACIÓN PERSONAL",
      anotacion: "",
    },
  ];

  const result = normalizeCpnuActuaciones(rawActs as any, "05001400300220250105400", "");

  assertEquals(result[0].fecha_actuacion, "2025-06-01");
  assertEquals(result[0].actuacion, "NOTIFICACIÓN PERSONAL");
  assertEquals(result[0].anotacion, null); // empty string → null
});

Deno.test("normalizeCpnuActuaciones: handles adapter-cpnu ProcessEvent format", () => {
  const rawActs = [
    {
      event_date: "2025-06-01",
      title: "AUTO ADMISORIO",
      description: "Se admite la demanda",
      detail: "Detalle completo",
    },
  ];

  const result = normalizeCpnuActuaciones(rawActs as any, "05001400300220250105400", "");

  assertEquals(result[0].fecha_actuacion, "2025-06-01");
  // Falls through: actuacion uses act.actuacion || act.title || act.description
  assertEquals(result[0].actuacion, "AUTO ADMISORIO");
});

// ═══════════════════════════════════════════
// Fingerprint Tests
// ═══════════════════════════════════════════

Deno.test("computeCpnuFingerprint: deterministic", () => {
  const fp1 = computeCpnuFingerprint("05001400300220250105400", "2025-06-01", "AUTO", "Juzgado 1");
  const fp2 = computeCpnuFingerprint("05001400300220250105400", "2025-06-01", "AUTO", "Juzgado 1");
  assertEquals(fp1, fp2);
});

Deno.test("computeCpnuFingerprint: different inputs produce different fingerprints", () => {
  const fp1 = computeCpnuFingerprint("05001400300220250105400", "2025-06-01", "AUTO", "Juzgado 1");
  const fp2 = computeCpnuFingerprint("05001400300220250105400", "2025-06-02", "AUTO", "Juzgado 1");
  if (fp1 === fp2) throw new Error("Expected different fingerprints");
});

Deno.test("computeCpnuFingerprint: cross-provider mode uses ACT prefix", () => {
  const fpDefault = computeCpnuFingerprint("05001400300220250105400", "2025-06-01", "AUTO", "Juzgado 1");
  const fpCross = computeCpnuFingerprint("05001400300220250105400", "2025-06-01", "AUTO", "Juzgado 1", undefined, true);
  // Different because prefix is 'cpnu' vs 'ACT'
  if (fpDefault === fpCross) throw new Error("Expected different fingerprints for cross-provider mode");
});

// ═══════════════════════════════════════════
// Party Extraction Tests
// ═══════════════════════════════════════════

Deno.test("extractCpnuParties: from structured sujetos array", () => {
  const sujetos = [
    { tipoSujeto: "DEMANDANTE", nombreRazonSocial: "JUAN PÉREZ" },
    { tipoSujeto: "DEMANDADO", nombreRazonSocial: "EMPRESA S.A." },
    { tipoSujeto: "TERCERO", nombreRazonSocial: "OTRO" },
  ];

  const result = extractCpnuParties(sujetos as any);

  assertEquals(result.demandante, "JUAN PÉREZ");
  assertEquals(result.demandado, "EMPRESA S.A.");
  assertEquals(result.sujetos_procesales?.length, 3);
});

Deno.test("extractCpnuParties: handles accionante/accionado (tutela roles)", () => {
  const sujetos = [
    { tipo: "Accionante", nombre: "TUTELANTE" },
    { tipo: "Accionado", nombre: "ENTIDAD" },
  ];

  const result = extractCpnuParties(sujetos as any);

  assertEquals(result.demandante, "TUTELANTE");
  assertEquals(result.demandado, "ENTIDAD");
});

Deno.test("extractCpnuParties: multiple demandantes joined with pipe", () => {
  const sujetos = [
    { tipoSujeto: "DEMANDANTE", nombreRazonSocial: "PERSONA 1" },
    { tipoSujeto: "DEMANDANTE", nombreRazonSocial: "PERSONA 2" },
  ];

  const result = extractCpnuParties(sujetos as any);

  assertEquals(result.demandante, "PERSONA 1 | PERSONA 2");
});

Deno.test("extractCpnuParties: empty sujetos returns nulls", () => {
  const result = extractCpnuParties([]);

  assertEquals(result.demandante, null);
  assertEquals(result.demandado, null);
});

Deno.test("extractCpnuParties: fallback to sujetosResumen string", () => {
  const result = extractCpnuParties([], "DEMANDANTE: JUAN | DEMANDADO: EMPRESA");

  // parseCpnuSujetos should handle this format
  assertExists(result);
});
