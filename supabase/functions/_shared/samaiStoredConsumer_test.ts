import { strict as assert } from 'node:assert';

// Invoke the real edge handler and its real adapter/mapper/timeline wrapper.
// Every HTTP operation is intercepted. The test has no network permission.
Deno.test({ name: 'CPACA stored consumer does not dispatch a duplicate platform scraper',
  sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const environment = {
    SUPABASE_URL: 'https://db-fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    PUBLICACIONES_BASE_URL: 'https://pp-fixture.invalid',
    SAMAI_ESTADOS_BASE_URL: 'https://samai-fixture.invalid',
    SAMAI_ESTADOS_API_KEY: 'synthetic-provider-key', EXTERNAL_X_API_KEY: 'synthetic-provider-key',
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(environment)) Deno.env.set(key, value);
  const originalFetch = globalThis.fetch, originalServe = Deno.serve;
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const itemId = '11111111-1111-4111-8111-111111111111';
  const pubId = '22222222-2222-4222-8222-222222222222';
  const radicado = '11001333300120260012300';
  const baseRoute = { id: 'route-fixture', workflow: 'CPACA', scope: 'PUBS',
    provider_connector_id: 'connector-fixture', provider_connectors: { key: 'SAMAI_ESTADOS', name: 'fixture' } };
  const baseInstance = { id: 'instance-fixture', name: 'fixture', scope: 'PLATFORM',
    organization_id: null, base_url: environment.SAMAI_ESTADOS_BASE_URL };
  let route: any = baseRoute, instance: any = baseInstance;
  let nativeFailure: 'http' | 'incomplete' | 'mismatch' | 'contradictory' | 'empty' | 'emptyMismatch' | null = null;
  let gateStatus: string | null = 'PENDING_UPSTREAM';
  let oldestObservation = '';
  const calls: Array<{ host: string; path: string; method: string; body: any }> = [];
  const unexpected: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    const body = request.method === 'GET' ? null : await request.clone().json().catch(() => null);
    calls.push({ host: url.host, path: url.pathname, method: request.method, body });
    if (url.host === 'samai-fixture.invalid' && url.pathname === `/persistido/${radicado}` && request.method === 'GET') {
      if (nativeFailure === 'http') return json({ error: 'synthetic provider unavailable' }, 503);
      const observed = new Date(Date.now() - 30_000).toISOString();
      oldestObservation = new Date(Date.now() - 5 * 60_000).toISOString();
      const empty = nativeFailure === 'empty' || nativeFailure === 'emptyMismatch';
      return json({ radicado, stored_read_only: true, provider_queries: 0,
        consulta_completa: nativeFailure !== 'incomplete', persistencia_completa: true,
        motivo_parcial: nativeFailure === 'contradictory' ? 'FIJACION_NO_CAPTURADA' : null,
        consultado_en: observed, providencias_consultadas_en: oldestObservation,
        fijaciones_desplegable_leido_en: observed, fijaciones_fecha_mas_antigua_leida_en: observed,
        fijaciones: { visible_dates: 1, covered_dates: 1 }, total_found: empty ? 0 : 1,
        actuaciones: empty ? [] : [{ Radicacion: radicado, categoria: 'ESTADO', source_act_id: 'synthetic:1',
          'Actuación': 'Providencia sintética', fecha_providencia_iso: '2026-01-15',
          ...(nativeFailure === 'mismatch' ? {Demandante:'ZORRO NATURA',Demandado:'PUMA DELTA'} : {}),
          fecha_estado_iso: null, fecha_estado_procedencia: null, fecha_estado_diagnostico:'FIJACION_NO_CAPTURADA' }],
      });
    }
    if (url.host === 'db-fixture.invalid') {
      if (url.pathname === '/functions/v1/provider-sync-external-provider') return json({ ok: true });
      if (url.pathname === '/rest/v1/rpc/admit_daily_update') return json({ admitted: false,
        reason: 'DAILY_UPDATE_ALREADY_STARTED', run_date: new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10),
        existing: { status: 'PENDING_UPSTREAM', trace_id: 'synthetic-original-trace' } });
      if (url.pathname === '/rest/v1/daily_update_cycles') return json(gateStatus ? {
        channels:{pubs:{status:gateStatus,trace_id:'synthetic-original-trace',token:'synthetic-secret-token'}}
      } : null);
      if (url.pathname === '/rest/v1/rpc/rpc_upsert_work_item_publicaciones') return json({
        parsed_count: 1, inserted_count: 0, updated_count: 0, skipped_count: 1,
        persisted_publicacion_id: pubId,
        outcomes: [{ bucket: 'SKIPPED_DUPLICATE', reason: 'synthetic existing publication' }],
      });
      if (url.pathname === '/rest/v1/work_items') return request.method === 'GET'
        ? json({ id: itemId, owner_id: 'owner-fixture', organization_id: 'org-fixture',
          workflow_type: 'CPACA', radicado, monitoring_enabled: true, deleted_at: null, last_synced_at: null,
          demandantes:'ALFA JURIDICA',demandados:'OMEGA LITIGIOS' })
        : json(null);
      if (url.pathname === '/rest/v1/work_item_provider_enrollment') return json({ enabled: true });
      if (url.pathname === '/rest/v1/cron_state') return json(null);
      if (url.pathname === '/rest/v1/provider_category_routes_global') return json([route]);
      if (url.pathname === '/rest/v1/provider_category_routes_org_override') return json([]);
      if (url.pathname === '/rest/v1/provider_instances') return json([instance]);
      if (url.pathname === '/rest/v1/work_item_sources') return json({ id: 'source-fixture' });
      if (url.pathname === '/rest/v1/work_item_acts' && request.method === 'GET')
        return json(nativeFailure === 'emptyMismatch' ? [{act_date:'2026-11-05',description:'Fijación en estado'}] : []);
      if (url.pathname === '/rest/v1/work_item_publicaciones') return json(
        url.searchParams.get('select') === 'id,raw_data' ? { id: pubId, raw_data: {} } : []);
      if (url.pathname === '/rest/v1/external_sync_runs') return json({ id: 'run-fixture' });
      if (url.pathname === '/rest/v1/sync_retry_queue') return json(null);
      if (['/rest/v1/provider_sync_traces', '/rest/v1/external_sync_run_payloads',
          '/rest/v1/work_item_sync_timeline', '/rest/v1/sync_traces',
          '/rest/v1/sync_persist_buckets'].includes(url.pathname)) return json(null, 201);
    }
    unexpected.push(`${request.method} ${url.host}${url.pathname}`);
    throw new Error('Unexpected outbound request in isolated stored consumer test');
  };
  (Deno as any).serve = (fn: typeof handler) => { handler = fn; };
  const invoke = async (opts: {storedOnly?:boolean; scheduled?:boolean; expectedRead?:boolean} = {}) => {
    calls.length = 0; unexpected.length = 0;
    const response = await handler!(new Request('https://edge-fixture.invalid/sync', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-service-key' },
      body: JSON.stringify({ work_item_id: itemId, _scheduled: opts.scheduled ?? true, _samai_stored_only: opts.storedOnly ?? false }),
    }));
    const result = await response.json();
    assert.deepEqual(unexpected, [], `unmocked requests: ${JSON.stringify(unexpected)}`);
    assert.equal(calls.filter(c => c.host === 'samai-fixture.invalid').length, opts.expectedRead === false ? 0 : 1);
    if (opts.expectedRead !== false) assert.equal(calls.find(c => c.host === 'samai-fixture.invalid')?.method, 'GET');
    assert.equal(calls.filter(c => c.path === '/rest/v1/rpc/admit_daily_update').length, opts.storedOnly ? 0 : 1);
    assert.equal(calls.some(c => c.path === '/rest/v1/rpc/finish_daily_update'), false);
    return result;
  };
  try {
    await import('../sync-publicaciones-by-work-item/index.ts');
    assert.ok(handler);
    await t.step('valid stored row reaches external route selection but suppresses duplicate dispatch', async () => {
      const result = await invoke();
      assert.equal(result.ok, true);
      assert.equal(result.skipped_count, 1);
      assert.equal(result.source_complete, true);
      assert.equal(result.source_query_attempted, false);
      assert.equal(result.reused_completed_read, true);
      assert.equal(result.source_observed_at, oldestObservation);
      assert.equal(calls.some(c => c.path === '/rest/v1/work_items' && c.method === 'PATCH'
        && Object.hasOwn(c.body, 'last_successful_sync_at')), false);
      assert.equal(calls.some(c => c.path === '/rest/v1/provider_instances'), true);
      assert.equal(calls.some(c => c.path === '/functions/v1/provider-sync-external-provider'), false);
      assert.equal(calls.some(c => c.path === '/rest/v1/work_item_sources'), false);
      const written = JSON.parse(calls.find(c => c.path === '/rest/v1/rpc/rpc_upsert_work_item_publicaciones')!.body.records)[0];
      assert.equal(written.fecha_fijacion, null);
      assert.equal(written.raw_data.raw_data.source_act_id, 'synthetic:1');
    });
    for (const [name, routeChange, instanceChange] of [
      ['another provider', { provider_connectors: { key: 'OTHER_PROVIDER', name: 'other fixture' } }, {}],
      ['another service', {}, { base_url: 'https://other-fixture.invalid' }],
      ['BOTH scope', { scope: 'BOTH' }, {}],
      ['BYO instance', {}, { scope: 'ORGANIZATION', organization_id: 'other-org' }],
    ] as Array<[string, object, object]>) await t.step(`preserves dispatch for ${name}`, async () => {
      route = { ...baseRoute, ...routeChange }; instance = { ...baseInstance, ...instanceChange };
      const result = await invoke();
      assert.equal(result.ok, true);
      const dispatches = calls.filter(c => c.path === '/functions/v1/provider-sync-external-provider');
      assert.equal(dispatches.length, 1);
      assert.equal(dispatches[0].method, 'POST');
      assert.equal(dispatches[0].body.work_item_id, itemId);
    });
    route = baseRoute; instance = baseInstance;
    for (const failure of ['http', 'incomplete', 'contradictory'] as const) await t.step(`preserves native ${failure} failure without a new extraction`, async () => {
      nativeFailure = failure;
      const result = await invoke();
      assert.equal(result.ok, false);
      assert.equal(result.source_query_attempted, false);
      assert.equal(result.result_code, 'PENDING_UPSTREAM');
      assert.equal(result.samai_estados_summary.status, 'ERROR');
      assert.ok(result.samai_estados_summary.error);
      assert.equal(calls.some(c => c.path === '/functions/v1/provider-sync-external-provider'), false);
      assert.equal(calls.some(c => c.path === '/rest/v1/rpc/rpc_upsert_work_item_publicaciones'), false);
    });
    await t.step('a stored row rejected for party identity is not a successful empty inventory',async()=>{
      nativeFailure='mismatch';const result=await invoke();
      assert.equal(result.ok,false);assert.equal(result.result_code,'PENDING_UPSTREAM');
      assert.equal(result.source_complete,false);assert.equal(result.error_code,'SAMAI_INVENTORY_INCOMPLETE');
      assert.equal(result.samai_estados_summary.buckets.REJECTED_PARTIES,1);
      assert.equal(result.provider_used,'samai_estados');
      assert.equal(calls.find(c=>c.path==='/rest/v1/external_sync_runs' && c.method==='POST')?.body.error_code,'SAMAI_INVENTORY_INCOMPLETE');
      assert.equal(calls.some(c=>c.path==='/rest/v1/rpc/rpc_upsert_work_item_publicaciones'),false);
    });
    await t.step('a certified empty SAMAI response creates no PP gap or retry',async()=>{
      nativeFailure='empty';const result=await invoke({storedOnly:true});
      assert.equal(result.ok,true);assert.equal(result.result_code,'SUCCESS_EMPTY');
      assert.equal(result.source_complete,true);assert.equal(result.provider_used,'samai_estados');
      assert.equal(calls.some(c=>c.path==='/rest/v1/work_item_coverage_gaps' || c.path==='/rest/v1/sync_retry_queue'),false);
    });
    await t.step('a suspicious empty response remains a SAMAI error without a PP gap',async()=>{
      nativeFailure='emptyMismatch';const result=await invoke({storedOnly:true});
      assert.equal(result.ok,false);assert.equal(result.error_code,'SAMAI_CONTRACT_MISMATCH');
      assert.equal(result.source_complete,false);
      assert.equal(calls.some(c=>c.path==='/rest/v1/work_item_coverage_gaps' || c.path==='/rest/v1/sync_retry_queue'),false);
    });
    await t.step('service-only reconciliation reads a terminal ledger without changing it or dispatching routes',async()=>{
      nativeFailure=null;gateStatus='DONE';route={...baseRoute,provider_connectors:{key:'OTHER_PROVIDER'}};
      const result=await invoke({storedOnly:true});
      assert.equal(result.ok,true);assert.equal(result.source_observed_at,oldestObservation);
      assert.equal(JSON.stringify(result).includes('synthetic-secret-token'),false);
      assert.equal(calls.some(c=>c.path==='/rest/v1/daily_update_cycles' && c.method!=='GET'),false);
      assert.equal(calls.some(c=>c.path==='/functions/v1/provider-sync-external-provider'),false);
      assert.equal(calls.some(c=>c.path==='/rest/v1/sync_retry_queue'),false);
    });
    for (const status of ['STARTED', null] as const) await t.step(`stored reconciliation refuses gate ${status}`,async()=>{
      gateStatus=status;const result=await invoke({storedOnly:true,expectedRead:false});
      assert.equal(result.code,'SAMAI_STORED_ONLY_NO_TERMINAL_ADMISSION');
      assert.equal(calls.some(c=>c.path==='/functions/v1/provider-sync-external-provider'),false);
    });
    await t.step('stored reconciliation requires a scheduled service call',async()=>{
      const result=await invoke({storedOnly:true,scheduled:false,expectedRead:false});
      assert.equal(result.code,'SAMAI_STORED_ONLY_FORBIDDEN');
    });
  } finally {
    globalThis.fetch = originalFetch; (Deno as any).serve = originalServe;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
}});
