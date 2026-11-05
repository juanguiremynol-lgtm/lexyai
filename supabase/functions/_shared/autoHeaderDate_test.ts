/**
 * autoHeaderDate_test.ts — synthetic-only contract tests for the auto header
 * date quality signal. No real case text is used.
 */
import { assertEquals } from "jsr:@std/assert";
import { autoHeaderDateCandidates, extractAutoHeaderDate } from "./autoHeaderDate.ts";

Deno.test("words with parenthesized digits and year words", () => {
  const texto =
    "BOGOTÁ, D.C., VEINTIDÓS (22) DE ABRIL DE DOS MIL VEINTISÉIS (2026). AUTO No. 123. Magistrado Ponente: ...";
  assertEquals(extractAutoHeaderDate(texto), "2026-04-22");
});

Deno.test("word day with numeric year without year words", () => {
  assertEquals(extractAutoHeaderDate("Medellín, veintidós (22) de abril de 2026. Se resuelve."), "2026-04-22");
});

Deno.test("numeric long format", () => {
  assertEquals(extractAutoHeaderDate("Medellín, 22 de abril de 2026. AUTO"), "2026-04-22");
  assertEquals(extractAutoHeaderDate("a las 9:00 a.m. del 10 de noviembre de 2026"), "2026-11-10");
});

Deno.test("numeric short formats dd/mm/yyyy", () => {
  assertEquals(extractAutoHeaderDate("Fijado: 22/04/2026 en el despacho."), "2026-04-22");
  assertEquals(extractAutoHeaderDate("Fijado: 22-04-2026 en el despacho."), "2026-04-22");
});

Deno.test("same date repeated in two formats stays unambiguous", () => {
  const texto = "Bogotá, veintidós (22) de abril de dos mil veintiséis (2026). En fecha 22/04/2026 se ordena.";
  assertEquals(extractAutoHeaderDate(texto), "2026-04-22");
});

Deno.test("two distinct dates in the header are ambiguous → null", () => {
  const texto =
    "Bogotá, veintidós (22) de abril de dos mil veintiséis (2026). Contra el auto del 10 de marzo de 2026 se procede.";
  assertEquals(extractAutoHeaderDate(texto), null);
  const c = autoHeaderDateCandidates(texto);
  assertEquals(c.sort(), ["2026-03-10", "2026-04-22"]);
});

Deno.test("invalid calendar dates are rejected", () => {
  assertEquals(extractAutoHeaderDate("Bogotá, 31 de febrero de 2026."), null);
  assertEquals(extractAutoHeaderDate("Bogotá, treinta (30) de febrero de dos mil veintiséis (2026)."), null);
  assertEquals(extractAutoHeaderDate("Fijado: 45/13/2026."), null);
});

Deno.test("a date cited only beyond the header prefix is not used", () => {
  const relleno = "x".repeat(700);
  const texto = `Bogotá, sin fecha en encabezado. ${relleno} auto del 10 de marzo de 2026 citado.`;
  assertEquals(extractAutoHeaderDate(texto), null);
});

Deno.test("year in words only, without digits, is not recognized", () => {
  assertEquals(extractAutoHeaderDate("Bogotá, veintidós de abril de dos mil veintiséis."), null);
});

Deno.test("non-string and empty input", () => {
  assertEquals(extractAutoHeaderDate(null), null);
  assertEquals(extractAutoHeaderDate(undefined), null);
  assertEquals(extractAutoHeaderDate(42), null);
  assertEquals(extractAutoHeaderDate("   "), null);
});

Deno.test("implausible years are rejected", () => {
  assertEquals(extractAutoHeaderDate("Bogotá, 22 de abril de 1999."), null);
  assertEquals(extractAutoHeaderDate("Bogotá, 22 de abril de 2999."), null);
});
