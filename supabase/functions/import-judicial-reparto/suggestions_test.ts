import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractRepartoSuggestions, hasPdfEnvelope, PDF_LIMIT } from "./suggestions.ts";

Deno.test("a receipt leaves the judicial radicado and assignment date unfilled", () => {
  const result = extractRepartoSuggestions("", [
    "Constancia de recepción de la demanda",
    "Número de solicitud: 2026-4492",
    "Fecha de recepción: 23/11/2026",
    "Referencia interna: 05001311000220260047100",
  ].join("\n"), "Constancia de recepción");
  assertEquals(result.fields.kind, { value: "RECEPCION", source: "OUTLOOK" });
  assertEquals(result.fields.external_reference?.value, "2026-4492");
  assertEquals(result.fields.receipt_on?.value, "2026-11-23");
  assertEquals(result.fields.radicado, undefined);
  assertEquals(result.fields.assigned_on, undefined);
});

Deno.test("extracts labelled numbers, parties and dates from a single line of PDF text", () => {
  const result = extractRepartoSuggestions(
    "ACTA INDIVIDUAL DE REPARTO Número de radicación: 05001-31-10-002-2026-00471-01 " +
      "Despacho asignado: Juzgado 2 de Familia Fecha de reparto: 2026-11-23 " +
      "Demandante: Persona A Demandado: Persona B",
    "Se adjunta el resultado del reparto.", "Reparto",
  );
  assertEquals(result.fields.radicado, { value: "05001311000220260047101", source: "PDF" });
  assertEquals(result.fields.authority_name?.value, "Juzgado 2 de Familia");
  assertEquals(result.fields.demandantes?.value, "Persona A");
  assertEquals(result.fields.demandados?.value, "Persona B");
  assertEquals(result.fields.assigned_on?.value, "2026-11-23");
  assertEquals(result.fields.receipt_on, undefined);
});

Deno.test("sets aside conflicting and malformed evidence, including distinct instances", () => {
  const result = extractRepartoSuggestions(
    "Radicado: 05001311000220260047101\nFecha de reparto: 30/02/2026",
    "Radicado: 05001311000220260047100\nFecha de correo: 23/11/2026", "Reparto",
  );
  assertEquals(result.conflicts, ["radicado"]);
  assertEquals(result.fields.radicado, undefined);
  assertEquals(result.fields.assigned_on, undefined);
  assertEquals(result.fields.receipt_on, undefined);
});

Deno.test("accepts PDF bytes only within size and structure limits", () => {
  const encode = (s: string) => new TextEncoder().encode(s);
  assertEquals(hasPdfEnvelope(encode("%PDF-1.4\n%%EOF\n")), true);
  assertEquals(hasPdfEnvelope(encode("<html>%%EOF")), false);
  assertEquals(hasPdfEnvelope(encode("%PDF-1.4\nbroken")), false);
  assertEquals(hasPdfEnvelope(new Uint8Array(PDF_LIMIT + 1)), false);
});
