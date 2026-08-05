/**
 * Iteration 15 — PENAL_906 as a first-class provider-monitored workflow.
 * Covers: canonical value normalization, provider chain, phase catalog and
 * penal email-evidence vocabulary.
 */
import { describe, it, expect } from "vitest";
import { getWorkflowPhases, mapStageToCanonicalPhase, inferPhaseFromText } from "@/lib/workflow-phases";
import { providerChainFor, isProviderMonitoredWorkflow } from "@/lib/monitoring-matrix";
import { normalizeWorkflowType, WORKFLOW_TYPES } from "@/lib/workflow-constants";

describe("PENAL_906 canonical value", () => {
  it("normalizes the defensive 'PENAL' alias onto PENAL_906", () => {
    expect(normalizeWorkflowType("PENAL")).toBe("PENAL_906");
    expect(normalizeWorkflowType("penal 906")).toBe("PENAL_906");
    expect(normalizeWorkflowType("PENAL_906")).toBe("PENAL_906");
    expect(normalizeWorkflowType("nonsense")).toBeNull();
  });

  it("renders as 'Penal (Ley 906)'", () => {
    expect(WORKFLOW_TYPES.PENAL_906.label).toBe("Penal (Ley 906)");
  });
});

describe("PENAL_906 monitoring", () => {
  it("is provider-monitored on the cpnu + publicaciones chain", () => {
    expect(providerChainFor("PENAL_906")).toEqual(["cpnu", "publicaciones"]);
    expect(isProviderMonitoredWorkflow("PENAL_906")).toBe(true);
    // alias must resolve to the same chain, never to an empty one
    expect(providerChainFor("PENAL")).toEqual(["cpnu", "publicaciones"]);
  });
});

describe("PENAL_906 phase catalog (Ley 906/2004)", () => {
  const keys = getWorkflowPhases("PENAL_906").map((p) => p.key);

  it("models the accusatory sequence with Preclusión as an outcome branch", () => {
    expect(keys).toEqual([
      "INDAGACION",
      "IMPUTACION",
      "MEDIDA_ASEGURAMIENTO",
      "ESCRITO_ACUSACION",
      "AUDIENCIA_ACUSACION",
      "PREPARATORIA",
      "JUICIO_ORAL",
      "SENTENCIA",
      "RECURSOS",
      "PRECLUSION",
      "ARCHIVO",
    ]);
    expect(getWorkflowPhases("PENAL_906").find((p) => p.key === "PRECLUSION")?.branch).toBe(true);
  });

  it.each([
    ["NOTICIA_CRIMINAL_INDAGACION", "INDAGACION"],
    ["IMPUTACION_INVESTIGACION", "IMPUTACION"],
    ["ACUSACION", "AUDIENCIA_ACUSACION"],
    ["PREPARATORIA", "PREPARATORIA"],
    ["JUICIO_ORAL", "JUICIO_ORAL"],
    ["SENTENCIA_TRAMITE", "SENTENCIA"],
    ["SEGUNDA_INSTANCIA", "RECURSOS"],
    ["PRECLUIDO_ARCHIVADO", "PRECLUSION"],
  ])("maps provider stage %s -> %s", (stage, phase) => {
    expect(mapStageToCanonicalPhase("PENAL_906", stage)).toBe(phase);
  });

  it("does not leak civil phases into penal matters", () => {
    // 'DEMANDA_RADICADA' has no penal meaning: unmappable, so the UI falls
    // back to inference from the latest actuación instead of inventing a phase.
    expect(mapStageToCanonicalPhase("PENAL_906", "DEMANDA_RADICADA")).toBeNull();
  });

  it("infers a phase from free actuación text when the stage is unmappable", () => {
    expect(inferPhaseFromText("PENAL_906", "Audiencia de formulación de acusación")).toBe("AUDIENCIA_ACUSACION");
    expect(inferPhaseFromText("PENAL_906", "Se impone medida de aseguramiento")).toBe("MEDIDA_ASEGURAMIENTO");
    expect(inferPhaseFromText("PENAL_906", "Solicitud de preclusión")).toBe("PRECLUSION");
    expect(inferPhaseFromText("PENAL_906", "audiencia concentrada")).toBe("JUICIO_ORAL");
  });
});

describe("penal email evidence vocabulary", () => {
  const sender = "juzgado01pmpalmira@cendoj.ramajudicial.gov.co";
  it.each([
    ["Audiencia de formulación de imputación", "IMPUTACION"],
    ["Se legaliza captura y se formula imputación", "IMPUTACION"],
    ["Imposición de medida de aseguramiento privativa de la libertad", "MEDIDA_ASEGURAMIENTO"],
    ["Traslado del escrito de acusación", "ESCRITO_ACUSACION"],
    ["Solicitud de preclusión de la investigación", "PRECLUSION"],
    ["Citación audiencia preparatoria", "CITACION_AUDIENCIA"],
    ["Citación a audiencia concentrada", "CITACION_AUDIENCIA"],
  ])("classifies %s as %s", async (subject, expected) => {
    const { classifyEvidenceSubtype } = await import(
      "../../supabase/functions/_shared/emailMatcher.ts"
    );
    expect(classifyEvidenceSubtype(subject, sender)).toBe(expected);
  });
});
