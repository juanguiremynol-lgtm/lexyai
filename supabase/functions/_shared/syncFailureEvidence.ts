// Error evidence must not depend on reaching the successful end-of-batch block.
export interface FailureLedger {
  parsed: number; inserted: number; updated: number; skippedDuplicate: number;
  skippedStructural: number; rejected: number; errored: number;
  outcomes: Record<string, unknown>[];
}
export function failureBucket(input: {
  workItemId: string; organizationId: string | null; runId: string | null;
  traceId: string; provider: string | null; ledger?: FailureLedger;
  sqlState?: string; code: string; phase: string;
}) {
  const l = input.ledger;
  return {
    work_item_id: input.workItemId, organization_id: input.organizationId,
    sync_run_id: input.runId, trace_id: input.traceId, provider: input.provider, data_kind: 'ACTS',
    parsed_count: l?.parsed ?? 0, inserted_count: l?.inserted ?? 0, updated_count: l?.updated ?? 0,
    skipped_duplicate_count: l?.skippedDuplicate ?? 0, skipped_structural_count: l?.skippedStructural ?? 0,
    rejected_count: l?.rejected ?? 0, error_count: l?.errored ?? 0,
    unaccounted_count: l ? Math.max(0, l.parsed - l.inserted - l.updated - l.skippedDuplicate - l.skippedStructural - l.rejected - l.errored) : 0,
    // Control failure is separate from parsed-act accounting; never invent a lost act.
    outcomes: [{ bucket: 'ERROR', reason: input.code, sql_state: input.sqlState ?? null,
      phase: input.phase, retry_policy: input.sqlState === '57014' ? 'NEXT_ADMITTED_STORED_READ' : 'VERIFY_COMMIT_BEFORE_RETRY' },
      ...(l?.outcomes ?? []).filter(o => o.bucket !== 'SKIPPED_DUPLICATE').slice(0, 12)
        .map(o => ({ bucket: o.bucket ?? null, fingerprint: o.fingerprint ?? null }))],
  };
}

export function redundantSuccessTrace(event: { step: string; success?: boolean; error_code?: string | null }) {
  // Both fields are already present in terminal traces and the timeline.
  return event.success === true && !event.error_code && ['SYNC_START', 'WORK_ITEM_LOADED'].includes(event.step);
}