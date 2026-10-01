// Pure local render of the final digest HTML with fixtures. Imports only the
// HTML builder: no server, no database, no email send.
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDigestHtml } from "./html.ts";
import { digestHasContent } from "./content.ts";
import { sourceGaps, describeSourceQuality } from "../_shared/sourceRunQuality.ts";

const cpnu = {
  source: "cpnu", label: "CPNU (actuaciones)", expected_count: 44, attempted_count: 44,
  answered_count: 43, usable_confirmed_count: 40, success_count: 3, success_empty_count: 37,
  not_found_count: 0, restricted_count: 3, restricted_matter_count: 3, pending_upstream_count: 0,
  error_count: 1, state: "SOURCE_DEGRADED_PARTIAL", authoritative: false, chain: ["CGP"],
};
const holds = [
  ["58ed4dd1-50ef-4528-9167-2cda2b294886", "w1", "05001233300020260142400", "Subsanación recibida — verificar auto y cómputo"],
  ["0834a576-fd82-48f6-8785-9b0738bef5a7", "w2", "05001400302320250063800", "Traslado de desistimiento — verificar destinatario y término"],
  ["d36aecee-c530-4216-9603-b3788c803843", "w3", "05001333301020240013900", "Auto sobre notificación de aseguradora — verificar órdenes de traslado"],
  ["658ba77a-cd0b-4cab-aa1c-28eaa0de5270", "w4", "05001333300320250013300", "Auto de trámite de sentencia anticipada; alegatos recibidos — no es apelación"],
];
const workItems = new Map(holds.map(([, w, rad]) => [w, { radicado: rad, title: rad } as any]));

const payload: any = {
  recipientName: "Prueba", windowFrom: "2026-09-29T12:00:00Z", windowTo: "2026-09-30T12:00:00Z",
  monitoredCount: 59, nonJudicialCount: 0, silentCount: 0,
  actuaciones: [], estados: [], hearings: [], hearingsBeyond: [],
  stats: { procesosConNovedad: 2, publicaciones: 0, cpnu: 0, samai: 3, erroresFuente: 0 },
  deadlines: [], nonJudicialDeadlines: [], unverifiedTerms: [], importedHistory: [], reconciliations: [],
  manualReviewTerms: holds.map(([id, w, , label]) => ({ id, work_item_id: w, label, deadline_type: "X" })),
  connectionIssues: [], autoPaused: [], sourceQuality: [cpnu], coverageIncomplete: true,
  coverageExceptions: [], coveragePersistence: [],
  coverageWindowFrom: "2026-09-29T12:00:00Z", coverageWindowTo: "2026-09-30T12:00:00Z",
  windowLabel: "martes 29 de septiembre", neverRead: [], workItems,
  appBaseUrl: "https://andromeda.legal", linkExpiryDays: 7,
};

Deno.test("CPNU 44/43/40 → 1 sin respuesta, 4 sin lectura confirmada", () => {
  const g = sourceGaps(cpnu as any);
  assert(g.sinRespuesta === 1 && g.sinLecturaConfirmada === 4, JSON.stringify(g));
  const s = describeSourceQuality(cpnu as any, 0);
  assertStringIncludes(s, "1 sin respuesta");
  assertStringIncludes(s, "4 sin lectura confirmada");
});

Deno.test("final HTML: four reviews visible, dateless, no forbidden phrases", async () => {
  const html = buildDigestHtml(payload);
  await Deno.writeTextFile("/tmp/digest_incident_fixture.html", html);
  assertStringIncludes(html, "TÉRMINOS EN REVISIÓN MANUAL (4)");
  for (const [, , rad, label] of holds) {
    assertStringIncludes(html, rad);
    assertStringIncludes(html, label.replace(/;/g, ";"));
  }
  assertStringIncludes(html, "1 asunto(s) sin respuesta");
  assertStringIncludes(html, "4 sin lectura confirmada");
  const lower = html.toLowerCase();
  for (const bad of ["despacho no alimenta", "sentencia programada", "13/10", "29/09/2026 vence", "05/10"]) {
    assert(!lower.includes(bad), `forbidden phrase present: ${bad}`);
  }
  assert(!/vencido hace/i.test(html), "no false overdue");
});

Deno.test("solo 4 revisiones + sin novedades + fuentes sanas → contenido y HTML visible", () => {
  const healthy = { ...cpnu, answered_count: 44, usable_confirmed_count: 44, restricted_count: 0, restricted_matter_count: 0, error_count: 0, state: "SOURCE_HEALTHY_COMPLETE", authoritative: true };
  const p = { ...payload, sourceQuality: [healthy], coverageIncomplete: false, stats: { procesosConNovedad: 0, publicaciones: 0, cpnu: 0, samai: 0, erroresFuente: 0 } };
  assert(digestHasContent({ rowCount: 0, manualReviewCount: p.manualReviewTerms.length, coverageIncomplete: false }));
  assert(!digestHasContent({ rowCount: 0, manualReviewCount: 0, coverageIncomplete: false }));
  const html = buildDigestHtml(p);
  assertStringIncludes(html, "TÉRMINOS EN REVISIÓN MANUAL (4)");
  for (const [, , rad] of holds) assertStringIncludes(html, rad);
});

Deno.test("revisiones truncadas declaran total y exceso", () => {
  const html = buildDigestHtml({ ...payload, manualReviewTotal: 57, manualReviewChangedTotal: 9 });
  assertStringIncludes(html, "TÉRMINOS EN REVISIÓN MANUAL (57)");
  assertStringIncludes(html, "Nuevas o modificadas en este periodo: 9 (se muestran 4; 5 más");
});
