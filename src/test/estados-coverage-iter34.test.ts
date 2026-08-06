import { describe, it, expect } from "vitest";
import {
  ESTADOS_SIGNAL_LABEL,
  ESTADOS_SIGNAL_EXPLANATION,
  estadosSignalTone,
  estadosSignalAlerts,
  estadosProviderForWorkflow,
  isWithinCoverageWindow,
  pubMatchesProvider,
  DAILY_REACH_DAYS,
  type EstadosSignalClass,
} from "@/lib/estados-coverage-signal";

const ALL: EstadosSignalClass[] = [
  "CUBIERTO",
  "ESTADOS_ESPERADOS_AUSENTES",
  "ESTADOS_SIN_FIJACION_CONOCIDA",
  "SIN_COBERTURA_DECLARADA",
  "SIN_COBERTURA_EN_ESA_FECHA",
  "ESTADO_SIN_DOCUMENTO",
];

describe("iter34 · provider attribution", () => {
  it("routes CPACA estados to samai_estados, never to publicaciones", () => {
    expect(estadosProviderForWorkflow("CPACA")).toBe("samai_estados");
  });

  it("routes ordinary jurisdictions to publicaciones", () => {
    for (const wt of ["CGP", "LABORAL", "PENAL_906", "EJECUTIVO", "TUTELA"]) {
      expect(estadosProviderForWorkflow(wt)).toBe("publicaciones");
    }
  });

  it("returns null for workflows with no external estados provider", () => {
    expect(estadosProviderForWorkflow("PETICION")).toBeNull();
    expect(estadosProviderForWorkflow(null)).toBeNull();
  });

  it("does not count a samai publication as PP coverage and vice versa", () => {
    expect(pubMatchesProvider("samai_estados", "samai_estados")).toBe(true);
    expect(pubMatchesProvider("samai_estados", "publicaciones")).toBe(false);
    expect(pubMatchesProvider("publicaciones", "publicaciones")).toBe(true);
    expect(pubMatchesProvider("publicaciones", "samai_estados")).toBe(false);
  });
});

describe("iter34 · coverage is time-bounded", () => {
  // Iteration 35 supersedes the bare window: an edge only silences when it is
  // GENUINE. The La Ceja window itself was retracted (its edges were censored),
  // so this fixture keeps the time-bounding rule under a confirmed window.
  const laCeja = {
    publishes_from: "2024-05-15",
    publishes_until: "2026-04-30",
    from_confidence: "GENUINE" as const,
    until_confidence: "GENUINE" as const,
  };

  it("treats a fijación before the first known publication as out of window", () => {
    expect(isWithinCoverageWindow("2022-11-03", laCeja)).toBe(false);
  });

  it("treats a fijación after the last known publication as out of window", () => {
    expect(isWithinCoverageWindow("2026-06-10", laCeja)).toBe(false);
  });

  it("keeps in-window fijaciones inside coverage", () => {
    expect(isWithinCoverageWindow("2025-03-01", laCeja)).toBe(true);
  });

  it("assumes coverage when no window is known", () => {
    expect(isWithinCoverageWindow("2025-03-01", null)).toBe(true);
  });
});

describe("iter34 · alerting", () => {
  it("never alerts on an out-of-window or document-less class", () => {
    expect(
      estadosSignalAlerts({ signal_class: "SIN_COBERTURA_EN_ESA_FECHA", recent_unmatched_count: 5 }),
    ).toBe(false);
    expect(
      estadosSignalAlerts({ signal_class: "ESTADO_SIN_DOCUMENTO", recent_unmatched_count: 1 }),
    ).toBe(false);
  });

  it("does not alert when nothing is reachable by the daily pipeline", () => {
    expect(
      estadosSignalAlerts({
        signal_class: "ESTADOS_ESPERADOS_AUSENTES",
        recent_unmatched_count: 4,
        alertable_unmatched_count: 0,
      }),
    ).toBe(false);
  });

  it("alerts when a reachable gap survives", () => {
    expect(
      estadosSignalAlerts({
        signal_class: "ESTADOS_ESPERADOS_AUSENTES",
        recent_unmatched_count: 2,
        alertable_unmatched_count: 2,
      }),
    ).toBe(true);
  });

  it("mirrors the provider daily horizon", () => {
    expect(DAILY_REACH_DAYS).toBe(120);
  });
});

describe("iter34 · surface text", () => {
  it("has a Spanish label, explanation and tone for every class", () => {
    for (const c of ALL) {
      expect(ESTADOS_SIGNAL_LABEL[c]).toBeTruthy();
      expect(ESTADOS_SIGNAL_EXPLANATION[c]).toBeTruthy();
      expect(estadosSignalTone(c)).toMatch(/border-/);
    }
  });

  it("states that the term runs for a document-less estado", () => {
    expect(ESTADOS_SIGNAL_EXPLANATION.ESTADO_SIN_DOCUMENTO).toContain("el término corre");
  });

  it("does not describe an out-of-window fijación as an anomaly", () => {
    expect(ESTADOS_SIGNAL_EXPLANATION.SIN_COBERTURA_EN_ESA_FECHA).toContain("No es una anomalía");
  });
});
