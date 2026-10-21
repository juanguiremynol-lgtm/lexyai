/**
 * Civil (calendar) dates vs. timestamps.
 *
 * Judicial dates (act_date, fecha_fijacion, fecha_registro) are CALENDAR days.
 * Parsing "2026-10-20" with `new Date()` yields UTC midnight, which in Bogotá
 * (UTC-5) renders as 19 oct — the one-day shift. A civil date is read from its
 * own Y-M-D digits; only a real timestamp (with a time of day) is converted to
 * the Bogotá calendar day. Invalid or implausible values (e.g. 0131-10-01
 * sliced from a radicado, "sin-fecha") are "Fecha no informada" — never today.
 */
export const FECHA_NO_INFORMADA = 'Fecha no informada';

const MIN_YEAR = 2000;

function validYmd(y: number, m: number, d: number): boolean {
  if (y < MIN_YEAR || y > new Date().getUTCFullYear() + 1) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Returns the calendar day as YYYY-MM-DD, or null when not a valid date. */
export function civilDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (iso) {
    const [, y, m, d, hh, mi, ss, zone] = iso;
    if (!validYmd(+y, +m, +d)) return null;
    // Date-only, or a midnight/noon placeholder: the digits ARE the civil day.
    const placeholder = !hh || ((hh === '00' || hh === '12') && mi === '00' && (!ss || ss === '00'));
    if (placeholder || !zone) return `${y}-${m}-${d}`;
    const t = new Date(s);
    if (isNaN(t.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(t);
  }
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy && validYmd(+dmy[3], +dmy[2], +dmy[1])) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return null;
}

/** "20 oct 2026" for a valid civil date; otherwise the fallback label. */
export function formatCivilDate(value: unknown, fallback: string = FECHA_NO_INFORMADA): string {
  const day = civilDate(value);
  if (!day) return fallback;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** Newest first; rows without a valid date go last, deterministically. */
export function compareCivilDesc(a: unknown, b: unknown): number {
  const ad = civilDate(a);
  const bd = civilDate(b);
  if (ad && bd) return bd.localeCompare(ad);
  if (ad) return -1;
  if (bd) return 1;
  return 0;
}
