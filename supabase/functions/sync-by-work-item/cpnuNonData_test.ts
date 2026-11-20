import { strict as assert } from 'node:assert';
import { orchestrateSync, type ProviderFetchFn } from '../_shared/syncOrchestrator.ts';

Deno.test('CPNU sync records adapter evidence and reserves 502 for a failed provider', async () => {
  const caseId = '00000000-0000-4000-8000-000000000001';
  const orgId = '00000000-0000-4000-8000-000000000002';
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const config = { SUPABASE_URL: 'http://db.unit.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-system',
    CPNU_BASE_URL: 'http://cpnu.unit.invalid', USE_ORCHESTRATOR_SYNC: 'false' };
  const previous = Object.keys(config).map(k => [k,Deno.env.get(k)] as const);
  let handler!: (request: Request) => Promise<Response>;
  try {
    Object.entries(config).forEach(([k,v])=>Deno.env.set(k,v));
    Deno.serve = ((fn: typeof handler) => { handler = fn; }) as unknown as typeof Deno.serve;
    await import('./index.ts');
    const negative = {motivo:'PROCESO_NO_ENCONTRADO_EN_PROVEEDOR',interpretacion:'PROVEEDOR_NO_TIENE_EL_PROCESO',
      proveedor_consultado:true,ultima_consulta_proveedor_en:'2026-11-13T11:00:00Z'};
    for (const [http,reply,expected,timelineStatus] of [
      [410,negative,'PROVIDER_NOT_FOUND','partial'],[200,{restringido:true},'PROCESO_PRIVADO','partial'],
      [206,{restringido:true,actuaciones:[]},'PROCESO_PRIVADO','partial'],
      [404,{found:false},'PENDING_UPSTREAM','pending_upstream'],[200,{found:false},'RECORD_NOT_FOUND','partial'],
      [503,{error:'unavailable'},'CPNU_SYNC_FAILED','error'],
    ] as const) {
      const patches: Record<string,unknown>[] = [];
      const runPatches: Record<string,unknown>[] = [];
      const timeline: Record<string,unknown>[] = [];
      const requests: string[] = [];
      globalThis.fetch = async (input,init) => {
        const req = new Request(input,init);
        const url = new URL(req.url);
        if (url.host === 'cpnu.unit.invalid') {
          requests.push(url.pathname);
          return Response.json(reply,{status:http});
        }
        assert.equal(url.host,'db.unit.invalid');
        if (url.pathname.endsWith('/atenia_ai_config'))
          return Response.json([{use_orchestrator_sync:http === 206}]);
        if (url.pathname.endsWith('/external_sync_runs') && req.method === 'POST')
          return Response.json({id:'00000000-0000-4000-8000-000000000003'});
        if (url.pathname.endsWith('/external_sync_runs') && req.method === 'PATCH')
          runPatches.push(await req.json());
        if (url.pathname.endsWith('/work_items') && req.method === 'GET')
          return Response.json([{id:caseId,owner_id:orgId,organization_id:orgId,workflow_type:'CGP',
            radicado:'00000000000000000000000',monitoring_enabled:true}]);
        if (url.pathname.endsWith('/work_items') && req.method === 'PATCH') patches.push(await req.json());
        if (url.pathname.endsWith('/work_item_sync_timeline') && req.method === 'POST') {
          timeline.push(await req.json());
        }
        if (url.pathname.endsWith('/rpc/admit_daily_update')) return Response.json({admitted:true});
        if (url.pathname.endsWith('/work_item_provider_enrollment'))
          return Response.json([{provider_key:'CPNU',enabled:true}]);
        if (req.method === 'HEAD') return new Response(null, {headers:{'content-range':'*/0'}});
        return Response.json([]);
      };
      const response = await handler(new Request('http://handler.unit.invalid', {
        method:'POST',headers:{authorization:'Bearer test-system','content-type':'application/json'},
        body:JSON.stringify({work_item_id:caseId,_scheduled:true,allow_buscar:false}),
      }));
      const body = await response.json();
      assert.equal(body.code,expected,JSON.stringify(body));
      assert.equal(response.status,http===503?502:200);
      assert.deepEqual(requests,['/snapshot']);
      assert.equal(timeline.length,1);
      assert.equal(timeline[0].status,timelineStatus);
      assert.equal(timeline[0].error_code,expected);
      assert.ok(!patches.some(p => p.last_successful_sync_at || p.last_synced_at));
      if (http!==503) assert.ok(patches.some(p => p.last_error_code===expected && p.scrape_status==='PARTIAL_SUCCESS'));
      if (http === 206) {
        assert.equal(body.ok, false);
        assert.equal(body.source_complete, false);
        assert.ok(!patches.some(p => p.scrape_status === 'SUCCESS' || p.scrape_status === 'FAILED'));
        assert.deepEqual(runPatches.map(run => [run.status, run.error_code]), [['PARTIAL','PROCESO_PRIVADO']]);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    Deno.serve = originalServe;
    previous.forEach(([k,v])=>v===undefined?Deno.env.delete(k):Deno.env.set(k,v));
  }
});

Deno.test('a restricted source keeps mixed fanout partial and preserves the other provider outcome', async () => {
  const ctx = {workItemId:'wi',organizationId:'org',workflowType:'TUTELA',radicado:'00000000000000000000000',
    invokedBy:'CRON',triggerSource:'test'} as const;
  const options = {skipEstados:true,skipRunRecord:true,coverageOverrides:[],enabledProviders:new Set(['cpnu','samai'])};
  const base = {ok:true,found:true,isEmpty:false,insertedCount:0,skippedCount:0,httpStatus:200,latencyMs:1,errorCode:null,errorMessage:null};
  const restricted = {...base,ok:false,errorCode:'PROCESO_PRIVADO'};
  const observed = {...base,metadata:{actuacionesCount:1}};
  const failed = {...base,ok:false,found:false,errorCode:'PROVIDER_SERVER_ERROR',httpStatus:503};
  for (const [second, attemptStatus, expectedCode] of [[observed,'success','PROCESO_PRIVADO'],[failed,'error',null]] as const) {
    const providers = new Map<string,ProviderFetchFn>([['CPNU',async () => restricted],['SAMAI',async () => second]]);
    const result = await orchestrateSync(ctx,providers,{},'','',options);
    assert.equal(result.status,'PARTIAL');
    assert.equal(result.errorCode,expectedCode);
    assert.deepEqual(result.providerAttempts.map(a => a.status).sort(),['restricted',attemptStatus].sort());
  }
});
