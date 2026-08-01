/**
 * Recency Classifier — canonical NOVEDAD vs HISTORICO_DETECTADO semantics.
 *
 * Used by Lexy, alerts, badges and any summary generated on this side.
 *
 *   NOVEDAD               — first detection AND legal date within the recency window.
 *   ACTUACION_RETROACTIVA — first detection in a NORMAL daily run but the legal
 *                           date is OUTSIDE the window: the court registered the
 *                           act late. This is NEWS, not backfill.
 *   HISTORICO_DETECTADO   — first detection during an explicit sweep / import /
 *                           deep re-scan: genuine historical backfill.
 *
 * Legal dates:
 *   - actuación → act_date
 *   - estado    → fecha_fijacion (or fecha_desfijacion when fijacion missing)
 *   - hearing   → the scheduling act's act_date
 *
 * Ingestion/discovery time (created_at / detected_at) is OPERATIONAL and
 * MUST NOT be shown to users as a legal date.
 */

export type DiscoveryType = "NOVEDAD" | "ACTUACION_RETROACTIVA" | "HISTORICO_DETECTADO";

/** Discovery types that must be counted as news in reports, alerts and badges. */
export const NEWS_DISCOVERY_TYPES: DiscoveryType[] = ["NOVEDAD", "ACTUACION_RETROACTIVA"];

/** Run modes that mean "explicit historical backfill" (never news). */
export const SWEEP_RUN_MODES = ["SWEEP", "FULL_SWEEP", "HISTORICAL", "BACKFILL", "IMPORT"];

export function isSweepRunMode(runMode: string | null | undefined): boolean {
  return SWEEP_RUN_MODES.includes(String(runMode ?? "DAILY").toUpperCase());
}

export interface RecencyInput {
  legal_date: string | Date | null | undefined; // fecha jurídica
  detected_at: string | Date; // ingestion timestamp (created_at)
  window_business_days?: number; // default 3
  /** Explicit sweep/backfill run. Defaults to false (normal daily sync). */
  is_sweep?: boolean;
  run_mode?: string | null;
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
 *
 * An old legal date is only historical when it arrived through an explicit
 * sweep. In a normal daily run it is a retroactive registration = news.
 */
export function classifyRecency(input: RecencyInput): DiscoveryType {
  const windowDays = input.window_business_days ?? 3;
  const now = input.now ?? new Date();
  const sweep = input.is_sweep ?? isSweepRunMode(input.run_mode);
  if (!input.legal_date) return "HISTORICO_DETECTADO";
  const legal = new Date(input.legal_date as string | Date);
  if (isNaN(legal.getTime())) return "HISTORICO_DETECTADO";
  const diff = businessDaysBetween(legal, now);
  if (diff <= windowDays) return "NOVEDAD";
  return sweep ? "HISTORICO_DETECTADO" : "ACTUACION_RETROACTIVA";
}

/** Business-day gap between the legal date and its detection. */
export function retroGapDays(
  legalDate: string | Date | null | undefined,
  detectedAt: string | Date,
): number | null {
  if (!legalDate) return null;
  // Date-only strings are legal calendar dates (Bogotá), not UTC instants.
  const isDateOnly = typeof legalDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(legalDate);
  const legal = isDateOnly
    ? new Date(`${legalDate}T00:00:00.000Z`)
    : new Date(legalDate as string | Date);
  const detected = new Date(detectedAt as string | Date);
  if (isNaN(legal.getTime()) || isNaN(detected.getTime())) return null;
  const legalDay = isDateOnly ? legal : toBogotaDate(legal);
  return Math.max(0, Math.round((toBogotaDate(detected).getTime() - legalDay.getTime()) / 86400000));
}
