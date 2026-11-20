import test from 'node:test';
import assert from 'node:assert/strict';
import { getDbMaxActDate, getHistoricalRecordCount } from './cpnuFreshnessGate.ts';
import { cpnuObservedSnapshotIsCurrent } from './providerAdapters/cpnuReadEvidence.ts';

function fakeSupabase(input) {
  return { from(table) {
    assert.equal(table, 'work_item_acts');
    let rows = [...input], top = Infinity;
    return {
      select() { return this; },
      eq(key, value) { rows = rows.filter(row => row[key] === value); return this; },
      ilike(key, value) { rows = rows.filter(row => String(row[key] ?? '').toLowerCase() === value.toLowerCase()); return this; },
      order(key) { rows.sort((a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? ''))); return this; },
      limit(n) { top = n; return this; },
      async maybeSingle() { return { data: rows.slice(0, top)[0] ?? null }; },
      then(resolve, reject) { return Promise.resolve({ count: rows.length }).then(resolve, reject); },
    };
  } };
}

test('a newer email does not make a complete observed CPNU snapshot stale', async () => {
  const id = 'synthetic-work-item';
  const db = fakeSupabase([
    { work_item_id: id, is_archived: false, source: 'cpnu', act_date: '2025-07-10' },
    { work_item_id: id, is_archived: false, source: 'CPNU', act_date: '2025-07-09' },
    { work_item_id: id, is_archived: false, source: 'email', act_date: '2026-11-10' },
    { work_item_id: id, is_archived: true, source: 'cpnu', act_date: '2026-11-12' },
  ]);
  const dbMaxActDate = await getDbMaxActDate(db, id);
  const historicalRecordCount = await getHistoricalRecordCount(db, id);
  assert.equal(dbMaxActDate, '2025-07-10');
  assert.equal(historicalRecordCount, 2);
  assert.equal(cpnuObservedSnapshotIsCurrent({ observedAt:'2026-11-20T12:02:48Z', complete:true,
    snapshotMaxDate:'2025-07-10', dbMaxDate:dbMaxActDate, count:2, historicalCount:historicalRecordCount },
    Date.parse('2026-11-20T15:21:00Z')), true);
});

test('a genuinely newer CPNU act remains a regression signal', async () => {
  const db=fakeSupabase([{work_item_id:'x',is_archived:false,source:'cpnu',act_date:'2026-11-19'}]);
  const max=await getDbMaxActDate(db,'x');
  assert.equal(cpnuObservedSnapshotIsCurrent({observedAt:'2026-11-20T12:00:00Z',complete:true,
    snapshotMaxDate:'2026-11-18',dbMaxDate:max,count:1},Date.parse('2026-11-20T13:00:00Z')),false);
});

test('another source alone supplies no CPNU baseline', async () => {
  const db=fakeSupabase([{work_item_id:'x',is_archived:false,source:'email',act_date:'2026-11-19'}]);
  assert.equal(await getDbMaxActDate(db,'x'),null);
  assert.equal(await getHistoricalRecordCount(db,'x'),0);
});
