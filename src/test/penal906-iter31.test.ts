/**
 * Iteration 31 — PENAL_906 as a first-class workflow.
 *
 * Covers: canonical Ley 906 phase catalogue with preclusión/archivo as
 * outcome branches, the penal deadline engine (computes nothing until a rule
 * is ratified), the penal classification vocabulary, and the penal CUI.
 */
import { describe, expect, it } from "vitest";
import {
  PENAL_906_BOARD_PHASES,
  PENAL_906_PHASES,
  canonicalPhaseKey,
  getNextPhase,
  getPhaseByKey,
  isValidTransition,
  classifyActuacion,
} from "@/lib/penal906";
import { getWorkflowPhases, mapStageToCanonicalPhase, inferPhaseFromText } from "@/lib/workflow-phases";
import { PENAL_906_STAGES, getStagesForWorkflow, WORKFLOW_TYPES } from "@/lib/workflow-constants";
import { computePenalTerms, penalTermsPendingRatification, type PenalAnchor } from "@/lib/penal906/penal906-terms";
import type { PenalDeadlineRule } from "@/hooks/use-penal-deadline-rules";
import { validateCgpRadicado, normalizeRadicado, formatRadicadoWithLabels } from "@/lib/radicado-utils";
import { classifyEvidenceSubtype } from "../../supabase/functions/_shared/emailMatcher";

const PENAL_CUI = "08001600125720253122600";

function draftRule(over: Partial<PenalDeadlineRule> = {}): PenalDeadlineRule {
  return {
    id: "r1",
    organization_id: null,
    workflow_type: "PENAL_906",
    deadline_type: "PENAL_APELACION_SENTENCIA",
    label: "Apelación contra sentencia",
    citation: "Ley 906/2004, art. 179",
    anchor_type: "ANCHOR_AUDIENCIA",
    anchor_event: "SENTENCIA",
    days_amount: 5,
    day_type: "BUSINESS",
    description: null,
    requires_manual_review: true,
    status: "DRAFT",
    ratified_at: null,
    ratified_by: null,
    ...over,
  };
}

describe("B4/B5 — Ley 906 phase catalogue", () => {
  it("labels the workflow 'Penal (Ley 906)'", () => {
    expect(WORKFLOW_TYPES.PENAL_906.label).toBe("Penal (Ley 906)");
  });

  it("exposes the canonical stage vocabulary through getStagesForWorkflow", () => {
    const stages = getStagesForWorkflow("PENAL_906");
    expect(Object.keys(stages)).toEqual(Object.keys(PENAL_906_STAGES));
  });

  it("renders the canonical linear order on the board", () => {
    const linear = PENAL_906_BOARD_PHASES.filter(
      (p) => !p.isBranch && p.canonicalKey && p.displayOrder <= 9,
    ).map((p) => p.canonicalKey);
    expect(linear).toEqual([
      "INDAGACION",
      "IMPUTACION",
      "MEDIDA_ASEGURAMIENTO",
      "ESCRITO_ACUSACION",
      "AUDIENCIA_ACUSACION",
      "PREPARATORIA",
      "JUICIO_ORAL",
      "SENTENCIA",
      "RECURSOS",
    ]);
  });

  it("models preclusión and archivo as branches, not anomalies", () => {
    const phases = getWorkflowPhases("PENAL_906");
    expect(phases.find((p) => p.key === "PRECLUSION")?.branch).toBe(true);
    expect(phases.find((p) => p.key === "ARCHIVO")?.branch).toBe(true);
    expect(getPhaseByKey("PRECLUSION_TRAMITE")?.isBranch).toBe(true);
    expect(getPhaseByKey("ARCHIVO")?.isBranch).toBe(true);
  });

  it("keeps numeric ids stable while ordering by displayOrder", () => {
    expect(getPhaseByKey("MEDIDA_ASEGURAMIENTO")?.id).toBe(14);
    expect(getPhaseByKey("ESCRITO_ACUSACION")?.id).toBe(15);
    expect(canonicalPhaseKey(15)).toBe("ESCRITO_ACUSACION");
    // Forward progression is judged on statutory order, not on numeric id.
    expect(isValidTransition(2, 14)).toBe(true); // imputación → medida
    expect(isValidTransition(4, 15)).toBe(false); // aud. acusación → escrito (retroceso)
    expect(getNextPhase(2)).toBe(14);
  });

  it("maps provider stage vocabulary onto the catalogue", () => {
    expect(mapStageToCanonicalPhase("PENAL_906", "ARCHIVO_DEFINITIVO")).toBe("ARCHIVO");
    expect(inferPhaseFromText("PENAL_906", "Se decreta la cesación de procedimiento")).toBe("ARCHIVO");
  });

  it("classifies penal actuación text into the new phases", () => {
    expect(classifyActuacion("Traslado del escrito de acusación").phase_inferred).toBe(15);
    expect(classifyActuacion("Imposición de medida de aseguramiento").phase_inferred).toBe(14);
    expect(classifyActuacion("Archivo definitivo de las diligencias").phase_inferred).toBe(16);
  });
});

