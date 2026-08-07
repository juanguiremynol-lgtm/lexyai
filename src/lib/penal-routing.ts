/**
 * penal-routing.ts — ITERATION 44.
 *
 * PENAL_906 cannot be derived from `clase_proceso`: for a matter under reserva
 * sumarial the class is null BY DESIGN, so any determinant built on the class
 * misroutes exactly the matters penal routing exists for.
 *
 * The determinant is therefore structural and provider-stated, in this order:
 *
 *   1. PROVIDER      — the provider names the jurisdiction/especialidad
 *                      (e.g. "PENAL", "Ley 906") in the ficha it does publish
 *                      even when the substance is reserved.
 *   2. CUI           — Consejo Superior de la Judicatura's 23-digit CUI encodes
 *                      the especialidad in positions 6–7 (0-indexed 5–6);
 *                      `60` is penal. Verified on
 *                      08001600125720253122600 → "60" at 5..7.
 *   3. DESPACHO      — the despacho name says "Penal" / "Conocimiento".
 *   4. USER          — the lawyer declares it. Always allowed, always wins.
 *
 * This module only PROPOSES. Writing workflow_type from a provider signal stays
 * suggestion-only for PENAL_906 (GUARD B in claseProcesoWriter).
 */

export type PenalDeterminant = "PROVIDER" | "CUI" | "DESPACHO" | "USER" | "NONE";

export interface PenalRoutingSignal {
  isPenal: boolean;
  determinant: PenalDeterminant;
  /** Spanish, user-facing. Explains WHY, never just WHAT. */
  reason: string;
}

const NONE: PenalRoutingSignal = {
  isPenal: false,
  determinant: "NONE",
  reason: "Sin determinante penal: ni el proveedor, ni el CUI, ni el despacho lo indican.",
};

/** Especialidad segment of a 23-digit CUI (positions 6–7, 1-indexed). */
export function cuiEspecialidad(radicado: string | null | undefined): string | null {
  const digits = (radicado ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(5, 7);
}

export function isPenalCui(radicado: string | null | undefined): boolean {
  return cuiEspecialidad(radicado) === "60";
}

export function derivePenalRouting(input: {
  radicado?: string | null;
  despacho?: string | null;
  /** Provider-stated especialidad / jurisdicción, verbatim. */
  providerEspecialidad?: string | null;
  /** An explicit user declaration always wins. */
  userDeclared?: boolean | null;
}): PenalRoutingSignal {
  if (input.userDeclared === true) {
    return { isPenal: true, determinant: "USER", reason: "Declarado por el usuario." };
  }

  const esp = (input.providerEspecialidad ?? "").toUpperCase();
  if (esp.includes("PENAL") || esp.includes("906")) {
    return {
      isPenal: true,
      determinant: "PROVIDER",
      reason: `El proveedor declara la especialidad «${input.providerEspecialidad}».`,
    };
  }

  if (isPenalCui(input.radicado)) {
    return {
      isPenal: true,
      determinant: "CUI",
      reason: "El CUI marca especialidad 60 (penal) en las posiciones 6–7.",
    };
  }

  const desp = (input.despacho ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (desp.includes("PENAL")) {
    return {
      isPenal: true,
      determinant: "DESPACHO",
      reason: "El nombre del despacho indica jurisdicción penal.",
    };
  }

  return NONE;
}
