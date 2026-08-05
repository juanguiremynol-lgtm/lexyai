/**
 * Iteration 33 — "actuaciones sin estados" as a first-class signal.
 */
import { describe, it, expect } from "vitest";
import {
  actIsFijacionEstado,
  estadosSignalAlerts,
  estadosSignalNorm,
  estadosSignalTone,
  ESTADOS_SIGNAL_LABEL,
  ESTADOS_SIGNAL_EXPLANATION,
  type EstadosSignalClass,
} from "@/lib/estados-coverage-signal";
import { providerChainFor } from "@/lib/monitoring-matrix";

const CLASSES: EstadosSignalClass[] = [
  "CUBIERTO",
  "ESTADOS_ESPERADOS_AUSENTES",
  "ESTADOS_SIN_FIJACION_CONOCIDA",
  "SIN_COBERTURA_DECLARADA",
];

describe("estados signal — fijación detection mirrors SQL", () => {
  it("normalises accents and case like estados_signal_norm", () => {
    expect(estadosSignalNorm("FIJACIÓN EN ESTADO")).toBe("fijacion en estado");
  });

  it.each([
    "Fijacion Estado",
    "FIJACIÓN EN ESTADO Nº 123",
    "Se fija en estado la providencia — fijacion",
  ])("detects %s", (text) => {
    expect(actIsFijacionEstado(text, null)).toBe(true);
  });

  it("uses description and act_type together", () => {
    expect(actIsFijacionEstado("fijacion", "Estado electrónico")).toBe(true);
  });

  it("does not fire on unrelated acts", () => {
    expect(actIsFijacionEstado("Auto admisorio de la demanda", "AUTO")).toBe(false);
    expect(actIsFijacionEstado("Estado del expediente", null)).toBe(false);
  });
});

describe("estados signal — only the first class alerts", () => {
  it("alerts on a recent unmatched fijación", () => {
    expect(estadosSignalAlerts({ signal_class: "ESTADOS_ESPERADOS_AUSENTES", recent_unmatched_count: 1 })).toBe(true);
  });

  it("stays silent when the anomaly is historical", () => {
    expect(estadosSignalAlerts({ signal_class: "ESTADOS_ESPERADOS_AUSENTES", recent_unmatched_count: 0 })).toBe(false);
  });

  it("never alerts on the inconclusive class", () => {
    expect(estadosSignalAlerts({ signal_class: "ESTADOS_SIN_FIJACION_CONOCIDA", recent_unmatched_count: 5 })).toBe(false);
  });

  it("never alerts on declared silence", () => {
    expect(estadosSignalAlerts({ signal_class: "SIN_COBERTURA_DECLARADA", recent_unmatched_count: 3 })).toBe(false);
  });

  it("never alerts when covered", () => {
    expect(estadosSignalAlerts({ signal_class: "CUBIERTO", recent_unmatched_count: 0 })).toBe(false);
  });
});

describe("estados signal — Spanish surface", () => {
  it.each(CLASSES)("has a label, an explanation and a tone for %s", (cls) => {
    expect(ESTADOS_SIGNAL_LABEL[cls]).toBeTruthy();
    expect(ESTADOS_SIGNAL_EXPLANATION[cls].length).toBeGreaterThan(20);
    expect(estadosSignalTone(cls)).toContain("text-");
  });
});

describe("estados signal — every monitored workflow has an estados provider", () => {
  it.each(["CGP", "CPACA", "TUTELA", "LABORAL", "PENAL_906", "EJECUTIVO"])(
    "%s routes to at least one estados provider",
    (wf) => {
      const chain = providerChainFor(wf);
      expect(chain.some((p) => p === "publicaciones" || p === "samai_estados")).toBe(true);
    },
  );

  it("TUTELA queries both estados providers (union)", () => {
    expect(providerChainFor("TUTELA")).toEqual(expect.arrayContaining(["publicaciones", "samai_estados"]));
  });
});
