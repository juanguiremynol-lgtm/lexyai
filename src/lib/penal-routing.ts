/**
 * penal-routing.ts — ITERATION 46 (was 44; priority inverted).
 *
 * PENAL_906 cannot be derived from `clase_proceso`: for a matter under reserva
 * sumarial the class is null BY DESIGN, so any determinant built on the class
 * misroutes exactly the matters penal routing exists for.
 *
 * ITER46 inverts the order. The provider-stated especialidad is a free-text
 * field that is frequently absent, abbreviated, or simply not published for the
 * very matters we care about — and when the matter is marked PROCESO_PRIVADO
 * there is no ficha to read at all. The CUI, by contrast, is assigned by the
 * Consejo Superior de la Judicatura at radicación, is present in every radicado
 * we hold, and cannot be withheld by a privacy mark. The structural identifier
 * therefore outranks the narrative one:
 *
 *   1. USER          — the lawyer declares it. Always allowed, always wins.
 *   2. CUI           — the 23-digit CUI encodes the especialidad in positions
 *                      6–7 (0-indexed 5–6); `60` is penal. Verified on
 *                      08001600125720253122600 → "60" at 5..7. Deterministic,
 *                      and available even when the detail is not exposed.
 *   3. PROVIDER      — the provider names the jurisdiction/especialidad
 *                      (e.g. "PENAL", "Ley 906") in the ficha, when it has one.
 *   4. DESPACHO      — the despacho name says "Penal" / "Conocimiento". Weakest:
 *                      a name is a label, not an assignment.
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

  // CUI first: asignado por el Consejo Superior de la Judicatura y presente
  // incluso cuando el proveedor marca el proceso como privado.
  if (isPenalCui(input.radicado)) {
    return {
      isPenal: true,
      determinant: "CUI",
      reason: "El CUI marca especialidad 60 (penal) en las posiciones 6–7.",
    };
  }

  const esp = (input.providerEspecialidad ?? "").toUpperCase();
  if (esp.includes("PENAL") || esp.includes("906")) {
    return {
      isPenal: true,
      determinant: "PROVIDER",
      reason: `El proveedor declara la especialidad «${input.providerEspecialidad}».`,
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
