import { strict as assert } from 'node:assert';
import { explodeProviderPublicaciones, toCanonicalPubRow } from './canonicalPublicacionMapper.ts';

Deno.test({ name: 'actual PP handler prevents duplicates on legacy article conflicts', sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const env = { SUPABASE_URL:'https://db-fixture.invalid', SUPABASE_SERVICE_ROLE_KEY:'synthetic-key', PUBLICACIONES_BASE_URL:'https://pp-fixture.invalid', EXTERNAL_X_API_KEY:'synthetic-key' };
  const saved = Object.fromEntries(Object.keys(env).map(k=>[k,Deno.env.get(k)]));
  for (const [k,v] of Object.entries(env)) Deno.env.set(k,v);
  const oldFetch=globalThis.fetch, oldServe=Deno.serve;
  let handler: ((request:Request)=>Promise<Response>) | undefined;
  const item='11111111-1111-4111-8111-111111111111', radicado='11001400300120260012300';
  const raw:any={ fecha_auto:'14/10/2026', estado:{article_id:'123456',numero:'38',fecha_publicacion:'15-octubre-2026',titulo_original:'Estado 38 15 de octubre de 2026'}, documentos_pdf:[
    {tipo:'auto',titulo:'Estado 38.pdf',fecha:'14/10/2026',pdf_url:'https://example.invalid/auto.pdf'},
    {tipo:'estado',titulo:'Estado 38.pdf',fecha:'15-octubre-2026',pdf_url:'https://example.invalid/estado.pdf'}]};
  const old=toCanonicalPubRow(explodeProviderPublicaciones([raw])[0],{work_item_id:item,organization_id:'org-fixture',source:'publicaciones'});
  const article='123456', caseDay='2026-10-15', portal='2026-10-14', digest='a'.repeat(64);
  const origin='https://publicacionesprocesales.ramajudicial.gov.co/c/document_library/get_file?uuid=11111111-1111-4111-8111-111111111111';
  const key=`${radicado}/raw/estados/${digest}.pdf`;
  const proxy='https://publicaciones-procesales-api-11974381924.us-central1.run.app/pdf/'+btoa(key).replaceAll('=','');
  const archive='https://storage.googleapis.com/andromeda-pp-documentos-2026/'+key;
  const actual={...raw,estado:{...raw.estado,fecha_publicacion_portal:portal,fecha_fijacion_impresa:caseDay,pdf_url:origin},
    gcs_url_pdf_estado:archive, documentos_pdf:[raw.documentos_pdf[0],{...raw.documentos_pdf[1],pdf_url:proxy}],
    documento_atribucion:{radicado,originales:[{tipo:'estado',metodo:'pymupdf_render',lectura_comprobada:true,
      url_origen:origin,url_original:archive,paginas_renderizadas:4}]}};
  const recovered={id:'archive-ref',tipo_publicacion:'Estado Electrónico',hash_fingerprint:'editorial-title',
    fecha_fijacion:caseDay,published_at:portal,fecha_providencia:'2026-10-14',is_archived:false,pdf_available:true,
    pdf_storage_path:'recovered/verified.pdf',pdf_url:origin,raw_data:{article_id:article,estado_numero:'38',
      fuente:'portal_oficial_publicaciones_procesales',recuperacion_oficial:[{article_id:article,fecha:caseDay,
        id_despacho:'court',url:origin,sha256:digest,bytes:2048,paginas:4,
        paquete:{radicado,paginas_caso:[[2,3]],despacho_autor_nombre:'Juzgado de prueba'}}]}};
  const queue={id:'queue-ref',publicacion_id:recovered.id,status:'downloaded',remote_url:origin,storage_path:recovered.pdf_storage_path,
    validation_evidence:{state:'verified',publicacion_id:recovered.id,queue_id:'queue-ref',source_url:origin,
      reading:{sha256:digest,bytes:2048,pages:4,pagesRead:2},
      paquete:{radicado,paginas_localizadas:[2],verificado:true},correspondence:{method:'official_portal_recovery',
        expected_sha256:digest,article_id:article,fecha:caseDay,id_despacho:'court'}}};
  let recovery: 'valid'|'hash'|'date'|'queue'|'radicado'|'role'|'wrong-pages'|'ambiguous'|null=null;
  let explicit=false, mixed=false, duplicate=false, insertedFingerprint='';
  let windowOutcome: 'SUCCESS_EMPTY' | 'SUCCESS_WITH_DATA' | null = null;
  let retainedInventory = true;
  const observedAt = new Date().toISOString();
  const windowDate = (offset: number) => new Date(Date.parse(observedAt) - 5 * 3600_000 + offset * 86400_000).toISOString().slice(0,10);
  const writes: Record<string, any> = {};
  const calls:Array<{path:string;method:string;select:string|null}>=[];
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  globalThis.fetch=async(input,init)=>{
    const req=new Request(input,init),u=new URL(req.url);calls.push({path:u.pathname,method:req.method,select:u.searchParams.get('select')});
    if(windowOutcome && u.host==='pp-fixture.invalid' && u.pathname===`/historico/${radicado}`) {
      return json({radicado, backend_run_id:'f5c1fa1d-a06f-439d-a947-959bc2c2f68d', run_status:windowOutcome,
        consulta_completa:true, persistencia_completa:true, alcance_consulta_completa:'VENTANA_PUBLICA',
        ventana_solicitada:{desde:windowDate(-14),hasta:windowDate(0)}, intento_observado_en:observedAt,
        consulta_completa_plan_diario:false, recuperacion_documental_completa:false, actuaciones:retainedInventory ? [raw] : []});
    }
    if(u.host==='pp-fixture.invalid' && (u.pathname===`/historico/${radicado}` || u.pathname==='/procesar-radicado')) {
      const incoming=structuredClone(actual);
      if(recovery==='radicado')incoming.documento_atribucion.radicado='11001400300120260012400';
      if(recovery==='role')incoming.documento_atribucion.originales[0].tipo='auto';
      return json({radicado,consulta_completa:true,persistencia_completa:true,actuaciones:[recovery?incoming:
        {...raw,estado:{...raw.estado,...(explicit?{fecha_fijacion_impresa:'2026-10-15'}:{})}},...(mixed?[{estado:{article_id:'987654',numero:'39',fecha_publicacion:'16-octubre-2026',titulo_original:'Estado 39'},documentos_pdf:[]}]:[])]});
    }
    if(u.host==='db-fixture.invalid'){
      if(u.pathname==='/rest/v1/rpc/admit_daily_update')return json(duplicate
        ? {admitted:false,reason:'DAILY_UPDATE_ALREADY_STARTED',run_date:'2026-11-06',existing:{status:'PENDING_UPSTREAM'}}
        : {admitted:true,mode:'new',token:'fixture',run_date:'2026-11-06'});
      if(u.pathname==='/rest/v1/rpc/claim_pp_stored_result_read')return json({claimed:true,next_read_at:'2026-11-06T16:00:00Z'});
      if(u.pathname==='/rest/v1/work_items')return req.method==='GET'?json({id:item,owner_id:'owner',organization_id:'org-fixture',workflow_type:'CGP',radicado,monitoring_enabled:true,deleted_at:null,last_synced_at:null}):json(null);
      if(u.pathname==='/rest/v1/cron_state')return json(null);
      if(recovery && u.pathname==='/rest/v1/estado_attachment_queue') {
        assert.equal(req.method,'GET');
        assert.equal(u.searchParams.get('organization_id'),'eq.org-fixture');
        assert.equal(u.searchParams.get('work_item_id'),'eq.'+item);
        const certificate=structuredClone(queue);
        if(recovery==='queue')return json({message:'read failed'},500);
        if(recovery==='hash')certificate.validation_evidence.reading.sha256='b'.repeat(64);
        if(recovery==='wrong-pages')certificate.validation_evidence.paquete.paginas_localizadas=[4];
        return json([certificate]);
      }
      if(windowOutcome && u.pathname==='/rest/v1/estado_attachment_queue')return json(null,201);
      if(u.pathname==='/rest/v1/rpc/rpc_upsert_work_item_publicaciones'){
        const body=await req.json();insertedFingerprint=JSON.parse(body.records)[0].hash_fingerprint;
        if(windowOutcome) return json({parsed_count:1, inserted_count:0, updated_count:0, skipped_count:1,
          persisted_publicacion_id:'22222222-2222-4222-8222-222222222222',outcomes:[{bucket:'SKIPPED_DUPLICATE'}]});
        return json({parsed_count:1,inserted_count:1,updated_count:0,skipped_count:0,persisted_publicacion_id:'22222222-2222-4222-8222-222222222222',outcomes:[{bucket:'INSERTED'}]});
      }
      if(u.pathname==='/rest/v1/provider_category_routes_global' || u.pathname==='/rest/v1/provider_category_routes_org_override')return json([]);
      if(u.pathname==='/rest/v1/work_item_publicaciones'){
        if(recovery && u.searchParams.get('select')?.startsWith('id,raw_data,tipo_publicacion,')){
          const stored=structuredClone(recovered);
          if(recovery==='date')stored.fecha_fijacion=portal;
          return json(recovery==='ambiguous'?[stored,{...stored,id:'second'}]:[stored]);
        }
        if(u.searchParams.get('select')==='id,raw_data')return json({id:'22222222-2222-4222-8222-222222222222',raw_data:{}});
        if(u.searchParams.get('select')==='hash_fingerprint')return json([{hash_fingerprint:insertedFingerprint}]);
        if(windowOutcome) return json([]);
        return json([{id:'old-a',tipo_publicacion:old.tipo_publicacion,raw_data:old.raw_data,hash_fingerprint:old.hash_fingerprint},{id:'old-b',tipo_publicacion:old.tipo_publicacion,raw_data:old.raw_data,hash_fingerprint:'other'}]);
      }
      if(u.pathname==='/rest/v1/rpc/finish_daily_update')return json({});
      if(windowOutcome && req.method==='POST' && ['/rest/v1/external_sync_runs','/rest/v1/work_item_sync_timeline'].includes(u.pathname)){
        writes[u.pathname]=await req.json(); return json({id:'run-fixture'},201);
      }
      if(['/rest/v1/external_sync_runs','/rest/v1/provider_sync_traces','/rest/v1/external_sync_run_payloads','/rest/v1/work_item_sync_timeline','/rest/v1/sync_traces','/rest/v1/sync_persist_buckets','/rest/v1/sync_retry_queue'].includes(u.pathname))return json(null,201);
    }
    throw new Error(`Unexpected synthetic request ${req.method} ${u.host}${u.pathname}`);
  };
  (Deno as any).serve=(fn:typeof handler)=>{handler=fn};
  const invoke=async()=>{calls.length=0;const res=await handler!(new Request('https://edge-fixture.invalid',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer synthetic-key'},body:JSON.stringify({work_item_id:item,_scheduled:true})}));return await res.json();};
  try {
    await import('../sync-publicaciones-by-work-item/index.ts'); assert.ok(handler);
    await t.step('a corrected state role cannot duplicate a conflicting legacy article',async()=>{
      const result=await invoke();assert.ok(JSON.stringify(result).includes('PP_NATIVE_DATE_CONFLICT'));assert.equal(result.ok,false);assert.equal(result.result_code,'PENDING_UPSTREAM');assert.equal(result.error_code,'PP_NATIVE_DATE_CONFLICT');
      assert.equal(calls.some(c=>c.path==='/rest/v1/rpc/rpc_upsert_work_item_publicaciones'),false);
      assert.equal(calls.filter(c=>c.path==='/rest/v1/work_item_publicaciones').length,1);
    });
    await t.step('printed fixation still blocks before touching two existing conflicting rows',async()=>{
      explicit=true;const result=await invoke();assert.ok(JSON.stringify(result).includes('PP_NATIVE_DATE_CONFLICT'));assert.equal(result.ok,false);assert.equal(result.result_code,'PENDING_UPSTREAM');assert.equal(result.error_code,'PP_NATIVE_DATE_CONFLICT');
      const pubCalls=calls.filter(c=>c.path==='/rest/v1/work_item_publicaciones');
      assert.equal(pubCalls.length,1);
      assert.equal(calls.some(c=>c.path==='/rest/v1/rpc/rpc_upsert_work_item_publicaciones'),false);
    });
    for(const scenario of ['valid','hash','date','queue','radicado','role','wrong-pages','ambiguous'] as const){
      await t.step('official archived state replay - '+scenario,async()=>{
        recovery=scenario;
        try{
          const result=await invoke();
          if(scenario==='valid'){
            assert.equal(result.skipped_count,1,JSON.stringify(result));
            assert.equal(result.source_complete,false); assert.equal(result.result_code,'PENDING_UPSTREAM');
            assert.deepEqual(result.errors,[]); assert.equal(result.inserted_count,0);
          }else{
            assert.equal(result.error_code,'PP_NATIVE_DATE_CONFLICT',JSON.stringify(result));
            assert.equal(result.ok,false);
          }
          assert.equal(calls.some(c=>c.path==='/rest/v1/rpc/rpc_upsert_work_item_publicaciones'),false);
          assert.equal(calls.some(c=>c.path==='/rest/v1/estado_attachment_queue' && c.method!=='GET'),false);
        }finally{recovery=null;}
      });
    }
    await t.step('one inserted state plus legacy conflict stays pending and never advances the baseline',async()=>{
      mixed=true;explicit=false;const result=await invoke();assert.ok(JSON.stringify(result).includes('PP_NATIVE_DATE_CONFLICT'));
      assert.equal(result.inserted_count,1);assert.equal(result.ok,false);assert.equal(result.status,'PENDING_UPSTREAM');assert.equal(result.result_code,'PENDING_UPSTREAM');
      assert.equal(calls.filter(c=>c.path==='/rest/v1/rpc/rpc_upsert_work_item_publicaciones').length,1);
      assert.equal(calls.some(c=>c.path==='/rest/v1/work_items' && c.method==='PATCH'),false);
    });
    await t.step('a stored read without a daily certificate names PP and retains its incomplete cause',async()=>{
      duplicate=true;const result=await invoke();
      assert.equal(result.ok,false);assert.equal(result.provider_used,'publicaciones');
      assert.equal(result.error_code,'PP_STORED_READ_INCOMPLETE');assert.equal(result.source_complete,false);
      assert.equal(result.deduplicated,true);assert.ok(result.stored_result_read.reason);
      assert.equal(result.stored_result_read.endpoint,'historico');
      assert.equal(result.stored_result_read.identity_match,false);
      assert.equal(calls.some(c=>c.path==='/procesar-radicado'),false);
      assert.equal(calls.some(c=>c.path==='/rest/v1/rpc/rpc_upsert_work_item_publicaciones'),false);
    });
    for(const outcome of ['SUCCESS_EMPTY','SUCCESS_WITH_DATA'] as const) {
      await t.step(`retained rows preserve the provider's certified ${outcome} and the partial daily plan`,async()=>{
        duplicate=false; mixed=false; explicit=false; windowOutcome=outcome;
        for (const key of Object.keys(writes)) delete writes[key];
        const result=await invoke();
        assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(result.inserted_count,0);
        assert.ok(result.skipped_count>0); assert.equal(result.result_code,outcome);
        assert.deepEqual(result.pp_window,{outcome,from:windowDate(-14),to:windowDate(0),daily_plan_complete:false,documents_complete:false});
        const attempt=writes['/rest/v1/external_sync_runs'].provider_attempts[0];
        assert.equal(attempt.outcome,`RUN_${outcome}`); assert.deepEqual(attempt.pp_window,result.pp_window);
        assert.equal(attempt.backend_trace.consulta_completa_plan_diario,false);
        const timeline=writes['/rest/v1/work_item_sync_timeline'];
        assert.equal(timeline.status,outcome==='SUCCESS_EMPTY'?'empty':'success');
        assert.deepEqual(timeline.metadata.pp_window,result.pp_window);
      });
    }
    for(const outcome of ['SUCCESS_EMPTY','SUCCESS_WITH_DATA'] as const) {
      await t.step(`zero retained rows with a certified ${outcome} do not open a speculative court coverage gap`,async()=>{
        retainedInventory=false; windowOutcome=outcome;
        for (const key of Object.keys(writes)) delete writes[key];
        const result=await invoke();
        assert.equal(result.pp_window?.outcome,outcome,JSON.stringify(result));
        const absent=outcome==='SUCCESS_EMPTY';
        assert.equal(result.ok,absent);
        assert.equal(result.result_code,absent?'SUCCESS_EMPTY':'PENDING_UPSTREAM');
        if (!absent) assert.equal(result.error_code,'PP_WINDOW_ROWS_UNAVAILABLE');
        const timeline = writes['/rest/v1/work_item_sync_timeline'];
        assert.equal(timeline.status,absent?'empty':'pending_upstream');
        assert.equal(calls.some(c=>c.path==='/rest/v1/work_item_coverage_gaps'),false);
      });
    }
  } finally {globalThis.fetch=oldFetch;(Deno as any).serve=oldServe;for(const [k,v] of Object.entries(saved))v===undefined?Deno.env.delete(k):Deno.env.set(k,v);}
}});
