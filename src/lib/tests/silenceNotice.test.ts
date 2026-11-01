/**
 * IT1 — the silence notice informs the lawyer and can never act.
 * 2026-11-01 contrast: silence is measured from judicial dates only, in
 * Bogotá calendar days. All fixtures are synthetic.
 */
import { describe, it, expect } from "vitest";
import {
  buildSilenceNotice,
  calendarDaysBetween,
  evaluateSilence,
  shouldNotify,
  isSilenceCandidate,
  describeSilence,
  channelEvidence,
  ESTADO_NO_VERIFICABLE,
  SIN_ACTUACIONES_VERIFICABLES,
  SILENCIO_ES_NORMAL,
  DECISION_ES_SUYA,
  type SilenceEvaluationInput,
} from "../../../supabase/functions/_shared/silenceNotice.ts";

const RAD = "99999999999920250000100"; // synthetic
// 2026-11-01 08:00 Bogotá == 13:00 UTC. Also test a late-evening cut.
const CUT = new Date("2026-11-01T13:00:00Z");
const CUT_LATE = new Date("2026-11-02T03:30:00Z"); // still 2026-11-01 in Bogotá
const OK_SOURCE = [{ source_input_type: "RADICADO", scrape_status: "SUCCESS", last_synced_at: "2026-10-31T12:00:00Z" }];

const base = (over: Partial<SilenceEvaluationInput> = {}): SilenceEvaluationInput => ({
  radicado: RAD,
  lifecycle_state: "ACTIVE",
  monitoring_enabled: true,
  created_at: "2026-07-27T15:00:00Z",
  acts: [],
  pubs: [],
  sources: OK_SOURCE,
  ...over,
});

describe("silence · judicial base dates", () => {
  it("auto 2025-07-09 / estado 2025-07-10, ficha 2026-07-27 → 480 / 479, never 96/97", () => {
    for (const cut of [CUT, CUT_LATE]) {
      const ev = evaluateSilence(base({
        acts: [{ act_date: "2025-07-09", source: "cpnu" }],
        pubs: [{ fecha_fijacion: "2025-07-10T05:00:00Z", fecha_providencia: "2025-07-09T05:00:00Z", source: "publicaciones" }],
      }), cut);
      expect(ev.corte).toBe("2026-11-01");
      expect(ev.ultima_actuacion?.dias).toBe(480);
      expect(ev.ultimo_estado?.dias).toBe(479);
      expect(ev.ultimo_estado?.fecha_providencia).toBe("2025-07-09");
      expect(ev.kind).toBe("SILENCIO");
      expect(ev.fuente_base).toBe("estado");
      expect(ev.dias).toBe(479);
      expect(ev.dias).not.toBe(96);
      expect(ev.dias).not.toBe(97);
    }
  });

  it("auto 2026-03-12, ficha 2026-01-25 → 234, never 280", () => {
    const ev = evaluateSilence(base({
      created_at: "2026-01-25T12:00:00Z",
      acts: [{ act_date: "2026-03-12", source: "samai" }],
    }), CUT);
    expect(ev.dias).toBe(234);
    expect(ev.fuente_base).toBe("actuacion");
  });

  it("no UTC truncation off-by-one: estado fijado 2025-07-10 00:00 Bogotá", () => {
    const ev = evaluateSilence(base({
      pubs: [{ fecha_fijacion: "2025-07-10T05:00:00Z", fecha_providencia: null }],
    }), CUT_LATE);
    expect(ev.dias).toBe(479);
    expect(calendarDaysBetween("2025-07-10", "2026-11-01")).toBe(479);
  });

  it("ignores email acts, inferred-sync dates and rows attributed to another radicado", () => {
    const ev = evaluateSilence(base({
      acts: [
        { act_date: "2026-10-30", source: "email" },
        { act_date: "2026-10-29", source: "cpnu", source_radicado: "11111111111120240000100" },
        { act_date: "2026-03-12", source: "cpnu" },
      ],
      pubs: [{ fecha_fijacion: "2026-10-31T12:00:00Z", fecha_providencia: null, date_source: "inferred_sync" }],
    }), CUT);
    expect(ev.fecha_base).toBe("2026-03-12");
    expect(ev.dias).toBe(234);
  });
});

