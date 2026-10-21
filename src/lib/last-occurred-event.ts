/**
 * Last occurred event — derived from stored acts/estados, never from the
 * cached work_items.last_action_date projection (which can lag behind the
 * stored rows or be pushed forward by a future/scheduled provider date).
 *
 * Civil dates (YYYY-MM-DD) are compared as Bogotá calendar days; a date after
 * today is "programada", reported separately and never advances the cursor.
 */
export interface TimelineLike {
  occurred_at: string | null;
  kind: string;
  title: string;
}

export function bogotaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function civilDay(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : null;
}

export function splitOccurredAndScheduled(rows: TimelineLike[], now: Date = new Date()) {
  const today = bogotaToday(now);
  const dated = rows
    .map((r) => ({ r, day: r.occurred_at ? civilDay(r.occurred_at) : null }))
    .filter((x): x is { r: TimelineLike; day: string } => !!x.day);
  const occurred = dated.filter((x) => x.day <= today).sort((a, b) => b.day.localeCompare(a.day));
  const scheduled = dated.filter((x) => x.day > today).sort((a, b) => a.day.localeCompare(b.day));
  return {
    last: occurred[0] ? { day: occurred[0].day, kind: occurred[0].r.kind, title: occurred[0].r.title } : null,
    nextScheduled: scheduled[0] ? { day: scheduled[0].day, kind: scheduled[0].r.kind, title: scheduled[0].r.title } : null,
  };
}
