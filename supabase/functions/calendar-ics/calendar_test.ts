// Pure tests: no database, no network, no external calendar.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildIcs, googleCalendarUrl, hearingEvent, outlookCalendarUrl, termEvent,
} from "../_shared/calendarExport.ts";
import { type CalendarStore, resolveIcs } from "./handler.ts";

const APP = "https://andromeda.legal";
const NOW = new Date("2026-10-01T12:00:00Z");
const term = { id: "d1", work_item_id: "w1", status: "PENDING", deadline_date: "2026-10-15", label: "Contestación", radicado: "0500140030012026", despacho: "Juzgado 1 Civil" };
const hearing = { id: "h1", work_item_id: "w1", scheduled_at: "2026-10-06T14:00:00Z", status: "scheduled", title: "Audiencia inicial" };

Deno.test("term → all-day event in Google / Outlook / .ics", () => {
  const ev = termEvent(term, APP)!;
  const ics = buildIcs(ev, NOW);
  assertStringIncludes(ics, "DTSTART;VALUE=DATE:20261015");
  assertStringIncludes(ics, "DTEND;VALUE=DATE:20261016");
  assertStringIncludes(ics, "UID:andromeda-term-d1@andromeda.legal");
  assertStringIncludes(ics, `URL:${APP}/app/work-items/w1`);
  assertStringIncludes(googleCalendarUrl(ev), "dates=20261015%2F20261016");
  const o = outlookCalendarUrl(ev);
  assertStringIncludes(o, "allday=true");
  assertStringIncludes(o, "startdt=2026-10-15");
});

Deno.test("hearing → timed event in America/Bogota, 60 min presentation length", () => {
  const ev = hearingEvent(hearing, APP)!;
  const ics = buildIcs(ev, NOW);
  assertStringIncludes(ics, "TZID:America/Bogota");
  assertStringIncludes(ics, "DTSTART;TZID=America/Bogota:20261006T090000");
  assertStringIncludes(ics, "DTEND;TZID=America/Bogota:20261006T100000");
  assertStringIncludes(googleCalendarUrl(ev), "ctz=America%2FBogota");
  assertStringIncludes(googleCalendarUrl(ev), "20261006T090000%2F20261006T100000");
});

Deno.test("manual review, no date, dateless hearing marker, cancelled hearing → no event", () => {
  assertEquals(termEvent({ ...term, status: "REQUIERE_REVISION_MANUAL" }, APP), null);
  assertEquals(termEvent({ ...term, deadline_date: null }, APP), null);
  assertEquals(hearingEvent({ ...hearing, scheduled_at: null, status: "planned" }, APP), null);
  assertEquals(hearingEvent({ ...hearing, status: "cancelled" }, APP), null);
  assertEquals(hearingEvent({ ...hearing, status: "held" }, APP), null);
});

Deno.test("UID stable across runs and dates", () => {
  const a = termEvent(term, APP)!.uid;
  const b = termEvent({ ...term, deadline_date: "2026-10-20" }, APP)!.uid;
  assertEquals(a, b);
  assertEquals(hearingEvent(hearing, APP)!.uid, hearingEvent({ ...hearing, scheduled_at: "2026-10-07T15:00:00Z" }, APP)!.uid);
});

function store(over: Partial<Record<string, any>> = {}): CalendarStore {
  const tok = { token: "a".repeat(48), kind: "TERM", entity_id: "d1", work_item_id: "w1", owner_id: "ownerA", expires_at: "2026-10-30T00:00:00Z", ...over.tok };
  return {
    token: async (t) => (t === tok.token ? tok : null),
    workItem: async () => over.wi ?? { id: "w1", owner_id: "ownerA", radicado: "R", authority_name: "J" },
    term: async () => over.term ?? { ...term },
    hearing: async () => over.hearing ?? { ...hearing, custom_name: "Audiencia inicial" },
    bump: async () => {},
  };
}

Deno.test("calendar-ics contract: 200 / 403 other tenant / 410 expired / 404", async () => {
  const T = "a".repeat(48);
  const ok = await resolveIcs(T, store(), NOW);
  assertEquals(ok.status, 200);
  assertStringIncludes(ok.body, "BEGIN:VCALENDAR");
  assertEquals((await resolveIcs(T, store({ wi: { id: "w1", owner_id: "ownerB" } }), NOW)).status, 403);
  assertEquals((await resolveIcs(T, store({ term: { ...term, work_item_id: "wOther" } }), NOW)).status, 403);
  assertEquals((await resolveIcs(T, store({ tok: { expires_at: "2026-09-01T00:00:00Z" } }), NOW)).status, 410);
  assertEquals((await resolveIcs("b".repeat(48), store(), NOW)).status, 404);
  assertEquals((await resolveIcs("short", store(), NOW)).status, 404);
  assertEquals((await resolveIcs(T, store({ term: { ...term, status: "REQUIERE_REVISION_MANUAL", deadline_date: null } }), NOW)).status, 404);
  const h = await resolveIcs(T, store({ tok: { kind: "HEARING", entity_id: "h1" } }), NOW);
  assertEquals(h.status, 200);
  assert(h.body.includes("TZID=America/Bogota"));
});
