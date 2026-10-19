import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ActDocState, ActLoadError, loadAllActiveActs, resolvePersistedAct } from "./actBatchState.ts";
import { resolveActIdentity, type CandidateRow } from "./actOriginIdentity.ts";
import { documentosEnrichmentPatch } from "./actDocumentos.ts";

// Minimal PostgREST-like fake: filters, order, range, maybeSingle, update, rpc.
interface Row { [k: string]: unknown }
function fakeClient(rows: Row[], opts: { failRangeAt?: number; failReadBack?: boolean; rpc?: (p: Row) => { data: unknown; error: unknown } } = {}) {
  const calls = { ranges: [] as number[], updates: [] as Array<{ id: string; patch: Row }> };
  const client = {
    from(_t: string) {
      const f: Array<[string, unknown]> = [];
      let rng: [number, number] | null = null;
      let lim: number | null = null;
      let patch: Row | null = null;
      const run = () => rows.filter((r) => f.every(([k, v]) => r[k] === v)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const q: any = {
        select() { return q; },
        eq(k: string, v: unknown) {
          f.push([k, v]);
          if (patch && k === "id") {
            const r = rows.find((x) => x.id === v);
            if (!r) return Promise.resolve({ error: { message: "invalid input syntax for type uuid" } });
            Object.assign(r, patch);
            calls.updates.push({ id: String(v), patch });
            return Promise.resolve({ error: null });
          }
          return q;
        },
        order() { return q; },
        limit(n: number) { lim = n; return q; },
        update(p: Row) { patch = p; return q; },
        range(a: number, b: number) {
          rng = [a, b];
          calls.ranges.push(a);
          if (opts.failRangeAt === a) return Promise.resolve({ data: null, error: { message: "statement timeout" } });
          return Promise.resolve({ data: run().slice(rng[0], rng[1] + 1), error: null });
        },
        maybeSingle() {
          if (opts.failReadBack) return Promise.resolve({ data: null, error: { message: "read-back failed" } });
          const r = run().slice(0, lim ?? 1)[0] ?? null;
          return Promise.resolve({ data: r ? { ...r } : null, error: null });
        },
      };
      return q;
    },
    rpc(_n: string, p: Row) { return Promise.resolve(opts.rpc!(p)); },
  };
  return { client, calls };
}

const WI = "wi-1";
const mk = (i: number): Row => ({ id: `id-${String(i).padStart(5, "0")}`, work_item_id: WI, is_archived: false, hash_fingerprint: `fp${i}` });

Deno.test("load: paginates until a short page (2500 rows = 3 pages)", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => mk(i));
  const { client, calls } = fakeClient(rows);
  const all = await loadAllActiveActs(client, WI);
  assertEquals(all.length, 2500);
  assertEquals(calls.ranges, [0, 1000, 2000]);
});

Deno.test("load: exact multiple of page size still terminates and is complete", async () => {
  const rows = Array.from({ length: 2000 }, (_, i) => mk(i));
  const { client } = fakeClient(rows);
  assertEquals((await loadAllActiveActs(client, WI)).length, 2000);
});

Deno.test("load: a failing page aborts explicitly (no partial identity set)", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => mk(i));
  const { client } = fakeClient(rows, { failRangeAt: 1000 });
  await assertRejects(() => loadAllActiveActs(client, WI), ActLoadError, "offset 1000");
});

Deno.test("load: exceeding the page cap fails instead of truncating", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => mk(i));
  const { client } = fakeClient(rows);
  await assertRejects(() => loadAllActiveActs(client, WI, 10, 2), ActLoadError, "refusing partial");
});

Deno.test("read-back: returns real UUID; null when absent; throws on error", async () => {
  const { client } = fakeClient([mk(1)]);
  assertEquals((await resolvePersistedAct(client, WI, "fp1"))?.id, "id-00001");
  assertEquals(await resolvePersistedAct(client, WI, "nope"), null);
  const bad = fakeClient([mk(1)], { failReadBack: true });
  await assertRejects(() => resolvePersistedAct(bad.client, WI, "fp1"), ActLoadError);
});

