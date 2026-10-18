import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildAnexosInventario,
  compareOrigins,
  extractActOrigin,
  originFromRow,
  planEnrichment,
  resolveActIdentity,
  type CandidateRow,
} from "./actOriginIdentity.ts";
import { normalizeSamaiActuaciones } from "./providerAdapters/samaiAdapter.ts";
import { canonicalActFingerprint } from "./canonicalFingerprint.ts";

// Verbatim SAMAI read-api texts (2026-10-18 read-only probe).
const A = "El Señor(a):JHON HERLINZON RINCON MAZABEL con vinculación al proceso: ApodDdo - Policía Nacional, a través de la ventanilla virtual, radicó la solicitud No. 3435550 tipo: Recepción de Memoriales de fecha: 16/10/2026 16:12:08, donde solicitó: Presentación de memorial o escrito Radicado: 05001233300020260142400 Vinculación: ApodDdo Documentos anexos: 6 . Se realiza la siguiente gestión: OPOSICION MEDIDA CAUTELAR - 6 archivos";
const B = "El Señor(a):ELKIN YESID SALAZAR ECHEVERRI con vinculación al proceso: ApodDdo - MUNCIPIO DE LA CEJA DEL TAMBO, a través de la ventanilla virtual, radicó la solicitud No. 3432736 tipo: Recepción de Memoriales de fecha: 16/10/2026 10:46:42, donde solicitó: Presentación de memorial o escrito Radicado: 05001233300020260142400 Vinculación: ApodDdo Documentos anexos: 2 . Se realiza la siguiente gestión: Pronunciamiento frente a la solicitud de medidas cautelares - 2 archivos";
const C = "El Señor(a):OSCAR NICOLAS PEÑA RUIZ con vinculación al proceso: Ddo, a través de la ventanilla virtual, radicó la solicitud No. 3433923 tipo: Recepción de Memoriales de fecha: 16/10/2026 12:59:34, donde solicitó: Presentación de memorial o escrito Radicado: 05001233300020240115300 Vinculación: Ddo Documentos anexos: 1 . Se realiza la siguiente gestión: OposiciOn a medidas cautelares - 1 archivo";
const TITLE = "RECIBE MEMORIALES ONLINE";
const WI = "8fac310f-357c-4d65-8e07-97c723a24e3e";

Deno.test("fixture lengths match the review (A=426 < B=473)", () => {
  assertEquals(A.length, 426);
  assertEquals(B.length, 473);
});

// ─────────────── origin ───────────────

Deno.test("origin: extracts solicitud and radicación timestamp", () => {
  const o = extractActOrigin({ anotacion: A });
  assertEquals(o.solicitud, "3435550");
  assertEquals(o.radicada_en, "16/10/2026 16:12:08");
});

Deno.test("origin: A vs B conflict; later indice on same solicitud is equivalent", () => {
  assertEquals(compareOrigins(extractActOrigin({ anotacion: A }), extractActOrigin({ anotacion: B })), "conflict");
  assertEquals(
    compareOrigins(extractActOrigin({ anotacion: B }), extractActOrigin({ anotacion: B, indice: 133 })),
    "equivalent",
  );
});

Deno.test("origin: stored row reads protected description, not contaminated anotacion", () => {
  const o = originFromRow({ description: `${TITLE} - ${A}`, raw_data: { anotacion: B } });
  assertEquals(o.solicitud, "3435550");
});

// ─────────────── in-memory sync harness ───────────────
// Mirrors sync-by-work-item's act loop: provider payload → SAMAI normalizer →
// canonical v1 fingerprint → resolveActIdentity → planEnrichment / insert.
// The DB upsert RPC is replaced by an array; everything else is production code.

interface StoredRow extends CandidateRow { event_summary: string }

