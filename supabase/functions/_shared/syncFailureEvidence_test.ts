import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { failureBucket, redundantSuccessTrace } from './syncFailureEvidence.ts';

Deno.test('pre-bucket failures retain correlation and zero known counts without fabricating failed acts', () => {
  const row = failureBucket({ workItemId: 'matter', organizationId: null, runId: 'run', traceId: 'trace', provider: 'samai', sqlState: '57014', code: 'PERSISTENCE_FAILED', phase: 'LOAD_IDENTITY_CANDIDATES' });
  assertEquals([row.trace_id, row.sync_run_id, row.provider], ['trace', 'run', 'samai']);
  assertEquals([row.parsed_count, row.error_count, row.unaccounted_count], [0, 0, 0]);
  assertEquals(row.outcomes[0], { bucket: 'ERROR', reason: 'PERSISTENCE_FAILED', sql_state: '57014', phase: 'LOAD_IDENTITY_CANDIDATES', retry_policy: 'NEXT_ADMITTED_STORED_READ' });
});
Deno.test('interrupted ledger preserves committed counts and never logs source bodies', () => {
  const row = failureBucket({ workItemId: 'matter', organizationId: null, runId: null, traceId: 'trace', provider: 'cpnu', code: 'PERSISTENCE_UNKNOWN', phase: 'ACT_PERSISTENCE', ledger: { parsed: 4, inserted: 1, updated: 0, skippedDuplicate: 1, skippedStructural: 0, rejected: 0, errored: 1, outcomes: [{ bucket: 'ERROR', fingerprint: 'fp', reason: 'private judicial body' }] } });
  assertEquals(row.unaccounted_count, 1);
  assertEquals(row.outcomes[0].retry_policy, 'VERIFY_COMMIT_BEFORE_RETRY');
  assertEquals(JSON.stringify(row).includes('private judicial body'), false);
});
Deno.test('only two redundant successful progress traces are omitted; every failure/provider/terminal trace remains', () => {
  assertEquals(redundantSuccessTrace({ step: 'SYNC_START', success: true }), true);
  assertEquals(redundantSuccessTrace({ step: 'WORK_ITEM_LOADED', success: true }), true);
  for (const step of ['SYNC_START', 'WORK_ITEM_LOADED', 'SYNC_FAILED', 'PROVIDER_RESULT', 'SYNC_COMPLETE']) {
    assertEquals(redundantSuccessTrace({ step, success: false, error_code: '57014' }), false);
  }
  assertEquals(redundantSuccessTrace({ step: 'SYNC_COMPLETE', success: true }), false);
});