/** Real PostgreSQL 17/PostgREST + actual RPC/enrichment; synthetic rows only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { enrichPersistedAct } from '../../functions/_shared/actBatchState.ts';
import { normalizeActDocumentos, mergeActDocumentos } from '../../functions/_shared/actDocumentos.ts';
const url = 'http://127.0.0.1:3004';
const jwt = (await readFile('/tmp/itest/svc.jwt', 'utf8')).trim();
const db = createClient(url, jwt, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(String(input).replace(url + '/rest/v1/', url + '/'), init) } });
const wi='33333333-3333-3333-3333-333333333333', owner='11111111-1111-1111-1111-111111111111', org='22222222-2222-2222-2222-222222222222';
const source='https://samaicore.consejodeestado.gov.co/document?tokenDocumento=temporal-A';
const cache=`https://storage.googleapis.com/andromeda-samai-documentos-2026/samai/05001233300020260142400/${'a'.repeat(64)}.pdf`;
const times=['2026-10-19T10:00:00.000Z','2026-10-19T10:01:00.000Z','2026-10-19T10:02:00.000Z'];
const good=(i=0)=>({tokenDocumento:'temporal-A',id:'temporal-A',urlDescarga:cache,urlDescargaOriginal:source,gcs_url:cache,gcs:true,sha256:'a'.repeat(64),
 descarga_estado:'descargado_y_leido',descarga_observado_en:times[i],descarga_intentos:[{intento:1,observado_en:times[i],ok:true}],
 recuperacion_cache:{source:'cache'},pdf_verificacion:{metodo:'fixture-only',verificado_en:times[i],paginas:1,paginas_leidas:1}});
const bad=(issue='stored_object_missing')=>({tokenDocumento:'temporal-A',id:'temporal-A',urlDescarga:source,gcs:false,descarga_estado:'no_verificada',
 descarga_observado_en:times[1],descarga_intentos:[{intento:1,observado_en:times[1],ok:false}],
 descarga_error:{kind:'network',stage:'download',retryable:true,intentos_agotados:true},
 recuperacion_cache:{source:'origin',cacheIssue:issue,cachedObjectUrl:cache,cacheObservedAt:times[1]}});
const observation=(i:number)=>({estado:i===1?'error_consulta':'consultada',intentos:[{intento:1,observado_en:times[i],ok:i!==1}],...(i===1?{error:{kind:'network'}}:{documentos_observados:1})});
const note=(sol:string)=>`Solicitud No. ${sol} de fecha: 16/10/2026 10:46:42`;
const record=(sol:string,doc:any,obs:any)=>({work_item_id:wi,owner_id:owner,organization_id:org,workflow_type:'CPACA',source:'samai',act_date:'2026-10-16',
 description:`RECIBE MEMORIALES ONLINE - ${note(sol)}`,event_summary:note(sol),hash_fingerprint:`temporal_${sol}`,
 raw_data:{actuacion:'RECIBE MEMORIALES ONLINE',anotacion:note(sol),origen_solicitud:sol,indice:25,anexos:1,anexos_observacion:obs,documentos:normalizeActDocumentos([doc])},documentos:normalizeActDocumentos([doc])});
const reports:any[]=[];
const requestSuffix=Date.now().toString().slice(-7);
async function rpc(sol:string,doc:any,obs:any){const r=await db.rpc('rpc_upsert_work_item_acts',{records:[record(sol,doc,obs)]});assert.equal(r.error,null,JSON.stringify(r.error));assert.equal(r.data.errors.length,0,JSON.stringify(r.data));return load(sol);}
async function load(sol:string){const r=await db.from('work_item_acts').select('*').eq('work_item_id',wi).eq('hash_fingerprint',`temporal_${sol}`).single();assert.equal(r.error,null,JSON.stringify(r.error));return r.data;}
async function effects(){const result:any={};for(const table of ['notifications','alert_instances','work_item_deadlines','work_item_hearings']){const r=await db.from(table).select('*').eq(table==='alert_instances'?'entity_id':'work_item_id',wi).order('id');assert.equal(r.error,null);result[table]=r.data;}return result;}
function availability(row:any,state:string){assert.equal(row.documentos.length,1);const d=row.documentos[0];assert.equal(d.descarga_estado,state);assert.equal(row.raw_data.documentos[0].descarga_estado,state);if(state==='no_verificada'){assert.equal(d.disponible,false);assert.equal(d.pdf_verificacion,undefined);assert.equal(d.gcs_url,null);}else {assert.equal(d.disponible,true);assert.ok(d.pdf_verificacion);assert.equal(d.descarga_error,undefined);}return d;}
function comparable(row:any){return {documentos:row.documentos,raw_data:row.raw_data,description:row.description,hash_fingerprint:row.hash_fingerprint};}
function sorted(value:any):any {if(Array.isArray(value))return value.map(sorted).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])]));return value;}

test('TS/SQL document merge parity: missing, corrupt, source failure and stale observation',async()=>{
 for(const issue of ['stored_object_missing','stored_pdf_invalid','cache_read_error']){
  const prior=normalizeActDocumentos([good()])!, incoming=normalizeActDocumentos([bad(issue)])!;
  const ts=mergeActDocumentos(prior,incoming); const sql=await db.rpc('act_merge_documentos',{existing:prior,incoming});assert.equal(sql.error,null);
  assert.deepEqual(sorted(sql.data),sorted(ts),issue);
  const staleSql=await db.rpc('act_merge_documentos',{existing:sql.data,incoming:prior});assert.equal(staleSql.error,null);
  assert.deepEqual(sorted(staleSql.data),sorted(mergeActDocumentos(ts,prior)),issue+' stale');
 }
 const plain=[{id:'legacy',url:'https://example.test/a.pdf',descripcion:'original'}];
 const addition=[{id:'legacy',descripcion:'new ignored',nombre:'a.pdf'}];
 const r=await db.rpc('act_merge_documentos',{existing:plain,incoming:addition});assert.equal(r.error,null);assert.equal(r.data[0].descripcion,'original');assert.equal(r.data[0].nombre,'a.pdf');
});

test('actual RPC preserves current document state/raw observation through invalidation, replay, repair and late results',async()=>{
 const sol='97'+requestSuffix+'1'; const original=await rpc(sol,good(),observation(0)); const baseline=await effects();
 const pending=await rpc(sol,bad(),observation(1));availability(pending,'no_verificada');assert.equal(pending.raw_data.anexos_observacion.estado,'error_consulta');
 const repeated=await rpc(sol,bad(),observation(1));assert.deepEqual(comparable(repeated),comparable(pending));
 const stale=await rpc(sol,good(),observation(0));availability(stale,'no_verificada');assert.equal(stale.raw_data.anexos_observacion.estado,'error_consulta');
 const staleRepeat=await rpc(sol,good(),observation(0));assert.deepEqual(comparable(staleRepeat),comparable(stale));
 const repaired=await rpc(sol,good(2),observation(2));availability(repaired,'descargado_y_leido');assert.equal(repaired.raw_data.anexos_observacion.estado,'consultada');
 const oldFailure=await rpc(sol,bad(),observation(1));availability(oldFailure,'descargado_y_leido');assert.equal(oldFailure.documentos[0].pdf_verificacion.verificado_en,times[2]);
 assert.equal(oldFailure.id,original.id);assert.equal(oldFailure.description,original.description);assert.equal(oldFailure.hash_fingerprint,original.hash_fingerprint);assert.deepEqual(await effects(),baseline);
 reports.push({kind:'RPC',id:original.id,pending:comparable(pending),repaired:comparable(repaired),stale:comparable(oldFailure),duplicate_effects:0});
});

test('actual actBatchState conditional enrichment preserves the same current states and protected identity',async()=>{
 const sol='97'+requestSuffix+'2';const original=await rpc(sol,good(),observation(0));const baseline=await effects();
 const apply=async(doc:any,i:number)=>enrichPersistedAct(db,wi,original.id,{actuacion:'RECIBE MEMORIALES ONLINE',anotacion:note(sol),indice:25,anexos:1,
   documentos:normalizeActDocumentos([doc]),documentos_observados_en:times[i],anexos_observacion:observation(i)},{provider:'samai'});
 const pending=await apply(bad('stored_pdf_invalid'),1);availability(pending,'no_verificada');assert.equal(pending.raw_data.anexos_observacion.estado,'error_consulta');
 const repeated=await apply(bad('stored_pdf_invalid'),1);assert.deepEqual(comparable(repeated),comparable(pending));
 const stale=await apply(good(),0);availability(stale,'no_verificada');assert.equal(stale.raw_data.anexos_observacion.estado,'error_consulta');
 const repaired=await apply(good(2),2);availability(repaired,'descargado_y_leido');assert.equal(repaired.raw_data.anexos_observacion.estado,'consultada');
 const oldFailure=await apply(bad('stored_pdf_invalid'),1);availability(oldFailure,'descargado_y_leido');assert.equal(oldFailure.documentos[0].pdf_verificacion.verificado_en,times[2]);
 assert.equal(oldFailure.id,original.id);assert.equal(oldFailure.description,original.description);assert.equal(oldFailure.hash_fingerprint,original.hash_fingerprint);assert.deepEqual(await effects(),baseline);
 reports.push({kind:'ActBatchState_HTTP_CAS',id:original.id,pending:comparable(pending),repaired:comparable(repaired),stale:comparable(oldFailure),duplicate_effects:0});
 await writeFile('/tmp/samai-functional/evidence-r2/document-observation-native-results.json',JSON.stringify({execution:'Real local PostgreSQL 17.6/PostgREST, actual RPC and actBatchState; synthetic document observations; no production writes',reports},null,2));
});
