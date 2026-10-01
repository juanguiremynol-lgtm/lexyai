// Pure local render with fixtures: no server, no database, no email, no external events.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDigestHtml } from "./html.ts";
import { googleCalendarUrl, hearingEvent, outlookCalendarUrl, termEvent } from "../_shared/calendarExport.ts";

const APP = "https://andromeda.legal";
const workItems = new Map<string, any>([
  ["wP", { radicado: "05001400300120260000100", title: "P" }],
  ["wM", { radicado: "05001400300120260000200", title: "M" }],
  ["wH", { radicado: "05001400300120260000300", title: "H" }],
]);
const pending = {
  id: "11111111-1111-1111-1111-111111111111", work_item_id: "wP", label: "Contestación de la demanda",
  deadline_type: "CONTESTACION_DEMANDA", deadline_date: "2026-10-15", status: "PENDING",
  overdue: false, days_left: 5, attribution: "PROPIO", bound_party_role: "DEMANDADO",
};
const hearing = {
  id: "22222222-2222-2222-2222-222222222222", work_item_id: "wH", title: "Audiencia inicial",
  scheduled_at: "2026-10-06T14:00:00Z", location: null, is_virtual: false, virtual_link: null, status: "scheduled",
};
const manual = { id: "33333333-3333-3333-3333-333333333333", work_item_id: "wM", label: "Revisión X", deadline_type: "X" };

function base(over: Record<string, unknown>): any {
  return {
    recipientName: "Prueba", windowFrom: "2026-09-29T12:00:00Z", windowTo: "2026-09-30T12:00:00Z",
    monitoredCount: 3, nonJudicialCount: 0, silentCount: 0, actuaciones: [], estados: [], hearings: [], hearingsBeyond: [],
    stats: { procesosConNovedad: 0, publicaciones: 0, cpnu: 0, samai: 0, erroresFuente: 0 },
    deadlines: [], nonJudicialDeadlines: [], unverifiedTerms: [], importedHistory: [], reconciliations: [],
    manualReviewTerms: [], connectionIssues: [], autoPaused: [], sourceQuality: [], coverageIncomplete: false,
    coverageExceptions: [], coveragePersistence: [], coverageWindowFrom: "2026-09-29T12:00:00Z",
    coverageWindowTo: "2026-09-30T12:00:00Z", windowLabel: "martes", neverRead: [], workItems,
    appBaseUrl: APP, linkExpiryDays: 30, ...over,
  };
}

function linksFor(): Map<string, any> {
  // Mirrors index.ts: links only for eligible events.
  const m = new Map<string, any>();
  for (const d of [pending, { ...manual, status: "REQUIERE_REVISION_MANUAL", deadline_date: null }] as any[]) {
    const ev = termEvent(d, APP);
    if (ev) m.set(`T:${d.id}`, { ics: `https://x/calendar-ics?t=T${d.id}`, google: googleCalendarUrl(ev), outlook: outlookCalendarUrl(ev) });
  }
  const ev = hearingEvent(hearing, APP);
  if (ev) m.set(`H:${hearing.id}`, { ics: `https://x/calendar-ics?t=H${hearing.id}`, google: googleCalendarUrl(ev), outlook: outlookCalendarUrl(ev) });
  return m;
}

Deno.test("1 PENDING + 1 manual review + 1 hearing: only PENDING and hearing get calendar actions", async () => {
  const calendarLinks = linksFor();
  assertEquals(calendarLinks.size, 2);
  const html = buildDigestHtml(base({ deadlines: [pending], hearings: [hearing], manualReviewTerms: [manual], calendarLinks }));
  await Deno.writeTextFile("/tmp/digest_calendar_fixture.html", html);
  const icsCount = (html.match(/Añadir al calendario \(\.ics\)/g) ?? []).length;
  assertEquals(icsCount, 2);
  assertStringIncludes(html, `calendar-ics?t=T${pending.id}`);
  assertStringIncludes(html, `calendar-ics?t=H${hearing.id}`);
  assert(!html.includes(manual.id), "manual review has no calendar link");
  assertStringIncludes(html, "TÉRMINOS EN REVISIÓN MANUAL (1) — clasificación o cómputo pendientes de validación");
  assertStringIncludes(html, "Sin fecha validada");
  assertStringIncludes(html, "andromeda.legal%2Fapp%2Fwork-items%2FwP");
  for (const bad of ["revise el auto", "confirme la calidad de su cliente", "lectura del auto"]) {
    assert(!html.toLowerCase().includes(bad), bad);
  }
});

Deno.test("hearing beyond 7 days also carries the .ics button", () => {
  const calendarLinks = linksFor();
  const html = buildDigestHtml(base({ hearingsBeyond: [hearing], calendarLinks }));
  assertStringIncludes(html, `calendar-ics?t=H${hearing.id}`);
});

Deno.test("0 PENDING + 42 manual reviews: none shown as due/overdue, no calendar actions", () => {
  const reviews = Array.from({ length: 42 }, (_, i) => ({ id: `r${i}`, work_item_id: "wM", label: `R${i}`, deadline_type: "X" }));
  const html = buildDigestHtml(base({ manualReviewTerms: reviews, manualReviewTotal: 42, calendarLinks: new Map() }));
  assertStringIncludes(html, "TÉRMINOS EN REVISIÓN MANUAL (42)");
  assert(!/[Vv]encido hace|[Ff]altan \d+ día|POR VENCER|VENCIDOS —/.test(html), "no due/overdue presentation");
  assert(!html.includes("Añadir al calendario"), "no calendar action");
});

Deno.test("42 antiguas sin cambio => solo contador compacto, sin filas, sin contenido propio", () => {
  const html = buildDigestHtml(base({ manualReviewTerms: [], manualReviewTotal: 42, manualReviewChangedTotal: 0, calendarLinks: new Map() }));
  assertStringIncludes(html, "42 pendientes de validación");
  assertStringIncludes(html, "/app/hearings");
  assertStringIncludes(html, "Estos registros no se presentan como términos activos ni vencidos mientras Andromeda no cuente con evidencia suficiente para validar su clasificación, ancla y fecha de vencimiento.");
  assert(!html.includes("Nuevas o modificadas"), "no table");
  assert(!/<td[^>]*>R\d/.test(html));
  assert(!digestHasContent({ rowCount: 0, manualReviewCount: 0, coverageIncomplete: false }), "backlog alone is not new content");
  assert(!/[Vv]encido hace|CRÍTICO|POR VENCER|VENCIDOS —/.test(html));
});

Deno.test("2 nuevas => 2 filas + total 42, sin fechas ni urgencia", () => {
  const two = [{ id: "n1", work_item_id: "wM", label: "Nueva1", deadline_type: "X" }, { id: "n2", work_item_id: "wM", label: "Nueva2", deadline_type: "X" }];
  const html = buildDigestHtml(base({ manualReviewTerms: two, manualReviewTotal: 42, manualReviewChangedTotal: 2, calendarLinks: new Map() }));
  assertStringIncludes(html, "TÉRMINOS EN REVISIÓN MANUAL (42)");
  assertStringIncludes(html, "Nuevas o modificadas en este periodo: 2");
  assertEquals((html.match(/Sin fecha validada<\/span>/g) ?? []).length, 2);
  assert(digestHasContent({ rowCount: 0, manualReviewCount: 2, coverageIncomplete: false }));
  assert(!/[Vv]encido hace|CRÍTICO|POR VENCER|VENCIDOS —|Añadir al calendario/.test(html));
});