// ── Batch persistence flow: mirrors sync-by-work-item's insert/match branch
//    with the production helpers. The DB is a fake; see limits in the report.
async function runBatch(client: any, rows: Row[], acts: Array<{ fp: string; docs: unknown }>) {
  const known: CandidateRow[] = rows.map((r) => ({ id: String(r.id), hash_fingerprint: String(r.hash_fingerprint), description: null, raw_data: null }));
  const docState = new ActDocState();
  for (const r of rows) docState.set(String(r.id), { documentos: r.documentos ?? null, documentos_observados_en: null });
  const result = { inserted: 0, skipped: 0, errors: [] as string[], updatedIds: [] as string[] };
  for (const a of acts) {
    const d = resolveActIdentity({ v1: a.fp, semanticKey: null as any, incoming: { indice: null, solicitud: null, radicada_en: null, key: null } as any, rows: known });
    if (d.kind === "match") {
      const eff = docState.get(d.row.id);
      const patch = documentosEnrichmentPatch(eff.documentos, eff.documentos_observados_en, a.docs, null);
      if (patch) {
        const { error } = await client.from("work_item_acts").update(patch).eq("id", d.row.id);
        if (error) result.errors.push(error.message);
        else { docState.set(d.row.id, patch); result.updatedIds.push(d.row.id); }
      }
      result.skipped++;
      continue;
    }
    const { data, error } = await client.rpc("rpc_upsert_work_item_acts", { fp: d.fingerprint, docs: a.docs });
    if (error) { result.errors.push(error.message); continue; }
    const counts = data as { inserted_count: number; updated_count: number; error_count?: number };
    const confirmed = counts.inserted_count > 0 || counts.updated_count > 0;
    if (confirmed) {
      const p = await resolvePersistedAct(client, WI, d.fingerprint);
      if (p) { known.push({ id: p.id, hash_fingerprint: d.fingerprint, description: null, raw_data: null }); docState.set(p.id, p); }
      else result.errors.push("read-back missing");
    }
    if (!confirmed && (counts.error_count ?? 0) > 0) result.errors.push("not persisted");
    else if (counts.inserted_count > 0) result.inserted++;
    else result.skipped++;
  }
  return result;
}

// These repeated descriptors have a provider identity; filenames alone do not.
const doc = (n: string, url: string | null) => ({ id: `provider-${n}`, nombre: n, url });

Deno.test("batch: same act repeated with richer docs → real UUID updated, never pending:*", async () => {
  const rows: Row[] = [];
  let seq = 0;
  const { client, calls } = fakeClient(rows, {
    rpc: (p) => { rows.push({ id: `uuid-${++seq}`, work_item_id: WI, is_archived: false, hash_fingerprint: p.fp, documentos: p.docs }); return { data: { inserted_count: 1, updated_count: 0 }, error: null }; },
  });
  const r = await runBatch(client, rows, [
    { fp: "fpA", docs: [doc("a.pdf", null)] },
    { fp: "fpA", docs: [doc("a.pdf", "https://x/a.pdf"), doc("b.pdf", "https://x/b.pdf")] },
  ]);
  assertEquals(r.errors, []);
  assertEquals(r.inserted, 1);
  assertEquals(calls.updates.map((u) => u.id), ["uuid-1"]);
  assert(!calls.updates.some((u) => u.id.startsWith("pending:")));
  assertEquals((rows[0].documentos as unknown[]).length, 2);
});

Deno.test("batch: documentos never degrade 2 → 1 within a run (effective state, not snapshot)", async () => {
  const rows: Row[] = [{ id: "uuid-x", work_item_id: WI, is_archived: false, hash_fingerprint: "fpX", documentos: [doc("a.pdf", null)] }];
  const { client } = fakeClient(rows);
  await runBatch(client, rows, [
    { fp: "fpX", docs: [doc("a.pdf", "https://x/a.pdf"), doc("b.pdf", "https://x/b.pdf")] },
    { fp: "fpX", docs: [doc("a.pdf", "https://x/a.pdf")] },
  ]);
  assertEquals((rows[0].documentos as unknown[]).length, 2);
});

Deno.test("batch: first insert fails → no phantom candidate; repeat retries insert, not an update", async () => {
  const rows: Row[] = [];
  let n = 0;
  const { client, calls } = fakeClient(rows, {
    rpc: (p) => {
      n++;
      if (n === 1) return { data: null, error: { message: "upsert failed" } };
      rows.push({ id: "uuid-real", work_item_id: WI, is_archived: false, hash_fingerprint: p.fp, documentos: p.docs });
      return { data: { inserted_count: 1, updated_count: 0 }, error: null };
    },
  });
  const r = await runBatch(client, rows, [
    { fp: "fpB", docs: [doc("a.pdf", null)] },
    { fp: "fpB", docs: [doc("a.pdf", null)] },
  ]);
  assertEquals(r.errors, ["upsert failed"]);
  assertEquals(r.inserted, 1);
  assertEquals(calls.updates.length, 0);
  assertEquals(rows.length, 1);
});

Deno.test("batch: RPC row error is neither success nor normal skip", async () => {
  const rows: Row[] = [];
  const { client } = fakeClient(rows, { rpc: () => ({ data: { inserted_count: 0, updated_count: 0, error_count: 1 }, error: null }) });
  const r = await runBatch(client, rows, [{ fp: "fpC", docs: null }]);
  assertEquals(r.inserted, 0);
  assertEquals(r.skipped, 0);
  assertEquals(r.errors, ["not persisted"]);
});
