import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { classifyDailyInvocationError, DailySourceIncomplete, dailyIngestionVerdict, runDailySourceAttempt } from './dailySourceAttempt.ts';

Deno.test('HTTP acceptance needs confirmed ingestion, without persistence errors', () => {
  assertEquals(dailyIngestionVerdict({ ok: true }).success, false);
  assertEquals(dailyIngestionVerdict({ ok: true, inserted_count: 0, skipped_count: 15, errors: [] }).success, true);
  assertEquals(dailyIngestionVerdict({ ok: true, inserted_count: 0, skipped_count: 15, errors: ['23505'] }).success, false);
  assertEquals(dailyIngestionVerdict({ ok: true, inserted_count: 0, skipped_count: 15, snapshot_stale: true }).success, false);
  assertEquals(dailyIngestionVerdict({ ok: true, result_code: 'SUCCESS_EMPTY', status: 'NO_DATA' }).success, true);
});
Deno.test('successful source is reused; late fenced completion is never success', async () => {
  const result = { ok: true, inserted_count: 0, skipped_count: 15, errors: [] };
  let invoked = 0;
  const cached = { rpc: () => Promise.resolve({ data: { acquired: false, status: 'SUCCESS', result } }) };
  assertEquals(await runDailySourceAttempt(cached, { id: 'item', workflow_type: 'CGP' }, async () => { invoked++; return result; }), result);
  assertEquals(invoked, 0);
  const fenced = { rpc: (name: string) => Promise.resolve({ data: name.startsWith('claim') ? { acquired: true, run_date: '2026-10-21', lease_token: 'new' } : false }) };
  await assertRejects(() => runDailySourceAttempt(fenced, { id: 'item', workflow_type: 'CGP' }, async () => result), Error, 'DAILY_ATTEMPT_FENCED');
});

Deno.test('a logical incomplete source preserves its cause and retry policy, not NETWORK_ERROR', async () => {
  const finishes: Record<string, unknown>[] = [];
  const db = { rpc: (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_daily_source_attempt') return Promise.resolve({ data: { acquired: true, run_date: '2026-11-23', lease_token: 'lease' } });
    finishes.push(args);
    return Promise.resolve({ data: true });
  } };
  for (const code of ['DAILY_UPDATE_ALREADY_STARTED', 'PARTIAL_SOURCE', 'PROVIDER_NOT_FOUND', 'POST_INGEST_EFFECTS_PENDING']) {
    await assertRejects(() => runDailySourceAttempt(db, { id: 'item', workflow_type: 'CPACA' },
      () => Promise.reject(new DailySourceIncomplete(code, `PUBLIC_READ_INCOMPLETE: ${code}`))), DailySourceIncomplete);
    const saved = finishes.at(-1)!;
    assertEquals(saved._success, false);
    assertEquals(saved._retryable, true);
    assertEquals(saved._error_code, code);
  }
  await assertRejects(() => runDailySourceAttempt(db, { id: 'item', workflow_type: 'CPACA' },
    () => Promise.reject(new Error('transport unavailable'))), Error);
  assertEquals(finishes.at(-1)!._error_code, 'NETWORK_ERROR');
});

Deno.test('HTTP resource limits retain a bounded code without exposing response bodies', async () => {
  const response = new Response(JSON.stringify({ code: 'WORKER_RESOURCE_LIMIT', message: 'private detail' }), { status: 546 });
  const classified = await classifyDailyInvocationError({ context: response });
  assertEquals(classified instanceof DailySourceIncomplete, true);
  assertEquals((classified as DailySourceIncomplete).sourceCode, 'WORKER_RESOURCE_LIMIT');
  assertEquals((classified as Error).message.includes('private detail'), false);
  const finishes: Record<string, unknown>[] = [];
  const db = { rpc: (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_daily_source_attempt') return Promise.resolve({ data: { acquired: true, run_date: '2026-11-23', lease_token: 'lease' } });
    finishes.push(args); return Promise.resolve({ data: true });
  } };
  await assertRejects(() => runDailySourceAttempt(db, { id: 'item', workflow_type: 'CPACA' },
    () => Promise.reject(classified)), DailySourceIncomplete);
  assertEquals(finishes[0]._error_code, 'WORKER_RESOURCE_LIMIT');
  assertEquals(finishes[0]._success, false);
  assertEquals(finishes[0]._retryable, true);
  assertEquals(JSON.stringify(finishes[0]).includes('private detail'), false);
});

Deno.test('unparseable or excessive HTTP responses keep status; actual network errors remain unchanged', async () => {
  for (const body of ['not json', JSON.stringify({ code: 'x'.repeat(5000) }), JSON.stringify({ code: 'bad code' })]) {
    const result = await classifyDailyInvocationError({ context: new Response(body, { status: 503 }) });
    assertEquals((result as DailySourceIncomplete).sourceCode, 'EDGE_HTTP_503');
  }
  const network = new Error('network unavailable');
  assertEquals(await classifyDailyInvocationError(network), network);
});

Deno.test('stalled HTTP error bodies cannot stall the daily scheduler', async () => {
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  const started = Date.now();
  const result = await classifyDailyInvocationError({ context: new Response(stream, { status: 503 }) });
  assertEquals((result as DailySourceIncomplete).sourceCode, 'EDGE_HTTP_503');
  assertEquals(Date.now() - started < 2000, true);
});
