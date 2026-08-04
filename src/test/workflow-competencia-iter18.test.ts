/**
 * Iteration 18 — court competence is not subject matter.
 */
import { describe, it, expect } from "vitest";
import { resolveCompetencia, resolveWorkflowType } from "@/lib/despacho-competencia";
import { deriveFromRadicado } from "@/lib/radicado-derivation";
import { providerChainFor, isProviderMonitoredWorkflow } from "@/lib/monitoring-matrix";

// Mixed-competence small-claims court (corp 41, esp 89)
const MIXTO_41_89 = "05001418900420250011300";
// Promiscuo municipal (corp 40, esp 89)
const MIXTO_40_89 = "05376408900120250004500";
// Pure civil circuit (esp 03)
const PURO_CIVIL = "05001310300520250011300";
// Pure labour (esp 05)
const PURO_LABORAL = "05001310500320250022200";

describe("resolveCompetencia", () => {
  it("marks specialty 89 courts as MIXTA", () => {
    expect(resolveCompetencia(MIXTO_41_89).competencia).toBe("MIXTA");
    expect(resolveCompetencia(MIXTO_40_89).competencia).toBe("MIXTA");
  });

  it("marks pure specialties as PURA with a single subject", () => {
    const civil = resolveCompetencia(PURO_CIVIL);
    expect(civil.competencia).toBe("PURA");
    expect(civil.subjects).toEqual(["CGP"]);
    const laboral = resolveCompetencia(PURO_LABORAL);
    expect(laboral.competencia).toBe("PURA");
    expect(laboral.subjects).toEqual(["LABORAL"]);
  });

  it("returns DESCONOCIDA for unknown specialties and invalid radicados", () => {
    expect(resolveCompetencia("05001417700420250011300").competencia).toBe("DESCONOCIDA");
    expect(resolveCompetencia("nope").competencia).toBe("DESCONOCIDA");
    expect(resolveCompetencia(null).competencia).toBe("DESCONOCIDA");
  });
});

describe("deriveFromRadicado", () => {
  it("never infers a workflow from a mixed-competence court", () => {
    const d = deriveFromRadicado(MIXTO_41_89);
    expect(d?.workflow).toBeNull();
    expect(d?.isMixed).toBe(true);
  });

  it("infers only for pure competence", () => {
    expect(deriveFromRadicado(PURO_CIVIL)?.workflow).toBe("CGP");
    expect(deriveFromRadicado(PURO_LABORAL)?.workflow).toBe("LABORAL");
  });
});

describe("resolveWorkflowType source hierarchy", () => {
  it("MANUAL beats everything, including practice areas", () => {
    const r = resolveWorkflowType({
      radicado: PURO_CIVIL,
      claseProceso: "ORDINARIO LABORAL",
      manualWorkflow: "CPACA",
      practiceAreas: ["CGP"],
    });
    expect(r.workflow).toBe("CPACA");
    expect(r.source).toBe("MANUAL");
  });

  it("PROVIDER_CLASS resolves a mixed court", () => {
    const r = resolveWorkflowType({ radicado: MIXTO_41_89, claseProceso: "EJECUTIVO SINGULAR" });
    expect(r.workflow).toBe("CGP");
    expect(r.source).toBe("PROVIDER_CLASS");
  });

  it("mixed court with no clase_proceso lands as INDETERMINADO", () => {
    const r = resolveWorkflowType({ radicado: MIXTO_40_89 });
    expect(r.workflow).toBe("INDETERMINADO");
    expect(r.competencia).toBe("MIXTA");
  });

  it("unknown specialty lands as INDETERMINADO", () => {
    const r = resolveWorkflowType({ radicado: "05001417700420250011300" });
    expect(r.workflow).toBe("INDETERMINADO");
  });

  it("vocabulary never auto-applies, only suggests", () => {
    const r = resolveWorkflowType({ radicado: MIXTO_41_89, vocabularySuggestion: "LABORAL" });
    expect(r.workflow).toBe("INDETERMINADO");
    expect(r.suggestion?.workflow).toBe("LABORAL");
    expect(r.suggestion?.source).toBe("INFERRED_VOCABULARY");
  });

  it("an area outside the tenant practice areas is downgraded to a suggestion", () => {
    const r = resolveWorkflowType({
      radicado: MIXTO_41_89,
      claseProceso: "ORDINARIO LABORAL",
      practiceAreas: ["CGP", "CPACA"],
    });
    expect(r.workflow).toBe("INDETERMINADO");
    expect(r.suggestion?.workflow).toBe("LABORAL");
  });
});

describe("monitoring stays on for INDETERMINADO", () => {
  it("fans out to every provider", () => {
    expect(isProviderMonitoredWorkflow("INDETERMINADO")).toBe(true);
    expect(providerChainFor("INDETERMINADO")).toEqual([
      "cpnu",
      "publicaciones",
      "samai",
      "samai_estados",
    ]);
  });
});
