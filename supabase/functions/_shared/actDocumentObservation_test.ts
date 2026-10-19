import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { documentObservationAt, mergeAnexosObservation, mergeDocumentObservation } from "./actDocumentObservation.ts";

const date = "2026-10-19T20:00:00Z";

Deno.test("legacy attempt counters and malformed logs do not become dated observations", () => {
  for (const value of [null, 0, 3, "3", {}, { observado_en: date }]) {
    assertEquals(documentObservationAt({ intentos: value, descarga_intentos: value }), null);
    assertEquals(documentObservationAt({ intentos: value, pdf_verificacion: { verificado_en: date } }), Date.parse(date));
  }
  assertEquals(documentObservationAt({ intentos: [{ observado_en: date }] }), Date.parse(date));
  assertEquals(documentObservationAt({ descarga_intentos: [{ observado_en: date }] }), Date.parse(date));
});

Deno.test("a provider observation with a numeric attempt count preserves its date and history", () => {
  const old = { intentos: 2, observado_en: "2026-10-18T20:00:00Z", estado: "pendiente" };
  const incoming = { intentos: 3, observado_en: date, estado: "sin_inventario" };
  const merged = mergeAnexosObservation({ indice: 121017601, anexos_observacion: old }, incoming);
  assertEquals(merged.indice, 121017601);
  assertEquals(merged.anexos_observacion, incoming);
  assertEquals(merged.anexos_observacion_historial, [old]);
});

Deno.test("malformed attempt history cannot displace a verified copy or prevent cache repair", () => {
  const url = "https://storage.googleapis.com/andromeda-cpnu-documentos-2026/test.pdf";
  const previous = { descarga_estado: "descargado_y_leido", pdf_verificacion: { verificado_en: "2026-10-18T20:00:00Z" }, gcs_url: url };
  const incoming = { descarga_observado_en: date, descarga_intentos: 2, descarga_estado: "no_verificada" };
  const kept = mergeDocumentObservation(previous, incoming, { ...previous, ...incoming });
  assertEquals(kept.gcs_url, url);
  assertEquals(kept.descarga_estado, "descargado_y_leido");
  const invalidated = { ...incoming, recuperacion_cache: { cacheIssue: "stored_object_missing", cachedObjectUrl: url } };
  const repaired = mergeDocumentObservation(previous, invalidated, { ...previous, ...invalidated });
  assertEquals(repaired.gcs_url, null);
  assertEquals(repaired.disponible, false);
  assertEquals(repaired.descarga_estado, "no_verificada");
});
