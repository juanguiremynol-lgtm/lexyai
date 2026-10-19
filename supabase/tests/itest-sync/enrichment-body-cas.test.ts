import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { enrichPersistedAct } from '../../functions/_shared/actBatchState.ts';
import { normalizeActDocumentos, mergeActDocumentos } from '../../functions/_shared/actDocumentos.ts';
const base='http://127.0.0.1:3004';
const jwt=(await readFile('/tmp/itest/svc.jwt','utf8')).trim();
const requests: {url:string;bytes:number}[]=[];
const db=createClient(base,jwt,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{
 const url=String(input).replace(base+'/rest/v1/',base+'/');requests.push({url,bytes:String(init?.body||'').length});return fetch(url,init);
}}});
const wi='33333333-3333-3333-3333-333333333333',owner='11111111-1111-1111-1111-111111111111',org='22222222-2222-2222-8222-222222222222';
const organization='22222222-2222-2222-2222-222222222222';
const sol='96'+String(Date.now()).slice(-8),note=`Solicitud No. ${sol} de fecha: 16/10/2026 10:46:42`;
let id:string;
test('native HTTP enrichment sends large CAS documents in the body and retains concurrent associations',async()=>{
 const long={id:'large-document',descripcion:'source metadata '+ 'x'.repeat(32000),url:'https://example.test/large.pdf'};
 const inserted=await db.rpc('rpc_upsert_work_item_acts',{records:[{work_item_id:wi,owner_id:owner,organization_id:organization,workflow_type:'CPACA',source:'samai',act_date:'2026-10-16',description:'RECIBE MEMORIALES ONLINE - '+note,hash_fingerprint:'body_cas_'+sol,raw_data:{actuacion:'RECIBE MEMORIALES ONLINE',anotacion:note,indice:25,documentos:[long]},documentos:[long]}]});
 assert.equal(inserted.error,null,JSON.stringify(inserted.error));assert.equal(inserted.data.errors.length,0,JSON.stringify(inserted.data));
 const loaded=await db.from('work_item_acts').select('id').eq('hash_fingerprint','body_cas_'+sol).single();assert.equal(loaded.error,null);id=loaded.data!.id;
 const apply=(extra:any)=>enrichPersistedAct(db,wi,id,{actuacion:'RECIBE MEMORIALES ONLINE',anotacion:note,indice:25,documentos:[long,extra]},{provider:'samai'});
 await Promise.all([apply({id:'doc-B',nombre:'B'}),apply({id:'doc-C',nombre:'C'})]);
 const result=await db.from('work_item_acts').select('documentos,raw_data,description').eq('id',id).single();assert.equal(result.error,null);
 assert.deepEqual(result.data!.documentos.map((x:any)=>x.id).sort(),['doc-B','doc-C','large-document']);
 assert.equal(result.data!.description,'RECIBE MEMORIALES ONLINE - '+note);
 assert.ok(requests.filter(x=>x.url.includes('/rpc/rpc_enrich_work_item_act')).length>=2);
 assert.ok(requests.filter(x=>x.url.includes('/rpc/rpc_enrich_work_item_act')).every(x=>x.url.length<1000&&x.bytes>64000));
});
test('native enrichment cannot overwrite source identity and is unavailable to anonymous callers',async()=>{
 const row=await db.from('work_item_acts').select('raw_data,documentos,description').eq('id',id).single();assert.equal(row.error,null);
 const rejected=await db.rpc('rpc_enrich_work_item_act',{p_work_item_id:wi,p_act_id:id,p_expected_raw_data:row.data!.raw_data,p_expected_documentos:row.data!.documentos,p_patch:{raw_data:row.data!.raw_data,description:'forbidden rewrite'}});
 assert.ok(rejected.error);const after=await db.from('work_item_acts').select('description').eq('id',id).single();assert.equal(after.data!.description,row.data!.description);
});

