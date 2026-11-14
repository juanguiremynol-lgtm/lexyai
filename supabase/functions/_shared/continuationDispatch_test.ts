import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { dispatchContinuation } from './continuationDispatch.ts';
Deno.test('continuation is accepted only on a successful HTTP response, not execution success', async () => {
  assertEquals(await dispatchContinuation(async () => new Response(null, { status: 202 })), {
    continuation_enqueued: true, continuation_block_reason: null, last_error: null,
  });
});
Deno.test('HTTP rejection is recorded, never marked enqueued or retried', async () => {
  let calls = 0;
  const result = await dispatchContinuation(async () => { calls++; return new Response(null, { status: 503 }); });
  assertEquals(result.continuation_enqueued, false);
  assertEquals(result.continuation_block_reason, 'CONTINUATION_HTTP_503');
  assertEquals(calls, 1);
});
Deno.test('uncertain network acceptance is explicit and never re-POSTed', async () => {
  let calls = 0;
  const result = await dispatchContinuation(async () => { calls++; throw new Error('network'); });
  assertEquals(result.continuation_enqueued, false);
  assertEquals(result.continuation_block_reason, 'CONTINUATION_DISPATCH_UNCONFIRMED');
  assertEquals(calls, 1);
});