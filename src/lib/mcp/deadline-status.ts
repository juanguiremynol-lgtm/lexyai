/**
 * Canonical deadline status taxonomy shared by every consumer.
 *
 * AUDIT FINDING 6. The assistant filtered on `PENDING_REVIEW`, a value that
 * exists nowhere in the data: the 37 rows awaiting a human read are stored as
 * `REQUIERE_REVISION_MANUAL`, so the review queue was permanently invisible.
 * The mapping lives here so screen, assistant and email can never drift again.
 */

/** A live obligation the lawyer must act on. */
export const ACTIVE_STATUSES = ["PENDING"] as const;

/** Stored, but NOT an obligation: a human must read it first. */
export const MANUAL_REVIEW_STATUSES = [
  "REQUIERE_REVISION_MANUAL",
  "PENDING_REVIEW", // legacy spelling, kept so old rows stay visible
  "SUGGESTED_BY_PROVIDER",
  "CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR",
] as const;

/** Closed one way or another; never presented as pending. */
export const CLOSED_STATUSES = [
  "FULFILLED",
  "FULFILLED_BY_EMAIL_EVIDENCE",
  "DISMISSED",
  "CANCELLED",
  "INVALID_NO_TERM",
  "HISTORICAL_BACKFILL",
  "VENCIDO_ANTES_DEL_MOTOR",
  "VENCIDO_SIN_ACTUACION",
  "VENCIDO_RETRODETECTADO",
  "PRESUNCION_DESCARTADA_POR_AVANCE",
] as const;

export type DeadlineBucket = "ACTIVO" | "REVISION_MANUAL" | "CERRADO";

export function deadlineBucket(
  status: string | null | undefined,
  requiresManualReview?: boolean | null,
): DeadlineBucket {
  const s = String(status ?? "").toUpperCase();
  if (requiresManualReview) return "REVISION_MANUAL";
  if ((MANUAL_REVIEW_STATUSES as readonly string[]).includes(s)) return "REVISION_MANUAL";
  if ((ACTIVE_STATUSES as readonly string[]).includes(s)) return "ACTIVO";
  return "CERRADO";
}

/**
 * Who the term binds. Uncertainty is stated, never resolved: a term with no
 * recorded party is `DESCONOCIDO`, not "the client's".
 */
export function deadlineAttribution(row: {
  bound_party_role?: string | null;
  is_judge_side?: boolean | null;
}): "CLIENTE" | "CONTRAPARTE" | "DESPACHO" | "DESCONOCIDO" {
  if (row.is_judge_side) return "DESPACHO";
  const r = String(row.bound_party_role ?? "").toUpperCase();
  if (!r) return "DESCONOCIDO";
  if (r.includes("CLIENT") || r.includes("PROPIO") || r.includes("MANDANTE")) return "CLIENTE";
  if (r.includes("CONTRAPART") || r.includes("OPPOS") || r.includes("DEMANDAD") || r.includes("DEMANDANT")) {
    return "CONTRAPARTE";
  }
  return "DESCONOCIDO";
}

/**
 * AUDIT FINDING 7. Urgency is decided by the CALENDAR date, not by the
 * business-day countdown: on a Saturday, a term that expired on Friday yields a
 * countdown of zero business days and was reported as "vence hoy". The business
 * day count stays, as a count.
 */
export function deadlineUrgency(
  deadlineDate: string | null,
  today: string,
  businessDaysRemaining: number | null,
): "SIN_FECHA" | "VENCIDO" | "VENCE_HOY" | "CRITICO" | "PROXIMO" | "NORMAL" {
  if (!deadlineDate) return "SIN_FECHA";
  if (deadlineDate < today) return "VENCIDO";
  if (deadlineDate === today) return "VENCE_HOY";
  if (businessDaysRemaining == null) return "NORMAL";
  if (businessDaysRemaining <= 2) return "CRITICO";
  if (businessDaysRemaining <= 5) return "PROXIMO";
  return "NORMAL";
}
