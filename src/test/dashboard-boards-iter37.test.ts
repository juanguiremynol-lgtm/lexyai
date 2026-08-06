/**
 * ITER37 — boards are derived, catalogues are single-sourced, and the
 * mandamiento cannot be masked by a newer act.
 */
import { describe, it, expect } from "vitest";
import { DASHBOARD_BOARDS, hasPhaseCatalogue, visibleBoards } from "@/lib/dashboard-boards";
import { WORKFLOW_PHASES, getWorkflowPhases } from "@/lib/workflow-phases";
import { EJECUTIVO_STAGES, getStageOrderForWorkflow, type WorkflowType } from "@/lib/workflow-constants";
import { suggestEjecutivoAContinuacion } from "@/lib/tracks/procedural-tracks";

const all = () => true;

describe("dashboard board derivation", () => {
  it("derives boards from practice areas ∩ phase catalogues", () => {
    const boards = visibleBoards(all).map((b) => b.workflow);
    expect(boards).toContain("EJECUTIVO");
    expect(boards).toContain("LABORAL");
    expect(boards).toContain("PENAL_906");
    expect(boards).toContain("CGP");
  });

  it("hides a board whose area is not practised, without special cases", () => {
    const only = (wf: WorkflowType) => wf === "CGP";
    expect(visibleBoards(only).map((b) => b.workflow)).toEqual(["CGP"]);
  });

  it("every registered board owns a non-empty column catalogue", () => {
    for (const b of DASHBOARD_BOARDS) {
      expect(hasPhaseCatalogue(b.workflow)).toBe(true);
      expect(getWorkflowPhases(b.workflow).length).toBeGreaterThan(0);
    }
  });

  it("tab slugs are unique", () => {
    const tabs = DASHBOARD_BOARDS.map((b) => b.tab);
    expect(new Set(tabs).size).toBe(tabs.length);
  });
});

describe("EJECUTIVO catalogue is single-sourced", () => {
  it("has the 12 iteration-32 stages in order", () => {
    expect(WORKFLOW_PHASES.EJECUTIVO.map((p) => p.key)).toEqual([
      "PREPARACION",
      "RADICACION",
      "SUBSANACION",
      "MANDAMIENTO_PAGO",
      "NOTIFICACION_MANDAMIENTO",
      "EXCEPCIONES_MERITO",
      "TRASLADO_EXCEPCIONES",
      "SEGUIR_ADELANTE",
      "LIQUIDACION_CREDITO",
      "AVALUO_REMATE",
      "TERMINACION_PAGO",
      "DESISTIMIENTO",
    ]);
  });

  it("stage vocabulary is derived, never re-declared", () => {
    expect(getStageOrderForWorkflow("EJECUTIVO")).toEqual(
      WORKFLOW_PHASES.EJECUTIVO.map((p) => p.key),
    );
    for (const p of WORKFLOW_PHASES.EJECUTIVO) {
      expect(EJECUTIVO_STAGES[p.key].label).toBe(p.label);
    }
  });
});

describe("ejecutivo a continuación suggestion", () => {
  const base = { workflowType: "CGP" as WorkflowType, tracks: [] };

  it("is not masked by a newer act (case 05001400303420260089800)", () => {
    const s = suggestEjecutivoAContinuacion({
      ...base,
      latestActText: "Fijacion Estado",
      latestActDate: "2026-08-03",
      recentActs: [
        { text: "Auto Libra Mandamiento EjecutivoPago", at: "2026-07-31" },
        { text: "Fijacion Estado", at: "2026-08-03" },
      ],
    });
    expect(s).not.toBeNull();
    expect(s?.triggerDate).toBe("2026-07-31");
    expect(s?.citation).toBe("CGP, art. 306");
  });

  it("stays silent without a mandamiento", () => {
    expect(
      suggestEjecutivoAContinuacion({
        ...base,
        latestActText: "Fijacion Estado",
        recentActs: [{ text: "Auto admisorio", at: "2026-01-01" }],
      }),
    ).toBeNull();
  });

  it("never suggests a track inside an autonomous executive matter", () => {
    expect(
      suggestEjecutivoAContinuacion({
        ...base,
        workflowType: "EJECUTIVO",
        recentActs: [{ text: "Auto libra mandamiento de pago", at: "2026-07-31" }],
      }),
    ).toBeNull();
  });
});
