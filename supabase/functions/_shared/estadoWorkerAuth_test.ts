import { strict as assert } from 'node:assert';

Deno.test('estado worker rejects unauthenticated invocation before creating a service-role client', async () => {
  let handler: ((req: Request) => Promise<Response>) | null = null;
  const serve = Deno.serve;
  (Deno as any).serve = (fn: typeof handler) => { handler = fn; };
  try {
    await import('../process-estado-attachments-queue/index.ts');
    assert.ok(handler);
    const response = await handler!(new Request('https://example.invalid/worker', { method: 'POST' }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
  } finally {
    (Deno as any).serve = serve;
  }
});
