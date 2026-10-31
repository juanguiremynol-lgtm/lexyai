import { strict as assert } from 'node:assert';
import { actsRetryReadyAt, dailyRetryRunAfter } from './dailyRetryWindow.ts';

Deno.test('daily ACT retries wait for feed refresh without delaying publication follow-ups', () => {
  assert.equal(actsRetryReadyAt(new Date('2026-11-01T06:00:00Z')).toISOString(), '2026-11-01T08:00:00.000Z');
  assert.equal(dailyRetryRunAfter('RETRY_ACTS', '2026-11-01T05:00:00Z'), '2026-11-01T08:00:00.000Z');
  assert.equal(dailyRetryRunAfter('RETRY_ACTS', '2026-11-01T12:00:00Z'), '2026-11-01T12:01:00.000Z');
  assert.equal(dailyRetryRunAfter('RETRY_PUBS', '2026-11-01T05:00:00Z'), '2026-11-01T05:01:00.000Z');
  assert.equal(actsRetryReadyAt(new Date('2026-11-01T04:59:59Z')).toISOString(), '2026-10-31T08:00:00.000Z');
});
