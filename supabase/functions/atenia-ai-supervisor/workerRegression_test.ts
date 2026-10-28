import { strict as assert } from 'node:assert';

Deno.test('supervisor denies anonymous callers and retries HTTP 200 partial without marking done', async () => {
  const oldServe = Deno.serve;
  const oldFetch = globalThis.fetch;
  const envKeys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SERVICE_KEY'];
  const oldValues = envKeys.map(k => Deno.env.get(k));
  Deno.env.set('SUPABASE_URL', 'https://mock.invalid');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service');
  Deno.env.set('CRON_SERVICE_KEY', 'synthetic-cron');
  let handler: ((req: Request) => Promise<Response>) | undefined;
  (Deno as any).serve = (f: typeof handler) => { handler = f; };
  const updates: Array<{ url: URL; body: any }> = [];
  const invocations: Array<{ url: URL; headers: Headers }> = [];
  let fetchCount = 0;
  globalThis.fetch = async (input, init) => {
    fetchCount++;
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const j = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname.endsWith('/rpc/atenia_ai_try_start_task')) return j(true);
    if (url.pathname.endsWith('/rpc/atenia_ai_claim_supported_queue')) return j([
      { id: 'task1', work_item_id: 'item1', action_type: 'RETRY_ACTS', attempts: 1, max_attempts: 3 },
      { id: 'task2', work_item_id: 'item2', action_type: 'RETRY_PUBS', attempts: 1, max_attempts: 3 },
      { id: 'task3', work_item_id: 'item3', action_type: 'RETRY_ACTS', attempts: 1, max_attempts: 3 },
    ]);
    if (url.pathname.includes('/functions/v1/sync-')) {
      invocations.push({ url, headers: req.headers });
      return j(url.pathname.endsWith('sync-by-work-item') ? { ok: true, errors: [] } : { ok: false, pending_upstream: true, code: 'PENDING_UPSTREAM' });
    }
    if (url.pathname.endsWith('/atenia_ai_remediation_queue') && req.method === 'PATCH') {
      updates.push({ url, body: await req.json() });
      if (url.searchParams.get('id') === 'eq.task3') return j([]);
      return j({ id: url.searchParams.get('id')?.replace('eq.', '') });
    }
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/0' } });
    return j([]);
  };
  try {
    await import('./index.ts');
    assert.ok(handler);
    const makeReq = (auth?: string) => new Request('https://mock.invalid/functions/v1/atenia-ai-supervisor', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({ mode: 'PROCESS_QUEUE' }),
    });
    assert.equal((await handler(makeReq())).status, 401);
    assert.equal(fetchCount, 0);
    const response = await handler(makeReq('Bearer synthetic-service'));
    assert.equal(response.status, 200);
    assert.equal(invocations.length, 3);
    assert.equal(invocations[0].headers.get('authorization'), 'Bearer synthetic-service');
    assert.equal(invocations[1].headers.get('authorization'), 'Bearer synthetic-service');
    assert.equal(invocations[0].headers.get('x-retry-task-id'), 'task1');
    assert.deepEqual(updates.map(x => x.body.status), ['DONE', 'PENDING', 'DONE']);
    assert.equal(updates[1].body.last_error, 'PENDING_UPSTREAM');
    assert.equal(updates[0].url.searchParams.get('status'), 'eq.RUNNING');
    assert.equal(updates[0].url.searchParams.get('attempts'), 'eq.1');
    const payload = await response.json();
    assert.equal(payload.result.results[2].status, 'LEASE_REPLACED');
  } finally {
    (Deno as any).serve = oldServe;
    globalThis.fetch = oldFetch;
    envKeys.forEach((k, i) => oldValues[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, oldValues[i]!));
  }
});
