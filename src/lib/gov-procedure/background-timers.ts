/**
 * TypeScript mirror of the caducidad / recurso background-timer arithmetic.
 *
 * These terms are expressed in YEARS, so they are CALENDAR terms: they never
 * pass through the business-day walk or the holiday calendar. The SQL side
 * (`public.gov_caducidad_anchor` + `evaluate_gov_procedure_background_timers`)
 * uses the same rules; this module exists so the rules are assertable.
 */

export interface CaducidadAnchorInput {
  factDate: string | null;
  cessationDate: string | null;
  conductaContinuada: boolean;
}

/**
 * CPACA art. 52: three years from the fact; for a continuing conduct, from the
 * day FOLLOWING the cessation. A missing anchor yields null — never an invented
 * date; the caller records a constancia instead.
 */
export function caducidadAnchor(input: CaducidadAnchorInput): string | null {
  if (input.conductaContinuada) {
    if (!input.cessationDate) return null;
    return addCalendarDays(input.cessationDate, 1);
  }
  return input.factDate ?? null;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addCalendarYears(isoDate: string, years: number): string {
  const [y, m, day] = isoDate.split("-").map(Number);
  return `${String(y + years).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const CADUCIDAD_YEARS = 3;
export const RECURSO_DECISION_YEARS = 1;

/** The caducidad is satisfied only by NOTIFICATION of the sanctioning act. */
export function caducidadSatisfied(input: {
  notifiedAt: string | null;
  issuedAt: string | null;
  deadlineDate: string;
}): { satisfied: boolean; legalEffect: string | null } {
  if (!input.notifiedAt) return { satisfied: false, legalEffect: null };
  return {
    satisfied: true,
    legalEffect:
      input.notifiedAt <= input.deadlineDate
        ? "FACULTAD_EJERCIDA_EN_TERMINO"
        : "NOTIFICACION_POSTERIOR_A_LA_CADUCIDAD",
  };
}
