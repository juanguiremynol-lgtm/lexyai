/**
 * ITERATION 42 — the class contract must survive the freshness fallback, the
 * board must look like every other board, and a disagreeing class must be an
 * offer rather than a rewrite.
 */
import { describe, it, expect } from "vitest";
import { phaseColor } from "@/lib/phase-palette";
import { getWorkflowPhases } from "@/lib/workflow-phases";
import { decideClaseProcesoWrite } from "../../supabase/functions/_shared/claseProcesoWriter";
import {
  coerceClaseContract,
  parseClaseProveedor,
  extractClaseProveedor,
} from "../../supabase/functions/_shared/claseProcesoContract";
import { computePenalTerms } from "@/lib/penal906/penal906-terms";
import type { WorkflowDeadlineRule } from "@/hooks/use-workflow-deadline-rules";

const MAP = [
  { pattern: "ejecutivos de menor y minima cuantia", workflow_type: "EJECUTIVO", label: "Ejecutivo mínima cuantía" },
  { pattern: "procesos ejecutivos", workflow_type: "EJECUTIVO", label: "Proceso ejecutivo" },
  { pattern: "ejecutivo", workflow_type: "EJECUTIVO", label: "Proceso ejecutivo" },
  { pattern: "verbal", workflow_type: "CGP", label: "Verbal" },
];

describe("iter42 — the read is recorded even when it yields nothing", () => {
  it("an absent block is INCONCLUSIVE, never a silent skip", () => {
    const d = decideClaseProcesoWrite({
      contract: coerceClaseContract(undefined),
      current: { clase_proceso: "PROCESOS EJECUTIVOS", workflow_type: "CGP" },
      map: MAP,
    });
    expect(d.readCase).toBe("INCONCLUSIVE");
    expect(d.patch).toEqual({});
  });

  it("an already-parsed contract is not re-wrapped", () => {
    const parsed = parseClaseProveedor({ disponible: true, clase_proceso: "PROCESOS EJECUTIVOS" });
    expect(coerceClaseContract(parsed)).toBe(parsed);
    expect(coerceClaseContract(parsed).clase_proceso).toBe("PROCESOS EJECUTIVOS");
  });

  it("a raw provider block is still parsed", () => {
    expect(coerceClaseContract({ disponible: true, clase_proceso: "Ejecutivo" }).clase_proceso).toBe("Ejecutivo");
    expect(extractClaseProveedor(null).disponible).toBe(false);
  });
});

describe("iter42 — an executive class is an offer, never a rewrite", () => {
  for (const clase of ["EJECUTIVOS DE MENOR Y MINIMA CUANTIA", "PROCESOS EJECUTIVOS", "Ejecutivo", "Ejecutivo Singular"]) {
    it(`"${clase}" suggests EJECUTIVO and leaves workflow_type untouched`, () => {
      const d = decideClaseProcesoWrite({
        contract: parseClaseProveedor({ disponible: true, clase_proceso: clase }),
        current: { workflow_type: "CGP", workflow_type_source: "AUTO" },
        map: MAP,
      });
      expect(d.workflow.kind).toBe("SUGGEST");
      expect(d.workflow.kind === "SUGGEST" && d.workflow.workflow).toBe("EJECUTIVO");
      expect(d.patch).not.toHaveProperty("workflow_type");
      expect(d.patch.clase_proceso).toBe(clase);
    });
  }

  it("a MANUAL matter is never even suggested against", () => {
    const d = decideClaseProcesoWrite({
      contract: parseClaseProveedor({ disponible: true, clase_proceso: "PROCESOS EJECUTIVOS" }),
      current: { workflow_type: "CGP", workflow_type_source: "MANUAL" },
      map: MAP,
    });
    expect(d.workflow.kind).toBe("NONE");
  });
});

describe("iter42 — every board reads as the same object", () => {
  it("colour is a function of the phase, not of the workflow", () => {
    expect(phaseColor("RADICACION", 3)).toBe(phaseColor("RADICACION", 9));
    expect(phaseColor("PREPARACION", 0)).toBe("slate");
    expect(phaseColor("SENTENCIA", 0)).toBe("purple");
  });

  it("terminal branches are neutral", () => {
    expect(phaseColor("TERMINACION_PAGO", 10, { branch: true })).toBe("stone");
  });

  it("no EJECUTIVO column falls back to a flat repeated hue", () => {
    const phases = getWorkflowPhases("EJECUTIVO");
    const linear = phases.filter((p) => !p.branch);
    const colours = linear.map((p, i) => phaseColor(p.key, i));
    expect(new Set(colours).size).toBe(linear.length);
  });
});

describe("iter42 — the engine follows the área once the offer is accepted", () => {
  const eje: WorkflowDeadlineRule = {
    id: "eje", organization_id: null, workflow_type: "EJECUTIVO", regimen: null,
    track_kind: "EJECUTIVO", deadline_type: "EJE_PAGAR_O_EXCEPCIONAR",
    label: "Pagar o proponer excepciones", citation: "CGP art. 442 num. 1",
    anchor_type: "ANCHOR_NOTIFICACION", anchor_event: "NOTIFICACION_MANDAMIENTO_PAGO",
    days_amount: 10, day_type: "BUSINESS", description: null, research_notes: null,
    sources: null, requires_manual_review: false, status: "RATIFIED",
    ratified_at: "2026-08-06T00:00:00Z", ratified_by: "owner",
  } as WorkflowDeadlineRule;

  it("computes the executive term from the mandamiento notification", () => {
    const [term] = computePenalTerms(
      [eje],
      [{ type: "ANCHOR_NOTIFICACION", event: "NOTIFICACION_MANDAMIENTO_PAGO", date: "2026-08-03" }],
    );
    expect(term.ruleId).toBe("eje");
    expect(term.deadlineDate).toBe("2026-08-18");
  });

  it("a CGP-only catalogue produces nothing for an executive anchor", () => {
    const terms = computePenalTerms(
      [{ ...eje, id: "cgp", workflow_type: "CGP", anchor_event: "TRASLADO_DEMANDA" } as WorkflowDeadlineRule],
      [{ type: "ANCHOR_NOTIFICACION", event: "NOTIFICACION_MANDAMIENTO_PAGO", date: "2026-08-03" }],
    );
    expect(terms).toHaveLength(0);
  });
});
