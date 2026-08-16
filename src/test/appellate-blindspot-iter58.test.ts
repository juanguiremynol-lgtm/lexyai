/**
 * Iteration 58 — appellate blind spot.
 *
 * The estados source derives the despacho from the radicado prefix, so once the
 * appeal is granted the second-instance activity is structurally invisible.
 * That silence must be named, never read as coverage.
 */
import { describe, it, expect } from "vitest";
import {
  actIsApelacionConcedida,
  estadosSignalAlerts,
  estadosSignalTone,
  isAppellateBlindspot,
  APPELLATE_BLINDSPOT_MIN_DAYS,
  ESTADOS_SIGNAL_LABEL,
  ESTADOS_SIGNAL_EXPLANATION,
} from "@/lib/estados-coverage-signal";
import { alertTypeLabel } from "@/lib/alerts/doctrine";

describe("appellate vocabulary mirrors the SQL predicate", () => {
  it.each([
    "Auto que concede apelación",
    "Envio A Superior Por Interpuestos Sin Finalizacion - surtir el recurso de apelación interpuesto",
    "Concede el recurso de apelación en el efecto suspensivo",
    "Disponer la remisión de copia del expediente al Honorable Tribunal Superior de Medellín",
  ])("detects %s", (text) => {
    expect(actIsApelacionConcedida(text, null)).toBe(true);
  });

  it.each(["Auto admisorio de la demanda", "Fijación en estado", ""])(
    "does not fire on %s",
    (text) => {
      expect(actIsApelacionConcedida(text, null)).toBe(false);
    },
  );
});

describe("blind spot threshold", () => {
  it("needs an appeal date", () => {
    expect(isAppellateBlindspot({ apelacion_date: null, pubs_after: 0, dias_sin_estados: 90 })).toBe(false);
  });

  it("is closed as soon as an estado arrives after the appeal", () => {
    expect(
      isAppellateBlindspot({ apelacion_date: "2026-07-09", pubs_after: 1, dias_sin_estados: 40 }),
    ).toBe(false);
  });

  it("waits out the minimum silence before speaking", () => {
    expect(
      isAppellateBlindspot({
        apelacion_date: "2026-07-09",
        pubs_after: 0,
        dias_sin_estados: APPELLATE_BLINDSPOT_MIN_DAYS - 1,
      }),
    ).toBe(false);
    expect(
      isAppellateBlindspot({
        apelacion_date: "2026-07-09",
        pubs_after: 0,
        dias_sin_estados: APPELLATE_BLINDSPOT_MIN_DAYS,
      }),
    ).toBe(true);
  });
});

describe("the class is surfaced, and it is not a coverage gap", () => {
  it("never raises the coverage-gap alert", () => {
    expect(
      estadosSignalAlerts({ signal_class: "APELACION_EN_SUPERIOR", recent_unmatched_count: 5 }),
    ).toBe(false);
  });

  it("has Spanish surface and a tone", () => {
    expect(ESTADOS_SIGNAL_LABEL.APELACION_EN_SUPERIOR).toBeTruthy();
    expect(ESTADOS_SIGNAL_EXPLANATION.APELACION_EN_SUPERIOR.length).toBeGreaterThan(40);
    expect(estadosSignalTone("APELACION_EN_SUPERIOR")).toContain("text-");
  });

  it("has its own alert type label", () => {
    expect(alertTypeLabel("ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE")).toBe("Apelación en el superior");
  });
});
