import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bogotaDayStartIso, calendarActionsHtml, daysUntilBogota, DEFAULT_HEARING_REMINDER_DAYS, normalizeReminderDays, upsertHearingAlert,
} from "./reminderCore.ts";
import { googleCalendarUrl, hearingEvent, outlookCalendarUrl } from "../_shared/calendarExport.ts";

Deno.test("perfil [1,7] => solo 1 y 7; default documentado [1,3,7]", () => {
  const days = normalizeReminderDays([1, 7]);
  assertEquals(days, [1, 7]);
  for (const d of [0, 2, 3, 5, 14]) assert(!days.includes(d));
  assertEquals(DEFAULT_HEARING_REMINDER_DAYS, [1, 3, 7]);
  assertEquals(normalizeReminderDays(null), [1, 3, 7]);
  assertEquals(normalizeReminderDays("[0,1,2,3,5,7]"), [0, 1, 2, 3, 5, 7]);
  assertEquals(normalizeReminderDays([]), []);
});

Deno.test("diferencia en fechas de Bogotá cerca de medianoche UTC", () => {
  // 02:30 UTC 2 Oct = 21:30 Bogotá 1 Oct. Hearing 09:00 Bogotá 2 Oct (14:00 UTC).
  const now = new Date("2026-10-02T02:30:00Z");
  assertEquals(daysUntilBogota("2026-10-02T14:00:00Z", now), 1); // UTC-midnight math would say 0
  // Hearing 20:00 Bogotá 1 Oct = 01:00 UTC 2 Oct: same Bogotá day => 0
  assertEquals(daysUntilBogota("2026-10-02T01:00:00Z", new Date("2026-10-01T15:00:00Z")), 0);
  assertEquals(bogotaDayStartIso(now), "2026-10-01T05:00:00.000Z");
});

Deno.test("dos hitos => 1 alert_instance con historial; misma corrida repetida no duplica", async () => {
  const rows: any[] = [];
  const db = {
    findByHearing: async () => rows,
    insert: async (r: any) => { rows.push({ id: `a${rows.length}`, ...r }); return null; },
    update: async (id: string, p: any) => { Object.assign(rows.find((r) => r.id === id), p); return null; },
  };
  const base = { hearingId: "h1", ownerId: "o", organizationId: "org", title: "t", message: "m", scheduledAt: "2026-10-23T14:00:00Z" };
  assertEquals(await upsertHearingAlert(db, { ...base, daysUntil: 7 }), "inserted");
  assertEquals(await upsertHearingAlert(db, { ...base, daysUntil: 7 }), "unchanged");
  assertEquals(await upsertHearingAlert(db, { ...base, daysUntil: 1 }), "updated");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].fingerprint, "hearing_REM_h1");
  assertEquals(rows[0].severity, "WARNING");
  assertEquals(rows[0].payload.escalation_history.map((e: any) => e.days_until), [7, 1]);
});

Deno.test("sin doble registro user-facing: no hay inserción en la tabla legacy alerts", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(!/from\("alerts"\)/.test(src));
  assert(!src.includes("hearing_rem_${"), "no per-day fingerprint");
  assert(!src.includes("[0, 1, 3, 7]"), "no hardcoded milestones");
});

Deno.test("email: .ics principal + Google/Outlook; dry run no inserta nada", async () => {
  const ev = hearingEvent({ id: "h1", work_item_id: "w1", scheduled_at: "2026-10-23T14:00:00Z", status: "scheduled", title: "Audiencia inicial", radicado: "05001" }, "https://andromeda.legal")!;
  const html = calendarActionsHtml({ ics: "https://x/functions/v1/calendar-ics?t=TOK", google: googleCalendarUrl(ev), outlook: outlookCalendarUrl(ev) });
  assertStringIncludes(html, "Añadir al calendario (.ics)");
  assertStringIncludes(html, "calendar-ics?t=TOK");
  assertStringIncludes(html, "calendar.google.com");
  assertStringIncludes(html, "outlook.office.com");
  assertEquals(calendarActionsHtml(null), "");
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const dry = src.indexOf("continue; // dry run");
  assert(dry > 0 && dry < src.indexOf('from("calendar_event_tokens").insert') && dry < src.indexOf('from("email_outbox")\n          .insert'));
  assert(src.includes("if (!dryRun) {\n        const outcome = await upsertHearingAlert"), "alert upsert skipped in dry run");
});
