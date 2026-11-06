import { describe, expect, it } from "vitest";
import { autoHeaderDateCandidates, extractAutoHeaderDate } from "../../auto-header-date";

// Mirror of supabase/functions/_shared/autoHeaderDate_test.ts — same cases,
// synthetic text only.
describe("auto header date quality signal", () => {
  it("never treats an estado planilla as an auto header", () => {
    const texto = "RAMA JUDICIAL. Juzgado Municipal Civil. Estado No. 159 De Martes, 13 De Octubre De 2026. FIJACIÓN DE ESTADOS. Radicación Clase Demandante Fecha Auto.";
    expect(extractAutoHeaderDate(texto)).toBeNull();
    expect(extractAutoHeaderDate("JUZGADO 1. ESTADO N° 30. Bogotá, 12 de marzo de 2026. Radicación: 123.")).toBeNull();
    expect(extractAutoHeaderDate("JUZGADO 1. FIJACIÓN DE ESTADOS. Bogotá, 12 de marzo de 2026. Radicación: 123.")).toBeNull();
  });

  it("requires a place, not just a weekday, before the date", () => {
    expect(extractAutoHeaderDate("JUZGADO 1. Martes, 13 de octubre de 2026. Radicación: 123.")).toBeNull();
    expect(extractAutoHeaderDate("JUZGADO 1. Bogotá, 13 de octubre de 2026. Radicación: 123. Se notifica por estado 159."))
      .toBe("2026-10-13");
  });
  it("tribunal header + words with parenthesized digits and year words", () => {
    const texto =
      "JUZGADO 11 ADMINISTRATIVO DE BOGOTÁ. Bogotá, D.C., VEINTIDÓS (22) DE ABRIL DE DOS MIL VEINTISÉIS (2026). Radicación: 05001-23-45-678-2026-00123-00. Demandante: ...";
    expect(extractAutoHeaderDate(texto)).toBe("2026-04-22");
  });

  it("tribunal header + word day with numeric year without year words", () => {
    const texto =
      "TRIBUNAL ADMINISTRATIVO DE CUNDINAMARCA. Medellín, veintidós (22) de abril de 2026. Expediente: 2026-00123.";
    expect(extractAutoHeaderDate(texto)).toBe("2026-04-22");
  });

  it("tribunal header + numeric long format", () => {
    const texto = "SALA ÚNICA DE DECISIÓN. Bogotá, D.C., 22 de abril de 2026. Radicado: 123.";
    expect(extractAutoHeaderDate(texto)).toBe("2026-04-22");
  });

  it("despacho header + numeric short formats dd/mm/yyyy", () => {
    expect(extractAutoHeaderDate("DESPACHO DEL JUZGADO 5. Bogotá, 22/04/2026. Auto No. 45."))
      .toBe("2026-04-22");
    expect(extractAutoHeaderDate("DESPACHO DEL JUZGADO 5. Bogotá, 22-04-2026. Auto No. 45."))
      .toBe("2026-04-22");
  });

  it("same date repeated in two formats stays unambiguous", () => {
    const texto =
      "JUZGADO 11. Bogotá, veintidós (22) de abril de dos mil veintiséis (2026). En fecha 22/04/2026 se ordena. Radicación: 123.";
    expect(extractAutoHeaderDate(texto)).toBe("2026-04-22");
  });

  it("two distinct dates in the header segment are ambiguous → null", () => {
    const texto =
      "JUZGADO 11. Bogotá, 22 de abril de 2026. Se cita el auto del 10 de marzo de 2026. Radicación: 123.";
    expect(extractAutoHeaderDate(texto)).toBeNull();
    expect(autoHeaderDateCandidates(texto)).toEqual([]);
  });

  it("a lone citation in a paragraph without a recognizable header → null", () => {
    // No tribunal/despacho context at all.
    expect(extractAutoHeaderDate("El auto del 10 de marzo de 2026 ordenó remitir copias."))
      .toBeNull();
    // Context present but the date is a citation, not a dateline.
    expect(extractAutoHeaderDate("El juzgado citó el auto del 10 de marzo de 2026 para aclaración."))
      .toBeNull();
    // Hearing time citation is not a header dateline.
    expect(
      extractAutoHeaderDate(
        "JUZGADO 11. Se señala audiencia a las 9:00 a.m. del 10 de noviembre de 2026. Radicación: 123.",
      ),
    ).toBeNull();
  });

  it("a date after the first procedural identification field → null", () => {
    const texto = "JUZGADO 11. Radicación: 05001-123. Bogotá, 22 de abril de 2026.";
    expect(extractAutoHeaderDate(texto)).toBeNull();
  });

  it("no delimiting field inside the prefix → null even with context and dateline", () => {
    // Tribunal context, place+comma and a single valid date, but no procedural
    // identification field: the segment is not delimited, so the date could be
    // a body citation and must not qualify.
    const texto =
      "JUZGADO 11 ADMINISTRATIVO. Bogotá, D.C., 22 de abril de 2026. Se ordena remitir copias a las partes dentro del término de ley para su traslado.";
    expect(extractAutoHeaderDate(texto)).toBeNull();
    expect(autoHeaderDateCandidates(texto)).toEqual([]);
  });

  it("delimiting field only beyond the 600-char prefix → null", () => {
    const texto = `JUZGADO 11. Bogotá, 22 de abril de 2026. ${"x".repeat(700)} Radicación: 123.`;
    expect(extractAutoHeaderDate(texto)).toBeNull();
  });

  it("«proceso» delimits the header segment", () => {
    const texto =
      "JUZGADO 11. Bogotá, 22 de abril de 2026. Proceso: ejecutivo singular. Se cita el auto del 10 de marzo de 2026.";
    expect(extractAutoHeaderDate(texto)).toBe("2026-04-22");
  });

  it("dateline without tribunal/despacho context in the segment → null", () => {
    // The procedural field "AUTO No." ends the segment before "Magistrado", so
    // no recognizable header context remains.
    const texto =
      "BOGOTÁ, D.C., VEINTIDÓS (22) DE ABRIL DE DOS MIL VEINTISÉIS (2026). AUTO No. 123. Magistrado Ponente: ...";
    expect(extractAutoHeaderDate(texto)).toBeNull();
  });

  it("invalid calendar dates are rejected", () => {
    expect(extractAutoHeaderDate("JUZGADO 11. Bogotá, 31 de febrero de 2026.")).toBeNull();
    expect(
      extractAutoHeaderDate("JUZGADO 11. Bogotá, treinta (30) de febrero de dos mil veintiséis (2026)."),
    ).toBeNull();
    expect(extractAutoHeaderDate("JUZGADO 11. Bogotá, 45/13/2026.")).toBeNull();
  });

  it("a date cited only beyond the header prefix is not used", () => {
    const relleno = "x".repeat(700);
    const texto = `JUZGADO 11. Sin fecha en encabezado. ${relleno} Bogotá, 10 de marzo de 2026.`;
    expect(extractAutoHeaderDate(texto)).toBeNull();
  });

  it("year in words only, without digits, is not recognized", () => {
    expect(extractAutoHeaderDate("JUZGADO 11. Bogotá, veintidós de abril de dos mil veintiséis."))
      .toBeNull();
  });

  it("non-string and empty input", () => {
    expect(extractAutoHeaderDate(null)).toBeNull();
    expect(extractAutoHeaderDate(undefined)).toBeNull();
    expect(extractAutoHeaderDate(42)).toBeNull();
    expect(extractAutoHeaderDate("   ")).toBeNull();
  });

  it("implausible years are rejected", () => {
    expect(extractAutoHeaderDate("JUZGADO 11. Bogotá, 22 de abril de 1999.")).toBeNull();
    expect(extractAutoHeaderDate("JUZGADO 11. Bogotá, 22 de abril de 2999.")).toBeNull();
  });
});
