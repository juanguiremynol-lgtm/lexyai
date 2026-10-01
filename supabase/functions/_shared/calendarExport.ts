/**
 * calendarExport — pure helpers for "Añadir al calendario".
 * Mirrored verbatim in src/lib/calendar-export.ts (keep both identical).
 *
 * Eligibility (never relaxed here):
 *   - term:    status === "PENDING" and a non-null deadline_date (YYYY-MM-DD)
 *   - hearing: non-null scheduled_at and a live status
 * Manual-review terms and dateless hearing markers never produce an event.
 */

export const CAL_TZ = "America/Bogota";
export const PRESENTATION_HEARING_MINUTES = 60; // display length only, not judicial data

/** CalendarEventSpec — typed event shared by .ics, Google and Outlook builders. */
export type CalendarEventSpec = CalendarEvent;
export interface CalendarEvent {
  uid: string;
  kind: "TERM" | "HEARING";
  title: string;
  description: string;
  url: string;
  location?: string | null;
  /** all-day: YYYY-MM-DD; timed: ISO instant */
  allDay: boolean;
  start: string;
  end: string;
}

const LIVE_HEARING = new Set(["scheduled", "planned", "rescheduled", "confirmed", ""]);

export interface TermInput {
  id: string; work_item_id: string; status: string; deadline_date: string | null;
  label?: string | null; deadline_type?: string | null;
  radicado?: string | null; despacho?: string | null;
}
export interface HearingInput {
  id: string; work_item_id: string | null; scheduled_at: string | null; status?: string | null;
  title?: string | null; radicado?: string | null; despacho?: string | null;
  location?: string | null; duration_minutes?: number | null;
}

function addDaysIso(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return t.toISOString().slice(0, 10);
}

export function termEvent(t: TermInput, appBaseUrl: string): CalendarEvent | null {
  if (t.status !== "PENDING") return null;
  if (!t.deadline_date || !/^\d{4}-\d{2}-\d{2}$/.test(t.deadline_date)) return null;
  const what = t.label || t.deadline_type || "Término";
  const url = `${appBaseUrl}/app/work-items/${t.work_item_id}`;
  return {
    uid: `andromeda-deadline-${t.id}@andromeda.legal`,
    kind: "TERM",
    title: `Vence: ${what}${t.radicado ? ` — ${t.radicado}` : ""}`,
    description: [
      `Término: ${what}`,
      t.radicado ? `Radicado: ${t.radicado}` : null,
      t.despacho ? `Despacho: ${t.despacho}` : null,
      `Abrir en Andromeda: ${url}`,
    ].filter(Boolean).join("\n"),
    url,
    allDay: true,
    start: t.deadline_date,
    end: addDaysIso(t.deadline_date, 1),
  };
}

export function hearingEvent(h: HearingInput, appBaseUrl: string): CalendarEvent | null {
  if (!h.scheduled_at) return null;
  const st = String(h.status ?? "").toLowerCase();
  if (!LIVE_HEARING.has(st)) return null;
  const start = new Date(h.scheduled_at);
  if (isNaN(start.getTime())) return null;
  const mins = h.duration_minutes && h.duration_minutes > 0 ? h.duration_minutes : PRESENTATION_HEARING_MINUTES;
  const end = new Date(start.getTime() + mins * 60_000);
  const what = h.title || "Audiencia";
  const url = h.work_item_id ? `${appBaseUrl}/app/work-items/${h.work_item_id}` : `${appBaseUrl}/app/hearings`;
  return {
    uid: `andromeda-hearing-${h.id}@andromeda.legal`,
    kind: "HEARING",
    title: `Audiencia: ${what}${h.radicado ? ` — ${h.radicado}` : ""}`,
    description: [
      `Audiencia: ${what}`,
      h.radicado ? `Radicado: ${h.radicado}` : null,
      h.despacho ? `Despacho: ${h.despacho}` : null,
      h.duration_minutes && h.duration_minutes > 0 ? null
        : `Duración no registrada: se usan ${PRESENTATION_HEARING_MINUTES} min solo para mostrar el evento; no es un dato judicial.`,
      `Abrir en Andromeda: ${url}`,
    ].filter(Boolean).join("\n"),
    url,
    location: h.location ?? null,
    allDay: false,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

const compactDate = (d: string) => d.replace(/-/g, "");
const compactUtc = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Wall-clock time in Bogotá (UTC-5, no DST) as YYYYMMDDTHHMMSS. */
export function bogotaLocal(iso: string): string {
  const t = new Date(new Date(iso).getTime() - 5 * 3600_000).toISOString();
  return compactUtc(t).replace("Z", "");
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = " " + rest.slice(74); }
  out.push(rest);
  return out.join("\r\n");
}

export function buildIcs(ev: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Andromeda//Calendario//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${CAL_TZ}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0500",
    "TZNAME:-05",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${compactUtc(now.toISOString())}`,
    ev.allDay ? `DTSTART;VALUE=DATE:${compactDate(ev.start)}` : `DTSTART;TZID=${CAL_TZ}:${bogotaLocal(ev.start)}`,
    ev.allDay ? `DTEND;VALUE=DATE:${compactDate(ev.end)}` : `DTEND;TZID=${CAL_TZ}:${bogotaLocal(ev.end)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    `DESCRIPTION:${icsEscape(ev.description)}`,
    `URL:${ev.url}`,
    ...(ev.location ? [`LOCATION:${icsEscape(ev.location)}`] : []),
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  const dates = ev.allDay
    ? `${compactDate(ev.start)}/${compactDate(ev.end)}`
    : `${bogotaLocal(ev.start)}/${bogotaLocal(ev.end)}`;
  const q = new URLSearchParams({
    action: "TEMPLATE", text: ev.title, dates, details: ev.description, ctz: CAL_TZ,
  });
  if (ev.location) q.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function outlookCalendarUrl(ev: CalendarEvent): string {
  const q = new URLSearchParams({
    path: "/calendar/action/compose", rru: "addevent", subject: ev.title, body: ev.description,
  });
  if (ev.allDay) {
    q.set("startdt", ev.start); q.set("enddt", ev.end); q.set("allday", "true");
  } else {
    q.set("startdt", ev.start); q.set("enddt", ev.end);
  }
  if (ev.location) q.set("location", ev.location);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${q.toString()}`;
}

export function icsFileName(ev: CalendarEvent): string {
  return `${ev.kind === "TERM" ? "termino" : "audiencia"}-${ev.uid.split("@")[0].split("-").pop()}.ics`;
}
