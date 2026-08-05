/**
 * Iteration 32 — LABORAL and EJECUTIVO as first-class workflows, plus the
 * "ejecutivo a continuación" track model (CGP art. 306).
 */
import { describe, it, expect } from "vitest";
import {
  getWorkflowPhases,
  resolveLaboralRegimen,
  inferPhaseFromText,
} from "@/lib/workflow-phases";
import { WORKFLOW_TYPES, EJECUTIVO_STAGES } from "@/lib/workflow-constants";
import {
  implicitTrack,
  activeTrack,
  activeTrackPhases,
  trackForDate,
  suggestEjecutivoAContinuacion,
  isRegressionAcrossTracks,
  TRACK_LABELS,
  type ProceduralTrack,
} from "@/lib/tracks/procedural-tracks";
import { classifyEvidenceSubtype } from "../../supabase/functions/_shared/emailMatcher";

describe("A — LABORAL dual regime", () => {
  it("routes filings before 2026-04-02 to the 1948 code", () => {
    expect(resolveLaboralRegimen("2026-03-31")).toBe("LABORAL_CPTSS_1948");
    expect(resolveLaboralRegimen("2025-01-10")).toBe("LABORAL_CPTSS_1948");
  });

  it("routes filings from 2026-04-02 to Ley 2452 de 2025", () => {
    expect(resolveLaboralRegimen("2026-04-02")).toBe("LABORAL_2452");
    expect(resolveLaboralRegimen("2026-09-01")).toBe("LABORAL_2452");
  });

  it("exposes a phase catalogue for the labour workflow", () => {
    const phases = getWorkflowPhases("LABORAL");
    expect(phases.length).toBeGreaterThan(3);
  });
});

describe("B — EJECUTIVO workflow", () => {
  it("is a registered workflow type with its own label", () => {
    expect(WORKFLOW_TYPES.EJECUTIVO).toBeDefined();
    expect(WORKFLOW_TYPES.EJECUTIVO.label).toMatch(/ejecutivo/i);
  });

  it("has the apremio stage sequence including terminal branches", () => {
    const keys = Object.keys(EJECUTIVO_STAGES);
    expect(keys).toContain("MANDAMIENTO_PAGO");
    expect(keys).toContain("EXCEPCIONES_MERITO");
    expect(keys).toContain("SEGUIR_ADELANTE");
    expect(keys).toContain("AVALUO_REMATE");
    expect(keys).toContain("TERMINACION_PAGO");
  });

  it("infers the executive phase from provider text", () => {
    expect(inferPhaseFromText("EJECUTIVO", "Auto libra mandamiento de pago")).toBeTruthy();
  });
});

describe("B4 — executive vocabulary no longer falls into OTRO_JUDICIAL", () => {
  const j = "juzgado01civilbog@cendoj.ramajudicial.gov.co";
  const cases: Array<[string, string]> = [
    ["Auto libra mandamiento de pago", "MANDAMIENTO_PAGO"],
    ["Sentencia que ordena seguir adelante la ejecución", "SEGUIR_ADELANTE"],
    ["Traslado de las excepciones de mérito", "EXCEPCIONES_MERITO"],
    ["Liquidación del crédito y costas", "LIQUIDACION_CREDITO"],
    ["Avalúo de bienes embargados", "AVALUO"],
    ["Señalamiento de fecha de remate", "REMATE"],
  ];
  for (const [subject, expected] of cases) {
    it(`classifies "${subject}" as ${expected}`, () => {
      expect(classifyEvidenceSubtype(subject, j)).toBe(expected);
    });
  }
});

/* ------------------------------------------------------------------ */

function track(over: Partial<ProceduralTrack>): ProceduralTrack {
  return {
    id: over.id ?? "t",
    work_item_id: "wi",
    track_kind: "DECLARATIVO",
    workflow_type: "CGP",
    regimen: null,
    sequence_index: 0,
    current_phase: null,
    status: "ACTIVE",
    started_at: null,
    closed_at: null,
    opened_by_event: null,
    notes: null,
    ...over,
  };
}

describe("C — ejecutivo a continuación tracks", () => {
  it("gives every work item an implicit declarative track", () => {
    const t = implicitTrack("wi", "CGP", null);
    expect(t.track_kind).toBe("DECLARATIVO");
    expect(t.status).toBe("ACTIVE");
  });

  it("labels the art. 306 track with its citation", () => {
    expect(TRACK_LABELS.EJECUTIVO_A_CONTINUACION).toMatch(/306/);
  });

  it("suggests — never auto-opens — the executive track on a mandamiento de pago", () => {
    const s = suggestEjecutivoAContinuacion({
      workflowType: "CGP",
      tracks: [track({ id: "t0" })],
      latestActText: "Auto que libra mandamiento de pago",
      latestActDate: "2026-05-10",
    });
    expect(s).not.toBeNull();
    expect(s!.kind).toBe("EJECUTIVO_A_CONTINUACION");
    expect(s!.workflowType).toBe("EJECUTIVO");
    expect(s!.citation).toBe("CGP, art. 306");
  });

  it("does not suggest twice once the track exists", () => {
    const s = suggestEjecutivoAContinuacion({
      workflowType: "CGP",
      tracks: [
        track({ id: "t0", status: "CLOSED" }),
        track({ id: "t1", track_kind: "EJECUTIVO_A_CONTINUACION", workflow_type: "EJECUTIVO", sequence_index: 1 }),
      ],
      latestActText: "Auto que libra mandamiento de pago",
    });
    expect(s).toBeNull();
  });

  it("does not suggest a track inside an autonomous executive matter", () => {
    const s = suggestEjecutivoAContinuacion({
      workflowType: "EJECUTIVO",
      tracks: [track({ workflow_type: "EJECUTIVO", track_kind: "EJECUTIVO_AUTONOMO" })],
      latestActText: "Auto que libra mandamiento de pago",
    });
    expect(s).toBeNull();
  });

  it("uses the ACTIVE track's phase catalogue", () => {
    const tracks = [
      track({ id: "t0", status: "CLOSED" }),
      track({ id: "t1", track_kind: "EJECUTIVO_A_CONTINUACION", workflow_type: "EJECUTIVO", sequence_index: 1 }),
    ];
    expect(activeTrack(tracks)!.id).toBe("t1");
    expect(activeTrackPhases(tracks, "CGP")).toEqual(getWorkflowPhases("EJECUTIVO"));
  });

  it("attributes events to the track open on their date", () => {
    const tracks = [
      track({ id: "t0", started_at: "2024-01-01", status: "CLOSED" }),
      track({
        id: "t1",
        track_kind: "EJECUTIVO_A_CONTINUACION",
        workflow_type: "EJECUTIVO",
        sequence_index: 1,
        started_at: "2026-05-10",
      }),
    ];
    expect(trackForDate(tracks, "2025-06-01")!.id).toBe("t0");
    expect(trackForDate(tracks, "2026-06-01")!.id).toBe("t1");
  });

  it("does not treat a track change as a stage regression", () => {
    expect(isRegressionAcrossTracks("t0", "t1")).toBe(false);
    expect(isRegressionAcrossTracks("t0", "t0")).toBe(true);
  });
});
