import { describe, expect, it } from "vitest";
import { autoHeaderDateCandidates, extractAutoHeaderDate } from "../../auto-header-date";

// Mirror of supabase/functions/_shared/autoHeaderDate_test.ts — same cases,
// synthetic text only.
describe("auto header date quality signal", () => {
  it("words with parenthesized digits and year words", () => {
    const texto =
      "BOGOTÁ, D.C., VEINTIDÓS (22) DE ABRIL DE DOS MIL VEINTISÉIS (2026). AUTO No. 123. Magistrado Ponente: ...";
    expect(extractAutoHeaderDate(texto)).toBe("2026-04-22");
  });

  it("word day with numeric year without year words", () => {
    expect(extractAutoHeaderDate("Medellín, veintidós (22) de abril de 2026. Se resuelve.")).toBe("2026-04-22");
  });

  it("numeric long format", () => {
    expect(extractAutoHeaderDate("Medellín, 22 de abril de 2026. AUTO")).toBe("2026-04-22");
    expect(extractAutoHeaderDate("a las 9:00 a.m. del 10 de noviembre de 2026")).toBe("2026-11-10");
  });

  it("numeric short formats dd/mm/yyyy", () => {
    expect(extractAutoHeaderDate("Fijado: 22/04/2026 en el despacho.")).toBe("2026-04-22");
    expect(extractAutoHeaderDate("Fijado: 22-04-2026 en el despacho.")).toBe("2026-04-22");
  });

  it("same date repeated in two formats stays unambiguous", () => {
    const texto = "Bogotá, veintidós (22) de abril de dos mil veintiséis (2026). En fecha 22/04/2026 se ordena.";
    expect(extractAutoHeaderDate(texto)).toBe("2026-04-22");
  });

  it("two distinct dates in the header are ambiguous → null", () => {
    const texto =
      "Bogotá, veintidós (22) de abril de dos mil veintiséis (2026). Contra el auto del 10 de marzo de 2026 se procede.";
    expect(extractAutoHeaderDate(texto)).toBeNull();
    expect(autoHeaderDateCandidates(texto).sort()).toEqual(["2026-03-10", "2026-04-22"]);
  });

  it("invalid calendar dates are rejected", () => {
    expect(extractAutoHeaderDate("Bogotá, 31 de febrero de 2026.")).toBeNull();
    expect(extractAutoHeaderDate("Bogotá, treinta (30) de febrero de dos mil veintiséis (2026).")).toBeNull();
    expect(extractAutoHeaderDate("Fijado: 45/13/2026.")).toBeNull();
  });

  it("a date cited only beyond the header prefix is not used", () => {
    const relleno = "x".repeat(700);
    const texto = `Bogotá, sin fecha en encabezado. ${relleno} auto del 10 de marzo de 2026 citado.`;
    expect(extractAutoHeaderDate(texto)).toBeNull();
  });

  it("year in words only, without digits, is not recognized", () => {
    expect(extractAutoHeaderDate("Bogotá, veintidós de abril de dos mil veintiséis.")).toBeNull();
  });

  it("non-string and empty input", () => {
    expect(extractAutoHeaderDate(null)).toBeNull();
    expect(extractAutoHeaderDate(undefined)).toBeNull();
    expect(extractAutoHeaderDate(42)).toBeNull();
    expect(extractAutoHeaderDate("   ")).toBeNull();
  });

  it("implausible years are rejected", () => {
    expect(extractAutoHeaderDate("Bogotá, 22 de abril de 1999.")).toBeNull();
    expect(extractAutoHeaderDate("Bogotá, 22 de abril de 2999.")).toBeNull();
  });
});