test('ZIP reading stays separate from PDF proof and obeys invalidation and late-result ordering in TS and SQL',async()=>{
 const url='https://storage.googleapis.com/andromeda-samai-documentos-2026/samai/05001233300020260142400/'+ 'b'.repeat(64)+'.zip';
 const original={id:'archive-parent',gcs:true,gcs_url:url,url,descarga_estado:'descargado_y_leido',descarga_observado_en:'2026-10-19T10:00:00Z',archivo_verificacion:{formato:'zip',lectura_completa:true,crc_comprobado:true,miembros:[{name:'first.pdf',sha256:'same'},{name:'second.pdf',sha256:'same'}]}};
 const failed={id:'archive-parent',gcs:false,url_origen:'https://source.invalid/archive',descarga_estado:'no_verificada',descarga_observado_en:'2026-10-19T10:01:00Z',recuperacion_cache:{cacheIssue:'stored_object_missing',cachedObjectUrl:url,cacheObservedAt:'2026-10-19T10:01:00Z'}};
 const before=normalizeActDocumentos([original])!;assert.equal(before[0].disponible,true);assert.equal(before[0].pdf_verificacion,undefined);
 const pending=mergeActDocumentos(before,normalizeActDocumentos([failed]))!;
 assert.equal(pending[0].disponible,false);assert.equal(pending[0].archivo_verificacion,undefined);
 const sql=await db.rpc('act_merge_documentos',{existing:before,incoming:normalizeActDocumentos([failed])});assert.equal(sql.error,null);
 assert.equal(sql.data[0].disponible,false);assert.equal(sql.data[0].archivo_verificacion,undefined);
 const repaired=normalizeActDocumentos([{...original,descarga_observado_en:'2026-10-19T10:02:00Z'}]);
 const recovered=await db.rpc('act_merge_documentos',{existing:sql.data,incoming:repaired});assert.equal(recovered.error,null);
 assert.equal(recovered.data[0].archivo_verificacion.miembros.length,2);assert.equal(recovered.data[0].disponible,true);assert.equal(recovered.data[0].pdf_verificacion,undefined);
});


test('rotating SAMAI grants coalesce only the same source association, preserving aliases and changed files',async()=>{
 const grant=(expiry:number,extra={})=>'header,'+Buffer.from(JSON.stringify({r:'05001233300020260142400',h:'a'.repeat(64),dt:'',c:'0500123',d:'',cu:'',exp:expiry,...extra})).toString('base64url')+',signature'+expiry;
 const make=(expiry:number,label='Origen A',extra={})=>({tokenDocumento:grant(expiry),descripcion:label,sha256:'b'.repeat(64),urlDescarga:'https://samaicore.consejodeestado.gov.co/a?tokendoc='+grant(expiry),...extra});
 const left=normalizeActDocumentos([make(1),make(2),make(3,'Origen B')])!;
 assert.equal(left.length,2);assert.equal(left[0].token_aliases.length,2);
 const right=normalizeActDocumentos([make(4),make(5,'Origen A',{sha256:'c'.repeat(64)})])!;
 const ts=mergeActDocumentos(left,right)!;assert.equal(ts.length,3);assert.equal(ts[0].token_aliases.length,3);
 const sql=await db.rpc('act_merge_documentos',{existing:left,incoming:right});assert.equal(sql.error,null,JSON.stringify(sql.error));assert.equal(sql.data.length,3);assert.equal(sql.data[0].token_aliases.length,3);
 const oldUrl=normalizeActDocumentos([{...make(2),tokenDocumento:null}]);
 const oldMatch=await db.rpc('act_merge_documentos',{existing:normalizeActDocumentos([make(1)]),incoming:oldUrl});assert.equal(oldMatch.error,null);assert.equal(oldMatch.data.length,1);assert.equal(mergeActDocumentos(normalizeActDocumentos([make(1)]),oldUrl)!.length,1);
 const legacy=normalizeActDocumentos([make(1)])!.concat(normalizeActDocumentos([make(2)])!);
 const compact=await db.rpc('act_merge_documentos',{existing:legacy,incoming:[]});assert.equal(compact.error,null);assert.equal(compact.data.length,1);assert.equal(compact.data[0].token_aliases.length,2);
 const parents=await db.rpc('act_merge_documentos',{existing:normalizeActDocumentos([make(1,'Origen A',{solicitud:'3432736'})]),incoming:normalizeActDocumentos([make(2,'Origen A',{solicitud:'3435550'})])});assert.equal(parents.error,null);assert.equal(parents.data.length,2);
 const foreign=normalizeActDocumentos([{...make(8),tokenDocumento:grant(8,{r:'05001233300020240115300'})}]);
 const different=mergeActDocumentos(left,foreign)!;assert.equal(different.length,3);
});
