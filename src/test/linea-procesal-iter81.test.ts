import { describe, it, expect } from "vitest";
import {
  deadlineOccurredAt,
  formatDeadlineLabel,
  isDerivedDate,
} from "@/lib/deadline-labels";
import { mapStageToCanonicalPhase, inferPhaseFromText } from "@/lib/workflow-phases";

describe("iteration 8.1 — deadline rendering", () => {
  it("sorts a deadline by its procedural trigger_date, not by updated_at", () => {
    const old = {
      trigger_date: "2024-10-25",
      deadline_date: "2024-11-26",
      created_at: "2026-08-01T10:00:00Z",
      updated_at: "2026-08-01T16:00:00Z",
    };
    const recent = { trigger_date: "2026-07-16", deadline_date: "2026-07-23", created_at: "2026-07-16T00:00:00Z" };
    expect(deadlineOccurredAt(old)).toBe("2024-10-25");
    const sorted = [old, recent].sort((a, b) =>
      (deadlineOccurredAt(a) ?? "") < (deadlineOccurredAt(b) ?? "") ? 1 : -1,
    );
    expect(sorted[0]).toBe(recent);
    expect(deadlineOccurredAt(old)!.startsWith("2024")).toBe(true);
  });

  it("renders human Spanish labels instead of debug arrow strings", () => {
    expect(formatDeadlineLabel("TRASLADO_DEMANDA", "TRASLADO → TRASLADO_DEMANDA")).toBe("Traslado de la demanda");
    expect(formatDeadlineLabel("EXCEPCIONES_EJECUTIVO", "EXCEPCIONES → EXCEPCIONES_EJECUTIVO")).toBe(
      "Traslado de excepciones",
    );
    expect(formatDeadlineLabel("RESPUESTA_NOTIFICACION", "NOTIFICACION")).toBe("Respuesta a notificación");
    expect(formatDeadlineLabel("TIPO_DESCONOCIDO", null)).toBe("Tipo desconocido");
    expect(formatDeadlineLabel(null, "Fallo / sentencia (correo)")).toBe("Fallo / sentencia (correo)");
  });

  it("flags derived desfijación dates", () => {
    expect(isDerivedDate({ desfijacion_source: "DERIVED_NEXT_BUSINESS_DAY" })).toBe(true);
    expect(isDerivedDate({ desfijacion_source: "PROVIDER" })).toBe(false);
    expect(isDerivedDate(null)).toBe(false);
  });
});

describe("iteration 8.1 — phase resolution", () => {
  it("maps every production stage value to a canonical phase", () => {
    const prod: Array<[Parameters<typeof mapStageToCanonicalPhase>[0], string]> = [
      ["CGP", "RADICADO"], ["CGP", "RADICADO_CONFIRMED"], ["CGP", "SUBSANACION"], ["CGP", "AUTO_ADMISORIO"],
      ["CGP", "SANEAMIENTO"], ["CGP", "CUADERNO"], ["CGP", "ADMISION"], ["CGP", "CONTESTACION"],
      ["CGP", "NOTIFICACION"], ["CGP", "SENTENCIA"], ["CGP", "DRAFTED"],
      ["TUTELA", "TUTELA_ADMITIDA"], ["TUTELA", "TUTELA_RADICADA"], ["TUTELA", "FALLO_PRIMERA_INSTANCIA"],
      ["CPACA", "AUTO_ADMISORIO"], ["CPACA", "RECURSOS"], ["CPACA", "TRASLADO_EXCEPCIONES"],
      ["CPACA", "DEMANDA_RADICADA"], ["CPACA", "RADICADO"], ["CPACA", "ALEGATOS_SENTENCIA"],
      ["CPACA", "AUDIENCIA_PRUEBAS"],
      ["GOV_PROCEDURE", "REQUERIMIENTOS_TRASLADOS"],
      ["LABORAL", "AUDIENCIA_INICIAL"], ["LABORAL", "ADMISION_PENDIENTE"], ["LABORAL", "RADICACION"],
      ["PENAL_906", "SEGUNDA_INSTANCIA"],
    ];
    for (const [wf, stage] of prod) {
      expect(mapStageToCanonicalPhase(wf, stage), `${wf}/${stage}`).not.toBeNull();
    }
    expect(mapStageToCanonicalPhase("CGP", "SANEAMIENTO")).toBe("CONTESTACION");
  });

  it("infers a display phase from the latest procedural text", () => {
    expect(inferPhaseFromText("CGP", "Auto Pone En Conocimiento - Declara improcedente excepciones")).toBe(
      "CONTESTACION",
    );
    expect(inferPhaseFromText("CGP", "Sentencia de primera instancia")).toBe("SENTENCIA");
    expect(inferPhaseFromText("CGP", "Fijacion Estado")).toBeNull();
  });
});
