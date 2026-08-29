/**
 * IT1 — the silence notice informs the lawyer and can never act.
 */
import { describe, it, expect } from "vitest";
import {
  buildSilenceNotice,
  isSilenceCandidate,
  SILENCE_DAYS,
  SILENCIO_ES_NORMAL,
  DECISION_ES_SUYA,
} from "../../../supabase/functions/_shared/silenceNotice.ts";

const NOW = new Date("2026-08-29T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("IT1 · eligibility", () => {
  it("never fires on a newly registered matter (IT1d)", () => {
    expect(
      isSilenceCandidate(
        { created_at: daysAgo(5), last_signal_at: null, lifecycle_state: "ACTIVE", monitoring_enabled: true },
        NOW,
      ),
    ).toBe(false);
  });

  it("fires on an old monitored matter with no signal", () => {
    expect(
      isSilenceCandidate(
        { created_at: daysAgo(200), last_signal_at: daysAgo(SILENCE_DAYS + 1), lifecycle_state: "ACTIVE", monitoring_enabled: true },
        NOW,
      ),
    ).toBe(true);
  });

  it("ignores matters the lawyer already paused", () => {
    expect(
      isSilenceCandidate(
        { created_at: daysAgo(200), last_signal_at: daysAgo(200), lifecycle_state: "PAUSED", monitoring_enabled: false },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("IT1 · copy", () => {
  const notice = buildSilenceNotice({
    radicado: "05376408900220250066300",
    titulo: "Cifuentes vs Verde PH",
    dias_en_silencio: 60,
    registrado_hace_dias: 90,
    canales: [
      { canal: "Actuaciones (CPNU)", ultimo_dato: null, ultima_respuesta: "leído y vacío", ultima_lectura: daysAgo(1) },
    ],
    perfil_despacho: "Sin evidencia suficiente sobre este despacho.",
  });

  it("states plainly that silence is normal and does not warn", () => {
    expect(notice.message).toContain(SILENCIO_ES_NORMAL);
    expect(notice.message).toContain("no es una advertencia");
  });

  it("offers the pause as the lawyer's option only", () => {
    expect(notice.message).toContain(DECISION_ES_SUYA);
    expect(notice.message).toContain("Andrómeda nunca lo pausará por silencio");
  });
});
