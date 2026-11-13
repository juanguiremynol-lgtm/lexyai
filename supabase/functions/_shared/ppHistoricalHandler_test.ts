import { strict as assert } from 'node:assert';

Deno.test({name:'historical replay through the real handler is scoped, idempotent and never a daily sync',sanitizeOps:false,sanitizeResources:false,fn:async(t)=>{
  const env={SUPABASE_URL:'https://db-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-key',
    PUBLICACIONES_BASE_URL:'https://pp-fixture.invalid',EXTERNAL_X_API_KEY:'synthetic-provider-key'};
  const previous=Object.fromEntries(Object.keys(env).map(k=>[k,Deno.env.get(k)]));
  for(const [k,v] of Object.entries(env))Deno.env.set(k,v);
  const oldFetch=globalThis.fetch,oldServe=Deno.serve;
  let handler:((req:Request)=>Promise<Response>)|undefined;
  const wi='11111111-1111-4111-8111-111111111111',pub='22222222-2222-4222-8222-222222222222';
  const rad='05001400300120250012300',runId='f5c1fa1d-a06f-439d-a947-959bc2c2f68d';
  const w={backend_run_id:runId,desde:'2026-03-12',hasta:'2026-03-12'};
  const checkpoint={desde:w.desde,hasta:w.hasta,siguiente_desde:'2026-03-13'};
  const observed=new Date(Date.now()-5000).toISOString();
  const run={backend_run_id:runId,radicado:rad,estado:'COMPLETA',consulta_completa:true,persistencia_completa:true,
    alcance_efectivo_acreditado:true,checkpoint,intento_observado_en:observed};
  const row={fecha:'11/03/2026',fecha_iso:'2026-03-11',estado:{article_id:'123456',numero:'30',fecha_publicacion:'12/03/2026',
      fecha_fijacion_impresa:'2026-03-12',fecha_publicacion_portal:'2026-03-12',titulo_original:'Estado 30'},
    documentos_pdf:[{tipo:'estado',titulo:'Planilla 30',fecha:'12/03/2026',pdf_url:'https://publicaciones-procesales-api-fixture.invalid/pdf/state'}],
    documento_atribucion:{radicado:rad,fila_estado:{metodo:'pdfplumber_celdas_despacho_acreditado',
      prueba_despacho:'PRINTED_COURT_AND_VERIFIED_DEPARTMENT',despacho_acreditado:rad.slice(0,12),
      identidad_celda:'2025-00123',fecha_celda:'MARZO 11/2026',article_id:'123456',pagina:1,tabla:1,fila:6,id_origen:'123456:p1:t1:r6'}}};
  const history={backend_run_id:runId,radicado:rad,consulta_completa:true,persistencia_completa:true,
    run_status:'SUCCESS_WITH_DATA',ventana_solicitada:checkpoint,intento_observado_en:observed,actuaciones:[row]};
  const calls:Array<{path:string;method:string;body:any;query:string}>=[];
  let write:any=null, stored=false, brokenRun=false, brokenReadback=false;
  const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
  globalThis.fetch=async(input,init)=>{
    const req=new Request(input,init),u=new URL(req.url),body=req.method==='GET'?null:await req.clone().json().catch(()=>null);
    calls.push({path:u.pathname,method:req.method,body,query:u.search});
    if(u.host==='pp-fixture.invalid'){
      if(u.pathname===`/runs/${runId}`)return json(brokenRun?{...run,persistencia_completa:false}:run);
      if(u.pathname===`/historico/${rad}`)return json(history);
    }
    if(u.host==='db-fixture.invalid'){
      if(u.pathname==='/rest/v1/work_items' && req.method==='GET')return json({id:wi,owner_id:'owner',organization_id:'org',
        workflow_type:'CGP',radicado:rad,monitoring_enabled:true,deleted_at:null,last_synced_at:null});
      if(u.pathname==='/rest/v1/cron_state')return json(null);
      if(u.pathname==='/rest/v1/rpc/rpc_upsert_work_item_publicaciones'){
        write=JSON.parse(body.records)[0]; const wasStored=stored;stored=true;
        return json({parsed_count:1,inserted_count:wasStored?0:1,updated_count:0,skipped_count:wasStored?1:0,
          persisted_publicacion_id:pub,outcomes:[{bucket:wasStored?'SKIPPED_DUPLICATE':'INSERTED'}]});
      }
      if(u.pathname==='/rest/v1/estado_attachment_queue')return json(null,201);
      if(u.pathname==='/rest/v1/work_item_publicaciones'){
        const selection=u.searchParams.get('select');
        if(selection?.startsWith('id,raw_data,tipo_publicacion,hash_fingerprint,'))return json(stored?[{id:pub,raw_data:write.raw_data,tipo_publicacion:write.tipo_publicacion,hash_fingerprint:write.hash_fingerprint}]:[]);
        if(selection==='id,raw_data')return json({id:pub,raw_data:write?.raw_data});
        if(selection==='hash_fingerprint')return brokenReadback?json({message:'fixture readback error'},503):json([{hash_fingerprint:write.hash_fingerprint}]);
      }
    }
    throw new Error(`Unexpected request ${req.method} ${u.host}${u.pathname}`);
  };
  (Deno as any).serve=(fn:typeof handler)=>{handler=fn};
  async function invoke(token='synthetic-key'){
    calls.length=0;
    const res=await handler!(new Request('https://edge-fixture.invalid',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
      body:JSON.stringify({work_item_id:wi,_scheduled:true,_historical_pp_replay:w})}));
    return {http:res.status,body:await res.json()};
  }
  try {
    await import('../sync-publicaciones-by-work-item/index.ts');assert.ok(handler);
    await t.step('health probe identifies the deployed revision without reading or writing data',async()=>{
      calls.length=0;
      const response=await handler!(new Request('https://edge-fixture.invalid',{method:'POST',
        headers:{'content-type':'application/json'},body:JSON.stringify({health_check:true})}));
      assert.equal(response.status,200);
      assert.equal((await response.json()).revision,'20261113-pp-official-replay-3');
      assert.deepEqual(calls,[]);
    });
    await t.step('inserts one exact row, without a scraper POST, daily admission or freshness write',async()=>{
      const {body}=await invoke();assert.equal(body.ok,true);assert.equal(body.inserted_count,1);
      assert.equal(body.historical_replay,true);assert.equal(body.source_query_attempted,false);assert.equal(body.source_complete,false);
      assert.match(write.fecha_fijacion,/^2026-03-12/);assert.match(write.fecha_providencia,/^2026-03-11/);
      assert.equal(write.raw_data.run_type,'historical');assert.equal(write.raw_data.raw_data.recuperacion_historica.backend_run_id,runId);
      const queued=calls.filter(x=>x.path==='/rest/v1/estado_attachment_queue');
      assert.equal(queued.length,1);assert.match(queued[0].body.remote_url,/\/pdf\/state$/);
      assert.equal(write.pdf_available,false);
      const pp=calls.filter(x=>x.path.startsWith('/runs/')||x.path.startsWith('/historico/'));
      assert.equal(pp.length,2);assert.ok(pp.every(x=>x.method==='GET'));
      assert.ok(pp[1].query.includes('live=false'));
      assert.ok(!calls.some(x=>x.path.includes('admit_daily_update')||x.path.includes('finish_daily_update')||
        x.path.includes('work_item_sync_timeline')||(x.path==='/rest/v1/work_items'&&x.method!=='GET')));
    });
    await t.step('replay skips the existing canonical fingerprint',async()=>{
      const {body}=await invoke();assert.equal(body.ok,true);assert.equal(body.inserted_count,0);assert.equal(body.skipped_count,1);
    });
    await t.step('missing persistence evidence causes no stored-history read or writes',async()=>{
      brokenRun=true;const {body}=await invoke();brokenRun=false;assert.equal(body.ok,false);
      assert.equal(body.error_code,'PP_HISTORICAL_RUN_UNCERTIFIED');
      assert.ok(!calls.some(x=>x.path.startsWith('/historico/')||x.path.includes('rpc_upsert')));
    });
    await t.step('a non-service caller cannot use the historical bypass',async()=>{
      const {http}=await invoke('untrusted');assert.equal(http,403);
      assert.ok(!calls.some(x=>x.path.startsWith('/runs/')||x.path.startsWith('/historico/')));
    });
    await t.step('failed readback is not reported as a successful recovery',async()=>{
      stored=false;brokenReadback=true;const {body}=await invoke();brokenReadback=false;assert.equal(body.ok,false);
      assert.ok(body.errors.some((x:string)=>x.includes('PERSISTENCE_READBACK_FAILED')));
    });
  } finally {globalThis.fetch=oldFetch;(Deno as any).serve=oldServe;
    for(const [k,v] of Object.entries(previous))v===undefined?Deno.env.delete(k):Deno.env.set(k,v);}
}});
