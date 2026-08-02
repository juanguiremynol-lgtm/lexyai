import { describe, it, expect } from "vitest";
import {
  groupAlertsByType,
  isActionableSeverity,
  isDoctrineAlertType,
  alertTypeLabel,
  FALLBACK_ALERT_TYPE,
} from "@/lib/alerts/doctrine";

describe("iteration 10 — alert doctrine", () => {
  it("only accepts the allowed catalogue as doctrine types", () => {
    expect(isDoctrineAlertType("TERMINO_CRITICO")).toBe(true);
    expect(isDoctrineAlertType("ACTUACION_RETROACTIVA")).toBe(true);
    expect(isDoctrineAlertType("ACTUACION_NUEVA")).toBe(false);
    expect(isDoctrineAlertType("ESTADO_NUEVO")).toBe(false);
    expect(isDoctrineAlertType(null)).toBe(false);
  });

  it("treats only WARNING and CRITICAL as actionable", () => {
    expect(isActionableSeverity("CRITICAL")).toBe(true);
    expect(isActionableSeverity("WARNING")).toBe(true);
    expect(isActionableSeverity("INFO")).toBe(false);
    expect(isActionableSeverity(undefined)).toBe(false);
  });

  it("never produces an undefined bucket for untyped rows", () => {
    const groups = groupAlertsByType([
      { id: "1", alert_type: null, severity: "WARNING" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe(FALLBACK_ALERT_TYPE);
    expect(groups[0].label).toBe("Sin clasificar");
  });

  it("groups by type with counts and urgency ordering", () => {
    const groups = groupAlertsByType([
      { id: "a", alert_type: "SUGERENCIA_PENDIENTE", severity: "WARNING" },
      { id: "b", alert_type: "TERMINO_VENCIDO", severity: "CRITICAL" },
      { id: "c", alert_type: "SUGERENCIA_PENDIENTE", severity: "WARNING" },
      { id: "d", alert_type: "ACTUACION_CRITICA", severity: "CRITICAL" },
    ]);
    expect(groups.map((g) => g.type)).toEqual([
      "TERMINO_VENCIDO",
      "ACTUACION_CRITICA",
      "SUGERENCIA_PENDIENTE",
    ]);
    expect(groups[2].count).toBe(2);
    expect(groups[0].criticalCount).toBe(1);
  });

  it("labels every doctrine type in Spanish", () => {
    expect(alertTypeLabel("HEARING_TODAY")).toBe("Audiencias de hoy");
    expect(alertTypeLabel("MONITOREO_SIN_INGESTA")).toBe("Monitoreo sin ingesta");
  });
});