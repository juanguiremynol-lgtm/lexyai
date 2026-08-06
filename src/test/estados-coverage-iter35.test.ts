import { describe, it, expect } from "vitest";
import {
  ESTADOS_SIGNAL_LABEL,
  ESTADOS_SIGNAL_EXPLANATION,
  estadosSignalTone,
  estadosSignalAlerts,
  isWithinCoverageWindow,
  actIsRemisionExpediente,
  actIsFijacionEstado,
  type EstadosSignalClass,
  type CoverageWindow,
} from "@/lib/estados-coverage-signal";
import { DOCTRINE_TYPE_LABELS } from "@/lib/alerts/doctrine";

const ALL: EstadosSignalClass[] = [
  "CUBIERTO",
  "ESTADOS_ESPERADOS_AUSENTES",
  "ESTADOS_SIN_FIJACION_CONOCIDA",
  "SIN_COBERTURA_DECLARADA",
  "SIN_COBERTURA_EN_ESA_FECHA",
  "ESTADO_SIN_DOCUMENTO",
  "REMITIDO_A_SUPERIOR",
];

describe("iter35 · coverage edge confidence", () => {
  const censored: CoverageWindow = {
    publishes_from: "2024-05-15",
    publishes_until: "2026-04-30",
    from_confidence: "CENSORED",
    until_confidence: "CENSORED",
  };
  const genuine: CoverageWindow = {
    publishes_from: "2024-05-15",
    publishes_until: "2026-04-30",
    from_confidence: "GENUINE",
    until_confidence: "GENUINE",
  };

  it("a censored left edge never silences an earlier fijación", () => {
    expect(isWithinCoverageWindow("2023-01-10", censored)).toBe(true);
  });

  it("a censored right edge never silences a later fijación", () => {
    expect(isWithinCoverageWindow("2026-07-31", censored)).toBe(true);
  });

  it("a genuine edge does silence dates outside it", () => {
    expect(isWithinCoverageWindow("2023-01-10", genuine)).toBe(false);
    expect(isWithinCoverageWindow("2026-07-31", genuine)).toBe(false);
    expect(isWithinCoverageWindow("2025-06-01", genuine)).toBe(true);
  });

  it("NEVER_PUBLISHED silences everything", () => {
    expect(isWithinCoverageWindow("2025-06-01", { from_confidence: "NEVER_PUBLISHED" })).toBe(false);
  });

  it("defaults to covered when confidence is unknown", () => {
    expect(isWithinCoverageWindow("2023-01-10", { publishes_from: "2024-05-15" })).toBe(true);
    expect(isWithinCoverageWindow("2025-01-01", null)).toBe(true);
  });

  it("membership inside the window is not proof: an empty month is source silence", () => {
    const w: CoverageWindow = {
      publishes_from: "2025-01-01",
      publishes_until: "2026-01-01",
      from_confidence: "GENUINE",
      until_confidence: "GENUINE",
      monthly_presence: { "2025-03": 12, "2025-05": 4 },
    };
    expect(isWithinCoverageWindow("2025-03-10", w)).toBe(true);
    expect(isWithinCoverageWindow("2025-04-10", w)).toBe(false);
  });

  it("does not infer zero for a month omitted by the authoritative census", () => {
    expect(isWithinCoverageWindow("2025-04-10", {
      monthly_presence: { "2025-03": 12, "2025-05": 4 },
    })).toBe(true);
  });
});

describe("iter35 · remisión detector", () => {
  it("recognises the live remisión wordings", () => {
    expect(actIsRemisionExpediente("Auto Declara Incompetente - Falta De Competencia - Remite por competencia")).toBe(true);
    expect(actIsRemisionExpediente("Salida Finalizando Instancia - EN LA FECHA SE REMITE DEMANDA RECHAZADA")).toBe(true);
    expect(actIsRemisionExpediente("Envio A Superior Por Interpuestos Sin Finalizacion")).toBe(true);
    expect(actIsRemisionExpediente("No reponer el auto atacado - Disponer la remisión de copia al superior")).toBe(true);
    expect(actIsRemisionExpediente("ENVÍO A OTROS DESPACHOS")).toBe(true);
    expect(actIsRemisionExpediente("Remisión expediente")).toBe(true);
  });

  it("does not fire on ordinary acts", () => {
    expect(actIsRemisionExpediente("Fijación Estado")).toBe(false);
    expect(actIsRemisionExpediente("Constancia Secretarial - se remite link")).toBe(false);
    expect(actIsRemisionExpediente(null, null)).toBe(false);
  });

  it("stays disjoint from the fijación predicate", () => {
    expect(actIsFijacionEstado("Fijación Estado")).toBe(true);
    expect(actIsRemisionExpediente("Fijación Estado")).toBe(false);
  });
});

describe("iter35 · signal taxonomy", () => {
  it("labels and explains every class, including the new one", () => {
    for (const c of ALL) {
      expect(ESTADOS_SIGNAL_LABEL[c]).toBeTruthy();
      expect(ESTADOS_SIGNAL_EXPLANATION[c].length).toBeGreaterThan(30);
      expect(estadosSignalTone(c)).toContain("text-");
    }
  });

  it("a remitted matter is never an anomaly", () => {
    expect(
      estadosSignalAlerts({ signal_class: "REMITIDO_A_SUPERIOR", recent_unmatched_count: 3, alertable_unmatched_count: 3 }),
    ).toBe(false);
  });

  it("still alerts on genuine, reachable orphans", () => {
    expect(
      estadosSignalAlerts({ signal_class: "ESTADOS_ESPERADOS_AUSENTES", recent_unmatched_count: 2, alertable_unmatched_count: 2 }),
    ).toBe(true);
  });

  it("registers the remisión alert type so it is never silently dropped", () => {
    expect(DOCTRINE_TYPE_LABELS.REMISION_EXPEDIENTE).toBe("Remisión de expediente");
  });
});
