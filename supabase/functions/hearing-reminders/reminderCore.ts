// deno-lint-ignore-file no-explicit-any
/**
 * Pure helpers for hearing-reminders: per-user milestones, Bogotá calendar-day
 * distance, one live alert per hearing with escalation history, and the
 * calendar action block for the reminder email. No I/O beyond the store port.
 */
import { CAL_TZ } from "../_shared/calendarExport.ts";

/**
 * Default when profiles.hearing_reminder_days is null/invalid: [1, 3, 7] —
 * identical to the column default ('[1, 3, 7]'::jsonb) and to the initial
 * selection of HearingReminderSettings. Saved preferences are never rewritten.
 */
export const DEFAULT_HEARING_REMINDER_DAYS = [1, 3, 7];
/** Values offered by HearingReminderSettings. */
export const SUPPORTED_HEARING_REMINDER_DAYS = [0, 1, 2, 3, 5, 7, 14];

export function normalizeReminderDays(raw: unknown): number[] {
  let v: unknown = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  if (!Array.isArray(v)) return [...DEFAULT_HEARING_REMINDER_DAYS];
  const days = Array.from(new Set(v.map(Number)))
    .filter((n) => Number.isInteger(n) && SUPPORTED_HEARING_REMINDER_DAYS.includes(n))
    .sort((a, b) => a - b);
  // An explicitly saved empty list means "no reminders"; garbage falls back to default.
  if (days.length === 0 && v.length > 0) return [...DEFAULT_HEARING_REMINDER_DAYS];
  return days;
}

/** Calendar date (YYYY-MM-DD) of an instant in America/Bogota. */
export function bogotaDate(instant: Date | string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-CA", { timeZone: CAL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Whole calendar days between today and the hearing, both read in Bogotá. */
export function daysUntilBogota(scheduledAt: string, now: Date = new Date()): number {
  const a = Date.parse(bogotaDate(now) + "T00:00:00Z");
  const b = Date.parse(bogotaDate(scheduledAt) + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/** UTC instant at which today's Bogotá day starts (UTC-5, no DST). */
export function bogotaDayStartIso(now: Date = new Date()): string {
  return new Date(Date.parse(bogotaDate(now) + "T05:00:00Z")).toISOString();
}

export function reminderSeverity(days: number): "CRITICAL" | "WARNING" | "INFO" {
  return days === 0 ? "CRITICAL" : days <= 1 ? "WARNING" : "INFO";
}
export function reminderLabel(days: number): string {
  return days === 0 ? "HOY" : days === 1 ? "MAÑANA" : `en ${days} días`;
}

export const HEARING_ALERT_LIVE = ["PENDING", "SENT", "ACKNOWLEDGED"];
export const hearingFingerprint = (hearingId: string) => `hearing_REM_${hearingId}`;

export interface HearingAlertStore {
  findByHearing(hearingId: string): Promise<any[]>;
  insert(row: Record<string, unknown>): Promise<{ message: string; code?: string } | null>;
  update(id: string, patch: Record<string, unknown>): Promise<{ message: string } | null>;
}

/** One live HEARING_REMINDER per hearing; each milestone updates it and appends history. */
export async function upsertHearingAlert(db: HearingAlertStore, a: {
  hearingId: string; ownerId: string; organizationId: string | null; daysUntil: number;
  title: string; message: string; scheduledAt: string;
}, now: Date = new Date()): Promise<"inserted" | "updated" | "unchanged" | "closed" | "error"> {
  const all = await db.findByHearing(a.hearingId);
  const live = all.filter((r) => HEARING_ALERT_LIVE.includes(r.status));
  const severity = reminderSeverity(a.daysUntil);
  const entry = { at: now.toISOString(), days_until: a.daysUntil, severity };
  if (live.length === 0) {
    // Dismissed/resolved by the user for this same scheduled time: do not resurrect.
    if (all.some((r) => ["RESOLVED", "DISMISSED"].includes(r.status) && r.payload?.scheduled_at === a.scheduledAt)) return "closed";
    const err = await db.insert({
      owner_id: a.ownerId, organization_id: a.organizationId, entity_type: "HEARING", entity_id: a.hearingId,
      severity, status: "PENDING", alert_type: "HEARING_REMINDER", alert_source: "hearing-reminders",
      title: a.title, message: a.message, fingerprint: hearingFingerprint(a.hearingId), fired_at: now.toISOString(),
      payload: { hearing_id: a.hearingId, days_until: a.daysUntil, scheduled_at: a.scheduledAt, escalation_history: [entry] },
    });
    if (err) return (err.code === "23505" || /duplicate/.test(err.message)) ? "unchanged" : "error";
    return "inserted";
  }
  const keep = live[0];
  const hist = Array.isArray(keep.payload?.escalation_history) ? keep.payload.escalation_history : [];
  if (keep.payload?.days_until === a.daysUntil && keep.payload?.scheduled_at === a.scheduledAt) return "unchanged";
  const err = await db.update(keep.id, {
    severity, title: a.title, message: a.message, fired_at: now.toISOString(), read_at: null,
    payload: { hearing_id: a.hearingId, days_until: a.daysUntil, scheduled_at: a.scheduledAt,
      escalation_history: [...hist, entry].slice(-10) },
  });
  for (const extra of live.slice(1)) await db.update(extra.id, { status: "SUPERSEDED" });
  return err ? "error" : "updated";
}

export interface CalendarLinkSet { ics: string; google: string; outlook: string }
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Email block: .ics primary, Google / Outlook secondary. Never creates an external event. */
export function calendarActionsHtml(l: CalendarLinkSet | null): string {
  if (!l) return "";
  return `<div style="margin:16px 0;">
    <a href="${escAttr(l.ics)}" style="display:inline-block;background:#1e3a5f;color:#ffffff;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">Añadir al calendario (.ics)</a>
    <div style="margin-top:6px;font-size:12px;color:#6b7280;">
      <a href="${escAttr(l.google)}" style="color:#2563eb;">Google Calendar</a> ·
      <a href="${escAttr(l.outlook)}" style="color:#2563eb;">Outlook</a>
    </div>
  </div>`;
}
