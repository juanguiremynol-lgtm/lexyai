/**
 * ITER43 — reserva sumarial (Ley 906) as a first-class state.
 *
 * A matter the provider marks `esPrivado: true` publishes nothing lawfully.
 * That silence must never be read as a coverage failure, and it is the only
 * penal situation where email becomes a substantive source.
 */
import { describe, it, expect } from "vitest";
import {
  isProcesoPrivado,
  MOTIVO_PROCESO_PRIVADO,
  CLASE_PROCESO_UNAVAILABLE,
} from "../../supabase/functions/_shared/claseProcesoContract.ts";
import {
  ESTADOS_SIGNAL_LABEL,
  ESTADOS_SIGNAL_EXPLANATION,
  estadosSignalAlerts,
  estadosSignalTone,
} from "@/lib/estados-coverage-signal";

describe("provider privacy detection", () => {
  it("reads the stated motivo verbatim", () => {
    expect(
      isProcesoPrivado({ motivo_ausencia: MOTIVO_PROCESO_PRIVADO, raw: null }),
    ).toBe(true);
  });

  it("reads the raw esPrivado flag", () => {
    expect(isProcesoPrivado({ motivo_ausencia: null, raw: { esPrivado: true } })).toBe(true);
  });

  it("never infers reserva from an empty response", () => {
    expect(isProcesoPrivado(CLASE_PROCESO_UNAVAILABLE)).toBe(false);
    expect(isProcesoPrivado({ motivo_ausencia: "PROVIDER_UNAVAILABLE", raw: {} })).toBe(false);
    expect(isProcesoPrivado(null)).toBe(false);
  });

  it("reverses as soon as the provider publishes", () => {
    expect(isProcesoPrivado({ motivo_ausencia: null, raw: { esPrivado: false } })).toBe(false);
  });
});

describe("COBERTURA_RESERVADA signal", () => {
  it("is labelled and explained in Spanish", () => {
    expect(ESTADOS_SIGNAL_LABEL.COBERTURA_RESERVADA).toBe("Reserva sumarial");
    expect(ESTADOS_SIGNAL_EXPLANATION.COBERTURA_RESERVADA).toContain("reserva sumarial");
    expect(estadosSignalTone("COBERTURA_RESERVADA")).toContain("slate");
  });

  it("never raises a coverage alert", () => {
    expect(
      estadosSignalAlerts({
        signal_class: "COBERTURA_RESERVADA",
        recent_unmatched_count: 9,
        alertable_unmatched_count: 9,
      }),
    ).toBe(false);
  });
});