describe("silence · semantics", () => {
  it("private process has no verifiable silence figure", () => {
    const ev = evaluateSilence(base({
      acts: [{ act_date: "2025-07-09", source: "cpnu" }],
      sources: [{ source_input_type: "RADICADO", last_error_code: "PROCESO_PRIVADO", last_synced_at: "2026-10-31T12:00:00Z" }],
    }), CUT);
    expect(ev.kind).toBe("NO_VERIFICABLE");
    expect(ev.dias).toBeNull();
    const n = buildSilenceNotice({ radicado: RAD, evaluation: ev, canales: [], perfil_despacho: "x" });
    expect(n.title).toContain(ESTADO_NO_VERIFICABLE);
    expect(n.title).not.toMatch(/hace \d+ días/);
  });

  it("no judicial acts never measures from created_at", () => {
    const ev = evaluateSilence(base({ created_at: "2026-01-25T12:00:00Z" }), CUT);
    expect(ev.kind).toBe("SIN_ACTUACIONES");
    expect(ev.dias).toBeNull();
    expect(ev.fecha_base).toBeNull();
    const n = buildSilenceNotice({ radicado: RAD, evaluation: ev, canales: [], perfil_despacho: "x" });
    expect(n.title).toContain(SIN_ACTUACIONES_VERIFICABLES);
    expect(n.message).toContain("(no es una actuación)");
  });

  it("no successful read = not verifiable, not silence", () => {
    const ev = evaluateSilence(base({
      acts: [{ act_date: "2025-07-09", source: "cpnu" }],
      sources: [{ source_input_type: "RADICADO", scrape_status: "FAILED", last_synced_at: null }],
    }), CUT);
    expect(ev.kind).toBe("NO_VERIFICABLE");
  });

  it("archived, trashed, paused and monitoring-off matters never alert", () => {
    for (const over of [
      { lifecycle_state: "ARCHIVED" },
      { lifecycle_state: "TRASHED" },
      { lifecycle_state: "PAUSED" },
      { monitoring_enabled: false },
    ]) {
      const ev = evaluateSilence(base({ acts: [{ act_date: "2025-07-09", source: "cpnu" }], ...over }), CUT);
      expect(ev.kind).toBe("EXCLUDED");
      expect(shouldNotify(ev)).toBe(false);
    }
  });

  it("legacy helper never falls back to the card date", () => {
    expect(isSilenceCandidate(
      { created_at: "2025-01-01T00:00:00Z", last_signal_at: null, lifecycle_state: "ACTIVE", monitoring_enabled: true },
      CUT,
    )).toBe(false);
  });
});

describe("IT1 · copy", () => {
  const ev = evaluateSilence(base({ acts: [{ act_date: "2026-03-12", source: "cpnu" }] }), CUT);
  const notice = buildSilenceNotice({ radicado: RAD, titulo: "Asunto sintético", evaluation: ev, canales: [], perfil_despacho: "x" });

  it("shows base date, source and cut", () => {
    expect(notice.title).toContain("Sin novedades hace 234 días");
    expect(notice.message).toContain("Fecha base 2026-03-12 (actuacion); corte 2026-11-01");
  });
  it("states plainly that silence is normal and does not warn", () => {
    expect(notice.message).toContain(SILENCIO_ES_NORMAL);
    expect(notice.message).toContain("no es una advertencia");
  });
  it("offers the pause as the lawyer's option only", () => {
    expect(notice.message).toContain(DECISION_ES_SUYA);
  });
});

