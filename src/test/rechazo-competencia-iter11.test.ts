import { describe, it, expect } from "vitest";
import { classifyEvidenceSubtype } from "../../supabase/functions/_shared/emailMatcher.ts";

const JUD = "ccto18bt@cendoj.ramajudicial.gov.co";

describe("iteración 11 — rechazo por competencia no es inadmisión", () => {
  it.each([
    ["Se remite demanda rechazada por competencia 202501878"],
    ["RV: REMISIÓN TUTELA RECHAZADA POR COMPETENCIA RADICADO 2026-00164"],
    ["Conflicto negativo de competencia — expediente 2026-00082"],
    ["Remisión por competencia de la demanda"],
  ])("clasifica %s como RECHAZO_COMPETENCIA", (subject) => {
    expect(classifyEvidenceSubtype(subject, JUD)).toBe("RECHAZO_COMPETENCIA");
  });

  it("mantiene la inadmisión genuina", () => {
    expect(classifyEvidenceSubtype("AUTO INADMITE DEMANDA 0500140030282026", JUD)).toBe("INADMISION");
    expect(classifyEvidenceSubtype("Se concede término para subsanar la demanda", JUD)).toBe("INADMISION");
    expect(classifyEvidenceSubtype("Inadmite demanda so pena de rechazo", JUD)).toBe("INADMISION");
  });

  it("un 'rechaza' suelto sin vocabulario de subsanación no abre término", () => {
    expect(classifyEvidenceSubtype("Auto que rechaza la solicitud de pruebas", JUD)).not.toBe("INADMISION");
  });
});
