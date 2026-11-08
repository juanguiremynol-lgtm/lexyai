import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ActLoadError, compactActIdentityRow, loadAllActiveActIdentities } from "./actBatchState.ts";
import { extractActOrigin, resolveActIdentity, toActIdentityCandidate } from "./actOriginIdentity.ts";

const wi = "11111111-1111-4111-8111-111111111111";
const documentInventory = [{ id: "fixture-document", variants: ["x".repeat(50000)] }];
const record = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  work_item_id: wi, is_archived: false, source: "samai", act_date: "2026-11-01",
  description: `RECIBE MEMORIAL - Solicitud No. ${10000+n} de fecha: 01/11/2026 10:00:00`,
  fecha_registro_source: null, recurso_consecutivo: "00", hash_fingerprint: `fp${n}`,
  raw_data: { actuacion: "RECIBE MEMORIAL",
    anotacion: `Solicitud No. ${10000+n} de fecha: 01/11/2026 10:00:00`,
    origen_solicitud: String(10000+n), indice: n, documentos: documentInventory },
  documentos: documentInventory, documentos_observados_en: "2026-11-08T05:00:00Z",
});

function fakeView(rows: Record<string, any>[], failAt?: number) {
  const calls: Array<{table: string; from: number; to: number}> = [];
  const client = { from(table: string) {
    const filters: Record<string, unknown> = {};
    const q: any = {
      select() { return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      order() { return q; },
      range(from: number, to: number) {
        calls.push({table, from, to});
        if (from === failAt) return Promise.resolve({data:null,error:{message:"fixture failure"}});
        const selected = rows.filter(r => Object.entries(filters).every(([k,v]) => r[k] === v))
          .sort((a,b) => a.id.localeCompare(b.id)).slice(from,to+1).map(compactActIdentityRow);
        return Promise.resolve({data:selected,error:null});
      },
    };
    return q;
  }};
  return {client,calls};
}

Deno.test("identity load reads all pages through the compact service view", async () => {
  const original = Array.from({length:205},(_,i)=>record(i));
  const other = {...record(999),work_item_id:"another"};
  const archived = {...record(998),is_archived:true};
  const {client,calls} = fakeView([...original,other,archived]);
  const loaded = await loadAllActiveActIdentities(client,wi);
  assertEquals(loaded.length,205);
  assertEquals(calls.map(c=>c.from),[0,100,200]);
  assert(calls.every(c=>c.table==="sync_act_identity_candidates_20261108"));
  assert(loaded.every(r => r.documentos===null && !(r.raw_data as any).documentos));
  assertEquals((original[0].raw_data as any).documentos,documentInventory);
  assert(JSON.stringify(loaded).length < JSON.stringify(original).length / 50);
});

Deno.test("failed identity pages and page cap never return an incomplete set", async () => {
  const rows = Array.from({length:205},(_,i)=>record(i));
  await assertRejects(()=>loadAllActiveActIdentities(fakeView(rows,100).client,wi),ActLoadError,"offset 100");
  await assertRejects(()=>loadAllActiveActIdentities(fakeView(rows).client,wi,100,2),ActLoadError,"refusing partial");
});

Deno.test("compact projection retains exact identity, legacy evidence and conflict decisions", () => {
  const old = record(1);
  old.raw_data = {...old.raw_data, consolidated_from: [
    {source:"cpnu",raw_data:{indice:"49",actuacion:"RECIBE MEMORIAL",anotacion:old.raw_data.anotacion}}
  ]} as typeof old.raw_data;
  const full = toActIdentityCandidate(old);
  const compact = toActIdentityCandidate(compactActIdentityRow(old));
  const same = extractActOrigin({indice:1,anotacion:old.raw_data.anotacion});
  const other = extractActOrigin({indice:1,anotacion:"Solicitud No. 99999 de fecha: 01/11/2026 10:00:00"});
  for (const incoming of [same,other]) {
    const args = {v1:old.hash_fingerprint, semanticKey:full.semantic_key ?? null,provider:"samai",
      incoming,evidence:old.description};
    const a = resolveActIdentity({...args,rows:[full]});
    const b = resolveActIdentity({...args,rows:[compact]});
    assertEquals(b.kind,a.kind);
    if (a.kind==="match" && b.kind==="match") assertEquals(b.row.id,a.row.id);
    if (a.kind==="insert" && b.kind==="insert") assertEquals(b.fingerprint,a.fingerprint);
  }
  assertEquals((compact.raw_data as any).consolidated_from,(full.raw_data as any).consolidated_from);
  assertEquals((old.raw_data as any).documentos,documentInventory);
});
