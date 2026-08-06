/**
 * Iteration 38 — ratified EJECUTIVO rules, corrected avalúo term, oral appeal
 * anchor, and the engine's computation on the live mandamiento.
 */
import { describe, expect, it } from "vitest";
import { computePenalTerms } from "@/lib/penal906/penal906-terms";
import {
  buildRuleTermSuggestions,
  resolveAnchorsFromEvents,
} from "@/lib/workflow-terms/rule-term-suggestions";
import type { WorkflowDeadlineRule } from "@/hooks/use-workflow-deadline-rules";

function rule(p: Partial<WorkflowDeadlineRule>): WorkflowDeadlineRule {
  return {
    id: p.deadline_type ?? "id",
    organization_id: null,
    workflow_type: "EJECUTIVO",
    regimen: null,
    track_kind: "EJECUTIVO",
    deadline_type: "X",
    label: "X",
    citation: null,
    anchor_type: "ANCHOR_NOTIFICACION",
    anchor_event: null,
    days_amount: 0,
    day_type: "BUSINESS",
    description: null,
    research_notes: null,
    sources: null,
    requires_manual_review: false,
    status: "RATIFIED",
    ratified_at: "2026-08-06T00:00:00Z",
    ratified_by: "owner",
    ...p,
  };
}

const PAGAR = rule({
  deadline_type: "EJE_PAGAR_O_EXCEPCIONAR",
  label: "Término para pagar o proponer excepciones",
  citation: "CGP art. 442 num. 1",
  anchor_event: "NOTIFICACION_MANDAMIENTO_PAGO",
  days_amount: 10,
});

describe("iter38 — avalúo split", () => {
  it("observaciones al avalúo run 10 business days (art. 444 num. 2)", () => {
    const [term] = computePenalTerms(
      [rule({ deadline_type: "EJE_OBJECION_AVALUO", anchor_event: "TRASLADO_AVALUO", days_amount: 10 })],
      [{ type: "ANCHOR_NOTIFICACION", event: "TRASLADO_AVALUO", date: "2026-08-04" }],
    );
    expect(term.deadlineDate).toBe("2026-08-20");
  });

  it("the different avalúo has its own 3-day anchor event", () => {
    const terms = computePenalTerms(
      [
        rule({ deadline_type: "EJE_OBJECION_AVALUO", anchor_event: "TRASLADO_AVALUO", days_amount: 10 }),
        rule({
          deadline_type: "EJE_TRASLADO_AVALUO_DIFERENTE",
          anchor_event: "AVALUO_DIFERENTE_APORTADO",
          days_amount: 3,
        }),
      ],
      [{ type: "ANCHOR_NOTIFICACION", event: "AVALUO_DIFERENTE_APORTADO", date: "2026-08-04" }],
    );
    expect(terms).toHaveLength(1);
    expect(terms[0].deadlineType).toBe("EJE_TRASLADO_AVALUO_DIFERENTE");
  });
});

describe("iter38 — oral appeal anchor", () => {
  it("produces no date and flags the oral, in-hearing moment", () => {
    const [term] = computePenalTerms(
      [
        rule({
          deadline_type: "EJE_APELACION_SENTENCIA_EN_AUDIENCIA",
          anchor_type: "ANCHOR_ORAL_EN_AUDIENCIA",
          anchor_event: "SENTENCIA_EN_AUDIENCIA",
          day_type: "NONE",
          days_amount: 0,
        }),
      ],
      [{ type: "ANCHOR_ORAL_EN_AUDIENCIA", event: "SENTENCIA_EN_AUDIENCIA", date: "2026-08-04" }],
    );
    expect(term.deadlineDate).toBeNull();
    expect(term.oralInHearing).toBe(true);
  });
});

describe("iter38 — engine on 05001400303420260089800", () => {
  const events = [
    { at: "2026-07-31", text: "Auto Libra Mandamiento EjecutivoPago", source: "ACTUACION" as const },
    { at: "2026-08-03", text: "Fijacion Estado", source: "ESTADO" as const },
  ];

  it("anchors on the notification that follows the fijación en estado", () => {
    const anchors = resolveAnchorsFromEvents(events);
    const anchor = anchors.find((a) => a.event === "NOTIFICACION_MANDAMIENTO_PAGO");
    expect(anchor?.date).toBe("2026-08-04");
  });

  it("computes the 10-business-day term with festivos (7 and 17 de agosto)", () => {
    const { suggested } = buildRuleTermSuggestions([PAGAR], events);
    expect(suggested).toHaveLength(1);
    expect(suggested[0].deadlineDate).toBe("2026-08-20");
    expect(suggested[0].requiresManualReview).toBe(false);
  });

  it("DRAFT rules compute nothing", () => {
    const draft = rule({ ...PAGAR, status: "DRAFT", ratified_at: null });
    const { suggested } = buildRuleTermSuggestions([draft], events);
    expect(suggested).toHaveLength(0);
  });
});

describe("iter38 — art. 306 awaits its anchor", () => {
  const art306 = rule({
    deadline_type: "EJE306_SOLICITUD_EJECUCION",
    label: "Solicitud de ejecución a continuación de la sentencia",
    track_kind: "EJECUTIVO_A_CONTINUACION",
    anchor_type: "ANCHOR_EJECUTORIA",
    anchor_event: "EJECUTORIA_SENTENCIA",
    days_amount: 30,
  });

  it("computes nothing when the ejecutoria date is unknown", () => {
    const { suggested, awaiting } = buildRuleTermSuggestions(
      [art306],
      [{ at: "2025-10-27", text: "Fijacion Estado", source: "ESTADO" }],
      ["EJECUTORIA_SENTENCIA"],
    );
    expect(suggested).toHaveLength(0);
    expect(awaiting.map((a) => a.deadlineType)).toContain("EJE306_SOLICITUD_EJECUCION");
  });

  it("computes 30 business days once the ejecutoria is on record", () => {
    const { suggested } = buildRuleTermSuggestions(
      [art306],
      [{ at: "2026-08-04", text: "Constancia de ejecutoria de la sentencia", source: "ACTUACION" }],
    );
    expect(suggested).toHaveLength(1);
    expect(suggested[0].deadlineDate).toBe("2026-09-17");
  });
});