describe("B6 — penal deadline engine: DRAFT computes nothing", () => {
  const anchor: PenalAnchor = {
    type: "ANCHOR_AUDIENCIA",
    event: "SENTENCIA",
    date: "2026-08-14",
  };

  it("computes nothing while the rule is a draft", () => {
    const rules = [draftRule()];
    expect(penalTermsPendingRatification(rules)).toBe(true);
    expect(computePenalTerms(rules, [anchor])).toEqual([]);
  });

  it("computes only after ratification, anchored on the hearing date", () => {
    const rules = [draftRule({ status: "RATIFIED", ratified_at: "2026-08-01T00:00:00Z" })];
    expect(penalTermsPendingRatification(rules)).toBe(false);
    const [term] = computePenalTerms(rules, [anchor]);
    expect(term.deadlineType).toBe("PENAL_APELACION_SENTENCIA");
    expect(term.citation).toBe("Ley 906/2004, art. 179");
    expect(term.deadlineDate > anchor.date).toBe(true);
  });

  it("ignores anchors of a different type or event", () => {
    const rules = [draftRule({ status: "RATIFIED", ratified_at: "2026-08-01T00:00:00Z" })];
    expect(
      computePenalTerms(rules, [{ ...anchor, type: "ANCHOR_ACTO" }]),
    ).toEqual([]);
    expect(computePenalTerms(rules, [{ ...anchor, event: "PREPARATORIA" }])).toEqual([]);
  });

  it("supports calendar-day rules (arts. 343 / 365)", () => {
    const rules = [
      draftRule({
        deadline_type: "PENAL_ACUSACION_A_PREPARATORIA",
        anchor_event: "AUDIENCIA_ACUSACION",
        days_amount: 45,
        day_type: "CALENDAR",
        status: "RATIFIED",
        ratified_at: "2026-08-01T00:00:00Z",
      }),
    ];
    const [term] = computePenalTerms(rules, [
      { type: "ANCHOR_AUDIENCIA", event: "AUDIENCIA_ACUSACION", date: "2026-08-14" },
    ]);
    expect(term.deadlineDate).toBe("2026-09-28");
  });
});

describe("B7 — penal classification vocabulary", () => {
  const sender = "j04pccbaq@cendoj.ramajudicial.gov.co";
  it.each([
    ["Audiencia de formulación de acusación", "ACUSACION"],
    ["Allanamiento a cargos del procesado", "ALLANAMIENTO"],
    ["Preacuerdo con la Fiscalía", "PREACUERDO"],
    ["Traslado del escrito de acusación", "ESCRITO_ACUSACION"],
    ["Solicitud de preclusión", "PRECLUSION"],
    ["Imposición de medida de aseguramiento", "MEDIDA_ASEGURAMIENTO"],
    ["Formulación de imputación", "IMPUTACION"],
    ["Citación a audiencia concentrada", "CITACION_AUDIENCIA"],
  ])("%s → %s", (subject, expected) => {
    expect(classifyEvidenceSubtype(subject, sender)).toBe(expected);
  });
});

describe("B8 — penal CUI decomposition", () => {
  it("validates structurally and resolves its base", () => {
    expect(validateCgpRadicado(PENAL_CUI).valid).toBe(true);
    expect(normalizeRadicado(PENAL_CUI)).toMatchObject({ ok: true, radicado23: PENAL_CUI });
    const parts = formatRadicadoWithLabels(PENAL_CUI);
    expect(parts.find((p) => p.code === "dane")?.value).toBe("08001"); // Barranquilla
    expect(parts.find((p) => p.code === "year")?.value).toBe("2025");
    expect(parts.find((p) => p.code === "consec")?.value).toBe("31226");
    // Base for matching = the 21-digit prefix (instance-independent).
    expect(PENAL_CUI.slice(0, 21)).toBe("080016001257202531226");
  });
});