import { strict as assert } from 'node:assert';

let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
try { await import('../process-estado-attachments-queue/index.ts'); }
finally { (Deno as any).serve = serve; }

async function invoke(body: unknown) {
  const previous = new Map(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map((key) => [key, Deno.env.get(key)]));
  Deno.env.set('SUPABASE_URL', 'https://local-fixture.invalid');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'isolated-test-service-key');
  const originalFetch = globalThis.fetch;
  const requests: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith('https://local-fixture.invalid/rest/v1/rpc/claim_estado_attachment_downloads'));
    requests.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const response = await handler(new Request('https://worker.invalid/', {
      method: 'POST', headers: { Authorization: 'Bearer isolated-test-service-key' }, body: JSON.stringify(body),
    }));
    return { response, requests };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
}

Deno.test('controlled worker sends exact work-item scope to SQL; simulated empty queue produces no document calls', async () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const { response, requests } = await invoke({ work_item_ids: ids });
  assert.equal(response.status, 200);
  assert.deepEqual(requests, [{ url: 'https://local-fixture.invalid/rest/v1/rpc/claim_estado_attachment_downloads_scoped', body: { p_limit: 1, p_work_item_ids: ids } }]);
  assert.deepEqual(await response.json(), { ok: true, processed: 0, success: 0, failed: 0, work_item_ids: ids });
});

Deno.test('invalid explicit scopes reject before any claim rather than widening to the ordinary global cron', async () => {
  for (const ids of [null, [], ['not-a-uuid'], [null], Array(3).fill('11111111-1111-4111-8111-111111111111')]) {
    const { response, requests } = await invoke({ work_item_ids: ids });
    assert.equal(response.status, 400);
    assert.equal(requests.length, 0);
  }
});

Deno.test('ordinary cron without explicit scope retains its original claim RPC', async () => {
  const { response, requests } = await invoke({});
  assert.equal(response.status, 200);
  assert.deepEqual(requests, [{ url: 'https://local-fixture.invalid/rest/v1/rpc/claim_estado_attachment_downloads', body: { p_limit: 1 } }]);
});