describe("silence · review risks (2026-11-01)", () => {
  const act = [{ act_date: "2025-07-09", source: "cpnu" }];

  it("(1) internal read failure is not verifiable and never notifies", () => {
    const ev = evaluateSilence(base({ read_errors: ["work_item_acts"] }), CUT);
    expect(ev.kind).toBe("NO_VERIFICABLE");
    expect(ev.causa).toContain("LECTURA_INTERNA_FALLIDA");
    expect(shouldNotify(ev)).toBe(false);
  });

  it("(2) null status, unknown status and stale success do not certify silence", () => {
    for (const s of [
      { scrape_status: null, last_synced_at: "2026-10-31T12:00:00Z" },
      { scrape_status: "WHATEVER", last_synced_at: "2026-10-31T12:00:00Z" },
    ]) {
      expect(evaluateSilence(base({ acts: act, sources: [s] }), CUT).kind).toBe("NO_VERIFICABLE");
    }
    const stale = evaluateSilence(base({ acts: act, sources: [{ scrape_status: "SUCCESS", last_synced_at: "2026-10-20T12:00:00Z" }] }), CUT);
    expect(stale.kind).toBe("NO_VERIFICABLE");
    expect(stale.causa).toBe("LECTURA_FUERA_DE_SLA");
    expect(stale.ultima_verificacion).toBe("2026-10-20");
  });

  it("(2) a current partial/failed source is not hidden by an older success", () => {
    const ev = evaluateSilence(base({
      acts: act,
      sources: [
        { scrape_status: "SUCCESS", last_synced_at: "2026-10-31T12:00:00Z" },
        { scrape_status: "PARTIAL_SUCCESS", last_synced_at: "2026-10-01T12:00:00Z" },
      ],
    }), CUT);
    expect(ev.kind).toBe("NO_VERIFICABLE");
    expect(ev.causa).toBe("LECTURA_ACTUAL_PARTIAL_SUCCESS");
  });

  it("(3) superseded, under-review, unknown-source and unattributed estado rows are not valid acts", () => {
    const ev = evaluateSilence(base({
      acts: [
        { act_date: "2026-10-30", source: "cpnu", is_canonical: false },
        { act_date: "2026-10-29", source: "cpnu", requiere_revision_manual: true },
        { act_date: "2026-10-28", source: null },
        { act_date: "2026-10-27", source: "publicaciones" },
        { act_date: "2026-03-12", source: "cpnu" },
      ],
      pubs: [{ fecha_fijacion: "2026-10-31T12:00:00Z", fecha_providencia: null, source: "publicaciones" }],
    }), CUT);
    expect(ev.fecha_base).toBe("2026-03-12");
    expect(ev.dias).toBe(234);
  });

  it("(4) minimum card age still applies to SILENCIO", () => {
    const ev = evaluateSilence(base({ created_at: "2026-10-01T12:00:00Z", acts: act }), CUT);
    expect(ev.kind).toBe("SILENCIO");
    expect(shouldNotify(ev)).toBe(false);
  });

  it("(5) lawyer-verified manual reference is labelled and never reported as CPNU", () => {
    const ev = evaluateSilence(base({
      acts: act,
      manual_references: [{ finding_id: "f1", fecha_providencia: "2026-03-12", verified_on: "2026-10-30", verified_by: "abogado" }],
    }), CUT);
    expect(ev.fuente_base).toBe("referencia_manual");
    expect(ev.dias).toBe(234);
    expect(ev.ultima_actuacion?.fecha).toBe("2025-07-09");
    expect(describeSilence(ev)).toContain("no proviene del proveedor");
  });

  it("(6) channel lines reflect card-level coverage, no contradictory 'sin lectura'", () => {
    const ev = evaluateSilence(base({ acts: act }), CUT);
    const lines = channelEvidence(ev, "SUCCESS");
    expect(lines[0].ultima_lectura).toBe("2026-10-31");
    expect(lines.every((l) => !l.ultima_respuesta.includes("sin lectura"))).toBe(true);
  });
});
