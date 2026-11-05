/**
 * autoHeaderDate_test.ts — synthetic-only contract tests for the auto header
 * date quality signal. No real case text is used.
 */
import { assertEquals } from "jsr:@std/assert";
import { autoHeaderDateCandidates, extractAutoHeaderDate } from "./autoHeaderDate.ts";

Deno.test("tribunal header + words with parenthesized digits and year words", () => {
  const texto =
    "JUZGADO 11 ADMINISTRATIVO DE BOGOTÁ. Bogotá, D.C., VEINTIDÓS (22) DE ABRIL DE DOS MIL VEINTISÉIS (2026). Radicación: 05001-23-45-678-2026-00123-00. Demandante: ...";
  assertEquals(extractAutoHeaderDate(texto), "2026-04-22");
});

Deno.test("tribunal header + word day with numeric year without year words", () => {
  const texto =
    "TRIBUNAL ADMINISTRATIVO DE CUNDINAMARCA. Medellín, veintidós (22) de abril de 2026. Expediente: 2026-00123.";
  assertEquals(extractAutoHeaderDate(texto), "2026-04-22");
});

Deno.test("tribunal header + numeric long format", () => {
  const texto = "SALA ÚNICA DE DECISIÓN. Bogotá, D.C., 22 de abril de 2026. Radicado: 123.";
  assertEquals(extractAutoHeaderDate(texto), "2026-04-22");
});

Deno.test("despacho header + numeric short formats dd/mm/yyyy", () => {
  assertEquals(
    extractAutoHeaderDate("DESPACHO DEL JUZGADO 5. Bogotá, 22/04/2026. Auto No. 45."),
    "2026-04-22",
  );
  assertEquals(
    extractAutoHeaderDate("DESPACHO DEL JUZGADO 5. Bogotá, 22-04-2026. Auto No. 45."),
    "2026-04-22",
  );
});

Deno.test("same date repeated in two formats stays unambiguous", () => {
  const texto =
    "JUZGADO 11. Bogotá, veintidós (22) de abril de dos mil veintiséis (2026). En fecha 22/04/2026 se ordena. Radicación: 123.";
  assertEquals(extractAutoHeaderDate(texto), "2026-04-22");
});

Deno.test("two distinct dates in the header segment are ambiguous → null", () => {
  const texto =
    "JUZGADO 11. Bogotá, 22 de abril de 2026. Se cita el auto del 10 de marzo de 2026. Radicación: 123.";
  assertEquals(extractAutoHeaderDate(texto), null);
  assertEquals(autoHeaderDateCandidates(texto), []);
});

Deno.test("a lone citation in a paragraph without a recognizable header → null", () => {
  // No tribunal/despacho context at all.
  assertEquals(
    extractAutoHeaderDate("El auto del 10 de marzo de 2026 ordenó remitir copias."),
    null,
  );
  // Context present but the date is a citation, not a dateline.
  assertEquals(
    extractAutoHeaderDate("El juzgado citó el auto del 10 de marzo de 2026 para aclaración."),
    null,
  );
  // Hearing time citation is not a header dateline.
  assertEquals(
    extractAutoHeaderDate(
      "JUZGADO 11. Se señala audiencia a las 9:00 a.m. del 10 de noviembre de 2026. Radicación: 123.",
    ),
    null,
  );
});

Deno.test("a date after the first procedural identification field → null", () => {
  const texto = "JUZGADO 11. Radicación: 05001-123. Bogotá, 22 de abril de 2026.";
  assertEquals(extractAutoHeaderDate(texto), null);
});

Deno.test("dateline without tribunal/despacho context in the segment → null", () => {
  // The procedural field "AUTO No." ends the segment before "Magistrado", so
  // no recognizable header context remains.
  const texto =
    "BOGOTÁ, D.C., VEINTIDÓS (22) DE ABRIL DE DOS MIL VEINTISÉIS (2026). AUTO No. 123. Magistrado Ponente: ...";
  assertEquals(extractAutoHeaderDate(texto), null);
});

Deno.test("invalid calendar dates are rejected", () => {
  assertEquals(extractAutoHeaderDate("JUZGADO 11. Bogotá, 31 de febrero de 2026."), null);
  assertEquals(
    extractAutoHeaderDate("JUZGADO 11. Bogotá, treinta (30) de febrero de dos mil veintiséis (2026)."),
    null,
  );
  assertEquals(extractAutoHeaderDate("JUZGADO 11. Bogotá, 45/13/2026."), null);
});

Deno.test("a date cited only beyond the header prefix is not used", () => {
  const relleno = "x".repeat(700);
  const texto = `JUZGADO 11. Sin fecha en encabezado. ${relleno} Bogotá, 10 de marzo de 2026.`;
  assertEquals(extractAutoHeaderDate(texto), null);
});

Deno.test("year in words only, without digits, is not recognized", () => {
  assertEquals(
    extractAutoHeaderDate("JUZGADO 11. Bogotá, veintidós de abril de dos mil veintiséis."),
    null,
  );
});

Deno.test("non-string and empty input", () => {
  assertEquals(extractAutoHeaderDate(null), null);
  assertEquals(extractAutoHeaderDate(undefined), null);
  assertEquals(extractAutoHeaderDate(42), null);
  assertEquals(extractAutoHeaderDate("   "), null);
});

Deno.test("implausible years are rejected", () => {
  assertEquals(extractAutoHeaderDate("JUZGADO 11. Bogotá, 22 de abril de 1999."), null);
  assertEquals(extractAutoHeaderDate("JUZGADO 11. Bogotá, 22 de abril de 2999."), null);
});
