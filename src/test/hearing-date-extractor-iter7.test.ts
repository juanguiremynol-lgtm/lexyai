/**
 * Iteration 7 — provider hearing-date extractor gate.
 */
import { describe, it, expect } from "vitest";
import {
  extractProviderHearing,
} from "../../supabase/functions/_shared/hearingDateExtractor";

const TODAY = "2026-01-15";

describe("extractProviderHearing", () => {
  it("parses the CPACA acceptance case (SAMAI estado)", () => {
    const r = extractProviderHearing(
      "CMT-EV-INICIAL PARA EL 24 DE AGOSTO DE 2026 A LAS 8:30 AM",
      null,
      TODAY,
    );
    expect(r?.hearing_date).toBe("2026-08-24");
    expect(r?.hora).toBe("08:30");
    expect(r?.fuente_texto.length).toBeLessThanOrEqual(160);
  });

  it("parses accented lowercase text with p.m.", () => {
    const r = extractProviderHearing(
      "Auto fija fecha audiencia",
      "Se señala audiencia de pruebas para el día 3 de septiembre de 2026 a las 2:30 p.m.",
      TODAY,
    );
    expect(r?.hearing_date).toBe("2026-09-03");
    expect(r?.hora).toBe("14:30");
  });

  it("defaults the year forward when omitted", () => {
    const r = extractProviderHearing(
      "AUDIENCIA INICIAL",
      "AUDIENCIA INICIAL SE CELEBRARA EL DIA 10 DE MARZO",
      TODAY,
    );
    expect(r?.hearing_date).toBe("2026-03-10");
    expect(r?.hora).toBeNull();
  });

  it("rolls to next year when the bare date already passed", () => {
    const r = extractProviderHearing("AUDIENCIA", "AUDIENCIA EL 5 DE ENERO", TODAY);
    expect(r?.hearing_date).toBe("2027-01-05");
  });

  it("accepts DD/MM/YYYY only within audiencia context", () => {
    expect(
      extractProviderHearing("DILIGENCIA DE REMATE", "Fecha 20/07/2026 10:00 AM", TODAY)?.hearing_date,
    ).toBe("2026-07-20");
    expect(extractProviderHearing("AUTO ADMISORIO", "Radicado del 20/07/2026", TODAY)).toBeNull();
  });

  it("never extracts past dates", () => {
    expect(
      extractProviderHearing("AUDIENCIA PRUEBAS PARA EL 08 DE JULIO DE 2020 A LAS 09:00 A.M", null, TODAY),
    ).toBeNull();
  });

  it("requires the hearing gate", () => {
    expect(extractProviderHearing("AUTO ADMITE DEMANDA PARA EL 24 DE AGOSTO DE 2026", null, TODAY)).toBeNull();
  });
});
