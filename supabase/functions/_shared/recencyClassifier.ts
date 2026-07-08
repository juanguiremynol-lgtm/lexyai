/**
 * Recency Classifier — canonical NOVEDAD vs HISTORICO_DETECTADO semantics.
 *
 * Used by Lexy, alerts, badges and any summary generated on this side.
 *
 *   NOVEDAD              — first detection AND legal date within the recency window.
 *   HISTORICO_DETECTADO  — first detection but legal date OUTSIDE the window
 *                          (i.e. surfaced by a backfill / deep re-scan).
 *
 * Legal dates:
 *   - actuación → act_date
 *   - estado    → fecha_fijacion (or fecha_desfijacion when fijacion missing)
 *   - hearing   → the scheduling act's act_date
 *
 * Ingestion/discovery time (created_at / detected_at) is OPERATIONAL and
 * MUST NOT be shown to users as a legal date.
 */

export type DiscoveryType = "NOVEDAD" | "HISTORICO_DETECTADO";

export interface RecencyInput {
  legal_date: string | Date | null | undefined; // fecha jurídica
  detected_at: string | Date; // ingestion timestamp (created_at)
  window_business_days?: number; // default 3
  now?: Date;
}

/** Bogotá offset in ms — fixed UTC-5 (no DST). */
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

function toBogotaDate(d: Date): Date {
  const shifted = new Date(d.getTime() + BOGOTA_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/** Business days between two Bogotá calendar dates (weekends only; holidays TBD). */
export function businessDaysBetween(from: Date, to: Date): number {
  const a = toBogotaDate(from);
  const b = toBogotaDate(to);
  if (b <= a) return 0;
  let count = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (!isWeekend(cur)) count++;
  }
  return count;
}

/**
 * Classify a newly detected row.
 *
 * A row without a legal_date defaults to HISTORICO_DETECTADO (safer — never
 * inflates "nuevos" counts).
 */
export function classifyRecency(input: RecencyInput): DiscoveryType {
  const windowDays = input.window_business_days ?? 3;
  const now = input.now ?? new Date();
  if (!input.legal_date) return "HISTORICO_DETECTADO";
  const legal = new Date(input.legal_date as string | Date);
  if (isNaN(legal.getTime())) return "HISTORICO_DETECTADO";
  const diff = businessDaysBetween(legal, now);
  return diff <= windowDays ? "NOVEDAD" : "HISTORICO_DETECTADO";
}
