/** Real PostgREST requests, real PostgreSQL constraints/triggers, synthetic rows. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enrichPersistedAct } from "../../functions/_shared/actBatchState.ts";

const url = "http://127.0.0.1:54321";
const wi = "33333333-3333-3333-3333-333333333333";
const owner = "11111111-1111-1111-1111-111111111111";
const org = "22222222-2222-2222-2222-222222222222";
const key = Deno.readTextFileSync("/tmp/itest/svc.jwt").trim();
const client = (jwt = key, customFetch = fetch) => createClient(url, jwt, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: customFetch },
});
const db = client();
function assert(value: unknown, why: string): asserts value {
  if (!value) throw new Error(why);
}
const annotation = (sol: string) => `radicó la solicitud No. ${sol} tipo: Recepción de Memoriales de fecha: 16/10/2026 16:12:08, Documentos anexos: 2`;
const incoming = (sol: string, docs: unknown[] = []) => ({ actuacion: "RECIBE MEMORIALES ONLINE", anotacion: annotation(sol), documentos: docs });
function record(sol: string, fingerprint = `native_${sol}`) {
  return { work_item_id: wi, owner_id: owner, organization_id: org, workflow_type: "CPACA",
    act_date: "2026-10-16", description: `RECIBE MEMORIALES ONLINE - ${annotation(sol)}`,
    event_summary: annotation(sol), source: "samai", hash_fingerprint: fingerprint,
    raw_data: { actuacion: "RECIBE MEMORIALES ONLINE", anotacion: annotation(sol), origen_solicitud: sol },
    documentos: [] };
}
async function insert(sol: string) {
  const rec = record(sol);
  const result = await db.rpc("rpc_upsert_work_item_acts", { records: [rec] });
  assert(!result.error && result.data.inserted_count === 1, JSON.stringify(result));
  const row = await db.from("work_item_acts").select("*").eq("hash_fingerprint",rec.hash_fingerprint).single();
  assert(!row.error, JSON.stringify(row.error));
  return row.data;
}
async function effects() {
  const out: Record<string, unknown> = {};
  for (const table of ["notifications", "alert_instances", "work_item_deadlines", "work_item_hearings"]) {
    const result = await db.from(table).select("*").eq(table === "alert_instances" ? "entity_id" : "work_item_id",wi).order("id");
    assert(!result.error, JSON.stringify(result.error));
    out[table] = result.data;
  }
  return JSON.stringify(out);
}

Deno.test("native HTTP: stale fingerprint cannot replace a distinct request or produce effects", async () => {
  const row = await insert("9100001");
  const before = await effects();
  const result = await db.rpc("rpc_upsert_work_item_acts",{records:[record("9100002",row.hash_fingerprint)]});
  assert(!result.error && result.data.inserted_count === 0 && result.data.updated_count === 0,JSON.stringify(result));
  assert(result.data.errors.length > 0, "conflict must remain visible");
  const after = await db.from("work_item_acts").select("*").eq("id",row.id).single();
  assert(after.data.description === row.description && after.data.raw_data.anotacion === row.raw_data.anotacion,"stale fingerprint changed source");
  assert(await effects() === before,"rejected RPC generated a downstream effect");
});

Deno.test("native HTTP: simultaneous attachment enrichment retries a genuine zero-row CAS", async () => {
  const row = await insert("9100003");
  const before = await effects();
  let reads = 0, emptyPatches = 0, conditionalPatches = 0;
  let release!: () => void;
  const bothRead = new Promise<void>(resolve => { release = resolve; });
  const racingFetch: typeof fetch = async (input, init) => {
    const req = new Request(input,init);
    const u = new URL(req.url);
    const response = await fetch(req);
    if (u.pathname.endsWith("/work_item_acts") && u.searchParams.get("id") === `eq.${row.id}`) {
      if (req.method === "GET") {
        reads++;
        if (reads === 2) release();
        if (reads <= 2) await bothRead;
      }
      if (req.method === "PATCH") {
        assert(u.searchParams.has("raw_data") && u.searchParams.has("documentos"),"both snapshots must be compared");
        conditionalPatches++;
        if ((await response.clone().json()).length === 0) emptyPatches++;
      }
    }
    return response;
  };
  const a={id:"doc-a",nombre:"First",url:"https://storage.googleapis.com/andromeda-cpnu-documentos-2026/itest/a.pdf",sha256:"a".repeat(64)};
  const b={id:"doc-b",nombre:"Second",url:"https://storage.googleapis.com/andromeda-cpnu-documentos-2026/itest/b.pdf",mime_type:"application/pdf"};
  await Promise.all([
    enrichPersistedAct(client(key,racingFetch),wi,row.id,incoming("9100003",[a]),{provider:"samai"}),
    enrichPersistedAct(client(key,racingFetch),wi,row.id,incoming("9100003",[b]),{provider:"samai"}),
  ]);
  const after=await db.from("work_item_acts").select("*").eq("id",row.id).single();
  assert(emptyPatches===1 && reads===3 && conditionalPatches===3,JSON.stringify({emptyPatches,reads,conditionalPatches}));
  assert(after.data.documentos.length===2 && after.data.raw_data.documentos.length===2,"concurrent merge lost a document");
  assert(after.data.documentos.some((d: any)=>d.id==="doc-a" && d.sha256===a.sha256),"existing descriptor metadata lost");
  assert(after.data.hash_fingerprint===row.hash_fingerprint,"fingerprint changed");
  assert(await effects()===before,"attachment enrichment generated new effects");
});

Deno.test("native HTTP: known solicitud rejects unrelated index-only and unconfirmed entries", async () => {
  const row=await insert("9100004");
  const before=await effects();
  for (const entry of [
    {actuacion:"RECIBE MEMORIALES ONLINE",anotacion:"Sin solicitud ni fecha de radicación",indice:999,documentos:[{id:"foreign",url:"https://example.invalid/doc.pdf"}]},
    {actuacion:"RECIBE MEMORIALES ONLINE",anotacion:"Sin evidencia de origen",documentos:[{id:"unknown",url:"https://example.invalid/doc.pdf"}]},
  ]) {
    let rejected=false;
    try { await enrichPersistedAct(db,wi,row.id,entry,{provider:"samai"}); }
    catch(error) { rejected=String(error).includes("origin evidence"); }
    assert(rejected,"unsafe origin accepted");
  }
  const after=await db.from("work_item_acts").select("*").eq("id",row.id).single();
  assert(after.data.documentos.length===0,"foreign documents persisted");
  assert(await effects()===before,"rejected evidence generated effects");
});

Deno.test("native HTTP: identical stored bytes preserve distinct annex and request associations", async () => {
  const first=await insert("9100008"), second=await insert("9100009");
  const before=await effects();
  const shared={url:"https://storage.googleapis.com/andromeda-samai-documentos-2026/itest/shared.pdf",sha256:"e".repeat(64)};
  const a={...shared,id:"annex-first",descripcion:"First source annex"};
  const b={...shared,id:"annex-second",descripcion:"Second source annex, identical bytes"};
  await enrichPersistedAct(db,wi,first.id,incoming("9100008",[a,b]),{provider:"samai"});
  await enrichPersistedAct(db,wi,second.id,incoming("9100009",[a]),{provider:"samai"});
  // Retried ingestion and incoming subsets must preserve both existing links.
  await enrichPersistedAct(db,wi,first.id,incoming("9100008",[a]),{provider:"samai"});
  await enrichPersistedAct(db,wi,second.id,incoming("9100009",[a]),{provider:"samai"});
  const one=await db.from("work_item_acts").select("*").eq("id",first.id).single();
  const two=await db.from("work_item_acts").select("*").eq("id",second.id).single();
  assert(!one.error && !two.error,"read-back failed");
  assert(one.data.documentos.length===2 && two.data.documentos.length===1,"file deduplication erased an association");
  assert(one.data.raw_data.origen_solicitud==="9100008" && two.data.raw_data.origen_solicitud==="9100009","request identity mixed");
  assert(one.data.hash_fingerprint===first.hash_fingerprint && two.data.hash_fingerprint===second.hash_fingerprint,"identity changed");
  assert(await effects()===before,"attachment replay generated a downstream effect");
});

Deno.test("native HTTP: authenticated RLS exposes owner's acts and hides another user", async () => {
  const row=await insert("9100005");
  const own=client(Deno.readTextFileSync("/tmp/itest/owner.jwt").trim());
  const other=client(Deno.readTextFileSync("/tmp/itest/other.jwt").trim());
  const visible=await own.from("work_item_acts").select("id").eq("id",row.id);
  const hidden=await other.from("work_item_acts").select("id").eq("id",row.id);
  assert(!visible.error && visible.data.length===1,JSON.stringify(visible));
  assert(!hidden.error && hidden.data.length===0,JSON.stringify(hidden));
  const patch=await other.from("work_item_acts").update({raw_data:{foreign:true}}).eq("id",row.id).select("id");
  assert(!patch.error && patch.data.length===0,"foreign RLS PATCH must affect zero rows");
});

Deno.test("native HTTP: null dates fill, but a concurrent date writer survives fresh-read retry", async () => {
  const row=await insert("9100006");
  const filled=await enrichPersistedAct(db,wi,row.id,{...incoming("9100006"),fecha_registro:"2026-10-16",fecha_inicia_termino:"2026-10-19"},{provider:"samai"});
  assert(filled.fecha_registro_source==="2026-10-16" && filled.inicia_termino==="2026-10-19","missing dates did not fill");
  const raced=await insert("9100007");
  let reads=0, zeros=0;
  const custom: typeof fetch=async(input,init)=>{
    const req=new Request(input,init); const u=new URL(req.url);
    const result=await fetch(req);
    if(u.pathname.endsWith('/work_item_acts') && u.searchParams.get('id')===`eq.${raced.id}`){
      if(req.method==='GET' && ++reads===1){
        const competing=await db.from('work_item_acts').update({fecha_registro_source:'2026-10-17',inicia_termino:'2026-10-20'}).eq('id',raced.id);
        assert(!competing.error,JSON.stringify(competing.error));
      }
      if(req.method==='PATCH' && (await result.clone().json()).length===0)zeros++;
    }
    return result;
  };
  const after=await enrichPersistedAct(client(key,custom),wi,raced.id,{...incoming('9100007'),fecha_registro:'2026-10-16',fecha_inicia_termino:'2026-10-19'},{provider:'samai'});
  assert(zeros===1 && reads===2,JSON.stringify({zeros,reads}));
  assert(after.fecha_registro_source==='2026-10-17' && after.inicia_termino==='2026-10-20','stale date enrichment replaced the concurrent dates');
});
