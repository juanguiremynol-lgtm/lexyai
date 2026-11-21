import { strict as assert } from 'node:assert';

Deno.test({
  name: 'CPNU scheduled ingestion writes explicit identities and does not certify a positional row',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const workItem = {
      id, owner_id: '11111111-1111-4111-8111-111111111111',
      organization_id: '22222222-2222-4222-8222-222222222222',
      radicado: '05001400302020259999900', workflow_type: 'EJECUTIVO',
      monitoring_enabled: true, scraping_enabled: true, lifecycle_state: 'ACTIVE',
      authority_name: 'Despacho de prueba', stage_inference_enabled: false,
    };
    const settings = { SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-only', USE_ORCHESTRATOR_SYNC: 'false',
      CPNU_BASE_URL: 'https://provider.fixture.test' };
    const prior = Object.fromEntries(Object.keys(settings).map(name => [name, Deno.env.get(name)]));
    for (const [name, value] of Object.entries(settings)) Deno.env.set(name, value);

    const savedFetch = globalThis.fetch, savedServe = Deno.serve;
    let handler: ((request: Request) => Promise<Response>) | undefined;
    const updates: Record<string, unknown>[] = [];
    const sealed: Record<string, unknown>[] = [];
    const timeline: Record<string, unknown>[] = [];
    const actWrites: Record<string, unknown>[] = [];
    let withUnidentifiedRow = true;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      const { pathname: path } = url;
      if (path.endsWith('/snapshot')) {
        const actuaciones = [{ actuacion: 'Actuacion oficial', fechaActuacion: '2026-11-20',
          fechaRegistro: '2026-11-20', idRegActuacion: 920018501 }];
        if (withUnidentifiedRow) {
          actuaciones.push({ actuacion: 'Actuacion sin identidad', fechaActuacion: '2026-11-20',
            fechaRegistro: '2026-11-20', idRegActuacion: 0 });
        }
        return Response.json({ found: true, fetchedAt: new Date().toISOString(), actuaciones });
      }
      if (url.origin !== settings.SUPABASE_URL) throw new Error(`Unexpected host: ${url.origin}`);
      if (request.method === 'HEAD') return new Response(null, { headers: { 'Content-Range': '*/0' } });
      const object = request.headers.get('accept')?.includes('vnd.pgrst.object') === true;
      if (request.method === 'GET') {
        if (path.endsWith('/work_items')) return Response.json(object ? workItem : [workItem]);
        if (path.endsWith('/work_item_provider_enrollment')) return Response.json([{ provider_key: 'cpnu', enabled: true }]);
        if (path.endsWith('/work_item_acts') && url.searchParams.has('hash_fingerprint')) {
          const filter = url.searchParams.get('hash_fingerprint')!;
          const rows = actWrites.filter(a => filter.includes(String(a.hash_fingerprint)));
          return Response.json(object ? rows[0] ?? null : rows);
        }
        return Response.json(object ? null : []);
      }
      const body = await request.json();
      if (path.endsWith('/rpc/admit_daily_update')) return Response.json({
        admitted: true, mode: 'new', channel: 'acts', run_date: '2026-11-21', token: 'fixture',
      });
      if (path.endsWith('/rpc/finish_daily_update')) sealed.push(body);
      if (path.endsWith('/work_item_sync_timeline')) timeline.push(body);
      if (path.endsWith('/work_items') && request.method === 'PATCH') updates.push(body);
      if (path.endsWith('/rpc/rpc_upsert_work_item_acts')) {
        const rows = JSON.parse(body.records) as Record<string, unknown>[];
        actWrites.push(...rows.map(row => ({ ...row, id: crypto.randomUUID() })));
        return Response.json({ inserted_count: 1, updated_count: 0, skipped_count: 0, parsed_count: 1,
          errors: [], outcomes: [{ bucket: 'INSERTED' }] });
      }
      return new Response(null, { status: 204 });
    };
    (Deno as unknown as { serve: (fn: typeof handler) => void }).serve = fn => { handler = fn; };
    const run = () => handler!(new Request('http://127.0.0.1/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ work_item_id: id, _scheduled: true, _stored_acts_only: true, allow_buscar: false }),
    }));
    try {
      await import('../sync-by-work-item/index.ts');
      assert.ok(handler);
      const partial = await run();
      const body = await partial.json();
      assert.equal(actWrites.length, 1, 'only the act with an explicit CPNU identity reaches the write RPC');
      assert.equal(partial.status, 500, JSON.stringify(body));
      assert.equal(body.ok, false);
      assert.equal(body.source_complete === true, false);
      assert.equal(body.inserted_count, 1);
      assert.equal(body.skipped_count, 0);
      assert.equal(body.persistence_summary.parsed, 2);
      assert.equal(body.persistence_summary.errored, 1);
      assert.equal(body.persistence_summary.unaccounted, 0);
      assert.equal(body.persistence_summary.outcomes[0].reason, 'CPNU_ACT_ID_MISSING');
      assert.equal((actWrites[0].raw_data as Record<string, unknown>).origen_indice, '920018501');
      assert.equal(updates.some(p => p.last_synced_at || p.acts_initial_sync_completed_at), false);
      assert.equal(updates.some(p => Object.hasOwn(p, 'total_actuaciones')), false);
      assert.equal(timeline.length, 1);
      assert.equal(timeline.some(t => t.status === 'success' || t.status === 'empty'), false);
      assert.equal(sealed.length, 1);
      assert.equal(sealed[0]._status === 'DONE', false);

      withUnidentifiedRow = false;
      actWrites.length = 0;
      const complete = await run();
      const result = await complete.json();
      assert.equal(complete.status, 200, JSON.stringify(result));
      assert.equal(result.ok, true);
      assert.equal(result.source_complete, true);
      assert.equal(result.inserted_count, 1);
      assert.equal(updates.some(p => p.total_actuaciones === 1), true);
      assert.equal(timeline.at(-1)?.status, 'success');
      assert.equal(sealed.at(-1)?._status, 'DONE');
    } finally {
      globalThis.fetch = savedFetch;
      Deno.serve = savedServe;
      for (const [name, value] of Object.entries(prior)) {
        if (value === undefined) Deno.env.delete(name); else Deno.env.set(name, value);
      }
    }
  },
});
