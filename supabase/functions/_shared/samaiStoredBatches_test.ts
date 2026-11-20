import { strict as assert } from 'node:assert';
import { observedTodayInBogota, parseSamaiBatchRequest, samaiBatchPrefix, storedSamaiPages } from './samaiStoredBatches.ts';

Deno.test('SAMAI batch preparation binds 148 rows and preserves order across 15 pages', () => {
  const rows = Array.from({ length: 148 }, (_, index) => index);
  const pages = storedSamaiPages(rows, 148)!;
  assert.deepEqual(pages.map(page => page.length), [...Array(14).fill(10), 8]);
  assert.deepEqual(pages.flat(), rows);
  assert.equal(storedSamaiPages(rows, 147), null);
});

Deno.test('SAMAI batch identifiers, page range and observation are fenced', () => {
  const run = '00000000-0000-4000-8000-000000000001';
  assert.deepEqual(parseSamaiBatchRequest({ run, mode: 'apply', page: 14 }), { run, mode: 'apply', page: 14 });
  assert.equal(parseSamaiBatchRequest({ run, mode: 'apply', page: -1 }), null);
  assert.throws(() => samaiBatchPrefix('another/work/item', run));
  const now = Date.parse('2026-11-20T23:40:00Z');
  assert.equal(observedTodayInBogota('2026-11-20T07:45:00Z', now), true);
  assert.equal(observedTodayInBogota('2026-11-20T04:59:00Z', now), false);
  assert.equal(observedTodayInBogota('2026-11-21T04:59:00Z', now), false);
});