function syncOnce(store: StoredRow[], payload: Array<Record<string, unknown>>) {
  const counts = { inserted: 0, matched: 0, healed: 0 };
  const acts = normalizeSamaiActuaciones(payload);
  for (const act of acts) {
    const v1 = canonicalActFingerprint({ work_item_id: WI, act_date: act.fecha_actuacion, actuacion: act.actuacion, party_hint: null });
    const semanticKey = `${act.fecha_actuacion}|${act.actuacion.toUpperCase().trim()}||00`;
    const incoming = extractActOrigin({ indice: act.indice, anotacion: act.anotacion });
    const d = resolveActIdentity({ v1, semanticKey, incoming, rows: store });
    if (d.kind === "match") {
      const plan = planEnrichment(d.row, {
        actuacion: act.actuacion, anotacion: act.anotacion, anexos: act.anexos_count, indice: act.indice, documentos: null,
      }, d.relation, "2026-10-18T00:00:00Z");
      if (plan) {
        d.row.raw_data = plan.raw_data;
        if (plan.event_summary) (d.row as StoredRow).event_summary = plan.event_summary;
        if (plan.healed_contamination) counts.healed++;
      }
      counts.matched++;
      continue;
    }
    const description = `${act.actuacion} - ${act.anotacion}`;
    store.push({
      id: `row${store.length + 1}`,
      hash_fingerprint: d.fingerprint,
      semantic_key: semanticKey,
      description,
      event_summary: description.slice(0, 500),
      raw_data: {
        anotacion: act.anotacion,
        origen_indice: incoming.indice, origen_solicitud: incoming.solicitud, origen_radicada_en: incoming.radicada_en,
        anexos_inventario: buildAnexosInventario({ anexos: act.anexos_count, anotacion: act.anotacion }),
      },
    });
    counts.inserted++;
  }
  return counts;
}

const item = (text: string, indice?: number) => ({
  "Fecha Providencia": "2026-10-16T00:00:00.000Z", "Actuación": TITLE, "Docum. a notif.": text,
  url_descarga: null, pdf_url: null, anexos: null, ...(indice !== undefined ? { indice } : {}),
});

Deno.test("sync: A+B same day → 2 rows; second sync → 0 inserts, no mixing", () => {
  const store: StoredRow[] = [];
  assertEquals(syncOnce(store, [item(A), item(B)]).inserted, 2);
  assertEquals(syncOnce(store, [item(A), item(B)]), { inserted: 0, matched: 2, healed: 0 });
  assertEquals(store.length, 2);
  for (const r of store) {
    const own = originFromRow(r).solicitud;
    assertEquals(extractActOrigin({ anotacion: r.raw_data!.anotacion }).solicitud, own);
    assert(r.event_summary.includes(own!));
  }
});

Deno.test("sync: indice appearing later keeps both fingerprints, no duplicate", () => {
  const store: StoredRow[] = [];
  syncOnce(store, [item(A), item(B)]);
  const before = store.map((r) => r.hash_fingerprint);
  const c = syncOnce(store, [item(A, 132), item(B, 133)]);
  assertEquals(c.inserted, 0);
  assertEquals(store.map((r) => r.hash_fingerprint), before);
  assertEquals(store.find((r) => originFromRow(r).solicitud === "3432736")!.raw_data!.origen_indice, "133");
  // and a third sync with indice still stable
  assertEquals(syncOnce(store, [item(B, 133), item(A, 132)]).inserted, 0);
});

Deno.test("sync: inverted order B then A → same 2 acts, no duplicates on resync", () => {
  const store: StoredRow[] = [];
  syncOnce(store, [item(B)]);
  syncOnce(store, [item(A)]);
  assertEquals(store.length, 2);
  assertEquals(syncOnce(store, [item(A, 132), item(B, 133)]).inserted, 0);
  assertEquals(syncOnce(store, [item(B), item(A)]).inserted, 0);
  assertEquals(store.length, 2);
});

Deno.test("sync: contaminated real row f148bbab (desc A, anotacion B) is healed despite A shorter", () => {
  const v1 = canonicalActFingerprint({ work_item_id: WI, act_date: "2026-10-16", actuacion: TITLE, party_hint: null });
  const store: StoredRow[] = [{
    id: "f148bbab", hash_fingerprint: v1, semantic_key: `2026-10-16|${TITLE}||00`,
    description: `${TITLE} - ${A}`, event_summary: `${TITLE} - ${B}`.slice(0, 500),
    raw_data: { actuacion: TITLE, anotacion: B },
  }];
  const c = syncOnce(store, [item(A), item(B)]);
  assertEquals(c.healed, 1);
  assertEquals(c.inserted, 1); // B becomes its own row
  const f = store.find((r) => r.id === "f148bbab")!;
  assertEquals(f.raw_data!.anotacion, A);
  assertEquals((f.raw_data!.anotacion_reparada as any).anterior, B);
  assert(f.event_summary.includes("3435550"));
  assertEquals(store[1].hash_fingerprint!.startsWith(`${v1}_o`), true);
  assertEquals(syncOnce(store, [item(B), item(A)]), { inserted: 0, matched: 2, healed: 0 });
});

