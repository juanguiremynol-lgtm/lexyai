/**
 * Term urgency taxonomy (iteration 52).
 *
 * A term alert must tell the litigator whether he has three days, eight days
 * or has already missed it. There is no generic term alert: the three-value
 * doctrine catalogue IS the severity, and collapsing it loses the point.
 *
 * Mirrored by `supabase/functions/evaluate-deadline-alerts` (edge runtime
 * cannot import from `src/`), and asserted identical by the test suite.
 */
export const TERM_ALERT_TYPES = [
  "TERMINO_CRITICO",
  "TERMINO_POR_VENCER",
  "TERMINO_VENCIDO",
] as const;

export type TermAlertType = (typeof TERM_ALERT_TYPES)[number];

export interface TermUrgency {
  alert_type: TermAlertType;
  severity: "WARNING" | "CRITICAL";
}

/**
 * @param businessDaysRemaining negative = already past due, null = the term's
 *   length could not be resolved (provisional, warn without asserting a miss).
 */
export function classifyTermUrgency(businessDaysRemaining: number | null): TermUrgency {
  if (businessDaysRemaining === null)
    return { alert_type: "TERMINO_POR_VENCER", severity: "WARNING" };
  if (businessDaysRemaining < 0) return { alert_type: "TERMINO_VENCIDO", severity: "CRITICAL" };
  if (businessDaysRemaining <= 3) return { alert_type: "TERMINO_CRITICO", severity: "CRITICAL" };
  return { alert_type: "TERMINO_POR_VENCER", severity: "WARNING" };
}

export function isTermAlertType(v: unknown): v is TermAlertType {
  return typeof v === "string" && (TERM_ALERT_TYPES as readonly string[]).includes(v);
}
