import { strict as assert } from 'node:assert';

Deno.test({ name: 'actual sync handler authenticates scheduled callers and retains manual user checks',
  // Real Supabase clients keep SDK refresh intervals for their server lifetime.
  // This test has no server lifecycle; transport stays intercepted and denied.
  sanitizeOps: false, sanitizeResources: false, fn: async t => {
  const names = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','CRON_SERVICE_KEY'];
  const prior = Object.fromEntries(names.map(name => [name, Deno.env.get(name)]));
  const values = ['http://127.0.0.1:54321','synthetic-service-only','synthetic-anon-only','synthetic-cron-only'];
  for (let i=0;i<names.length;i++) Deno.env.set(names[i], values[i]);
  const originalFetch = globalThis.fetch, originalServe = Deno.serve;
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const calls: Array<{ path: string; method: string; token: string }> = [];
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init), path = new URL(req.url).pathname;
    calls.push({ path, method: req.method, token: req.headers.get('authorization') || '' });
    if (path === '/auth/v1/user') {
      return new Response(JSON.stringify(req.headers.get('authorization') === 'Bearer synthetic-user-valid'
        ? { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated' }
        : { error: 'invalid_token', message: 'Invalid token' }), {
          status: req.headers.get('authorization') === 'Bearer synthetic-user-valid' ? 200 : 401,
          headers: { 'content-type': 'application/json' },
        });
    }
    if (path === '/rest/v1/work_items') return new Response(JSON.stringify({
      id: '33333333-3333-3333-3333-333333333333', deleted_at: '2026-10-19T00:00:00Z', monitoring_enabled: true,
    }), { headers: { 'content-type': 'application/json' } });
    if (path === '/rest/v1/work_item_sync_timeline' || path === '/rest/v1/sync_traces') return new Response(null, { status: 201 });
    throw new Error(`Unexpected outbound request in auth test: ${path}`);
  };
  (Deno as any).serve = (fn: typeof handler) => { handler = fn; };
  const invoke = async (headers: Record<string,string>, scheduled = true) => {
    calls.length = 0;
    const response = await handler!(new Request('http://127.0.0.1/sync', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ work_item_id: '33333333-3333-3333-3333-333333333333', _scheduled: scheduled }),
    }));
    await new Promise(resolve => setTimeout(resolve, 0));
    return { response, body: await response.json() };
  };
  try {
    await import('../sync-by-work-item/index.ts'); assert.ok(handler);
    for (const [name, headers] of [
      ['missing', {}], ['anon', { authorization: 'Bearer synthetic-anon-only' }],
      ['arbitrary', { authorization: 'Bearer invented-token' }],
      ['forged service claim', { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.invalid-signature' }],
      ['wrong cron', { 'x-cron-key': 'wrong-secret' }],
    ] as Array<[string,Record<string,string>]>) await t.step(`scheduled ${name} returns 401 without reading work items`, async () => {
      const { response, body } = await invoke(headers);
      assert.equal(response.status,401); assert.equal(body.code,'UNAUTHORIZED');
      assert.equal(calls.some(c => c.path === '/rest/v1/work_items'),false);
      assert.equal(calls.some(c => c.path.includes('/rpc/')),false);
    });
    for (const [name,headers] of [
      ['service', { authorization: 'Bearer synthetic-service-only' }],
      ['cron', { 'x-cron-key': 'synthetic-cron-only' }],
    ] as Array<[string,Record<string,string>]>) await t.step(`scheduled ${name} reaches existing work-item boundary`, async () => {
      const { response, body } = await invoke(headers);
      assert.equal(response.status,409); assert.equal(body.code,'WORK_ITEM_DELETED');
      assert.equal(calls.filter(c => c.path === '/rest/v1/work_items').length,1);
      assert.equal(calls.some(c => c.path === '/auth/v1/user'),false);
    });
    await t.step('manual cron-only still requires interactive Authorization', async () => {
      const { response } = await invoke({ 'x-cron-key': 'synthetic-cron-only' },false);
      assert.equal(response.status,401); assert.equal(calls.some(c => c.path === '/rest/v1/work_items'),false);
    });
    await t.step('manual invalid user still fails getUser', async () => {
      const { response } = await invoke({ authorization: 'Bearer synthetic-user-invalid' },false);
      assert.equal(response.status,401); assert.ok(calls.some(c => c.path === '/auth/v1/user'));
      assert.equal(calls.some(c => c.path === '/rest/v1/work_items'),false);
    });
    await t.step('manual valid user passes getUser and reaches existing boundary', async () => {
      const { response, body } = await invoke({ authorization: 'Bearer synthetic-user-valid' },false);
      assert.equal(response.status,409); assert.equal(body.code,'WORK_ITEM_DELETED');
      assert.ok(calls.some(c => c.path === '/auth/v1/user'));
      assert.equal(calls.filter(c => c.path === '/rest/v1/work_items').length,1);
    });
  } finally {
    globalThis.fetch = originalFetch; (Deno as any).serve = originalServe;
    for (const name of names) { if (prior[name] === undefined) Deno.env.delete(name); else Deno.env.set(name, prior[name]!); }
  }
}});