Deno.test("sync: legacy row without origin still dedups (no new duplicates)", () => {
  const store: StoredRow[] = [];
  const p = [{ "Fecha Providencia": "2026-10-05", "Actuación": "AUTO TRASLADO", "Docum. a notif.": "Auto traslado de 5 dias" }];
  syncOnce(store, p);
  assertEquals(syncOnce(store, p).inserted, 0);
});

Deno.test("enrichment runs even when anotación does not grow", () => {
  const row: CandidateRow = { id: "x", hash_fingerprint: "f", description: `${TITLE} - ${C}`, raw_data: { anotacion: C } };
  const plan = planEnrichment(row, { actuacion: TITLE, anotacion: C, anexos: null, indice: 132, documentos: null }, "equivalent");
  assert(plan);
  assertEquals(plan!.raw_data.origen_indice, "132");
  assertEquals((plan!.raw_data.anexos_inventario as any).anunciados, 1);
  assertEquals(plan!.anotacion_grew, false);
});

// ─────────────── inventory ───────────────

Deno.test("inventory: announced, no links, no attempt → desconocido (not no_consultado/sin_anexos)", () => {
  const inv = buildAnexosInventario({ anexos: null, anotacion: C });
  assertEquals(inv.estado, "desconocido");
  assertEquals(inv.anunciados, 1);
});

Deno.test("inventory: restricted/session/error only from a recorded attempt", () => {
  assertEquals(buildAnexosInventario({ anotacion: A, attempt: { status: "restricted", at: "t" } }).estado, "restringido");
  assertEquals(buildAnexosInventario({ anotacion: A, attempt: { status: "session_required", at: "t" } }).estado, "sesion_requerida");
  assertEquals(buildAnexosInventario({ anotacion: A, attempt: { status: "error", at: "t", detail: "HTTP 500" } }).estado, "error");
});

Deno.test("inventory: explicit 0 is sin_anexos; null is not", () => {
  assertEquals(buildAnexosInventario({ anexos: 0 }).estado, "sin_anexos");
  assertEquals(buildAnexosInventario({ anexos: null }).estado, "desconocido");
});

Deno.test("inventory: a URL is never 'disponible' at ingestion", () => {
  const inv = buildAnexosInventario({ anotacion: A, documentos: [{ gcs_url: "https://storage.googleapis.com/b/x.pdf" }] });
  assertEquals(inv.estado, "enlaces_sin_verificar");
  assertEquals(inv.enlaces_registrados, 1);
  assertEquals(inv.anunciados, 6);
});

// ─────────────── SAMAI normalizer ───────────────

Deno.test("samai normalizer: anexos 0 and null stay distinct", () => {
  const [zero, nul, absent] = normalizeSamaiActuaciones([
    { "Fecha Providencia": "2026-10-16", "Actuación": "X", anexos: 0 },
    { "Fecha Providencia": "2026-10-16", "Actuación": "Y", anexos: null },
    { "Fecha Providencia": "2026-10-16", "Actuación": "Z" },
  ]);
  assertEquals(zero.anexos_count, 0);
  assertEquals(nul.anexos_count, undefined);
  assertEquals(absent.anexos_count, undefined);
});

Deno.test("samai normalizer: null URL fields stay not-observed", () => {
  const [n] = normalizeSamaiActuaciones([item(A)]);
  assertEquals((n as any).documentos, undefined);
});

Deno.test("samai normalizer: a real provider URL becomes a descriptor", () => {
  const [n] = normalizeSamaiActuaciones([{ "Fecha Providencia": "2026-10-16", "Actuación": "AUTO", gcs_url: "https://storage.googleapis.com/b/x.pdf" }]);
  assertEquals((n as any).documentos[0].gcs_url, "https://storage.googleapis.com/b/x.pdf");
});
