import type { DailyAdmission } from './dailyUpdateGate.ts';

/** Reuse a proved persisted read; a DONE label alone is insufficient. */
export function completedSamaiRead(admission: DailyAdmission, history: any, workItemId: string) {
  const prior = admission.existing;
  const summary = history?.details?.samai_estados;
  const observed = summary?.source_observed_at;
  const timestamp = typeof observed === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(observed) ? Date.parse(observed) : NaN;
  if (admission.reason !== 'DAILY_UPDATE_ALREADY_STARTED' || prior?.status !== 'DONE' ||
      history?.status !== 'SUCCESS' || history.work_item_id !== workItemId ||
      typeof prior.trace_id !== 'string' || history.details?.daily_trace_id !== prior.trace_id ||
      summary?.source_query_complete !== true || summary?.contract_mismatch === true ||
      !Number.isFinite(timestamp) || timestamp > Date.now() + 60_000 ||
      new Date(timestamp - 5 * 3600_000).toISOString().slice(0, 10) !== admission.run_date ||
      !Number.isInteger(summary.parsed_count) || summary.parsed_count < 0 ||
      summary.accounted_count !== summary.parsed_count ||
      ['ERROR', 'REJECTED_PARTIES', 'REJECTED_TRIGGER'].some(k => summary.buckets?.[k] !== 0)) return null;
  return { ok: true, work_item_id: workItemId, result_code: summary.parsed_count ? 'SUCCESS_WITH_DATA' : 'SUCCESS_EMPTY',
    reused_completed_read: true, external_sync_run_id: history.id,
    source_observed_at: observed, consulta_completa: true, persistencia_completa: true,
    inserted_count: 0, skipped_count: summary.parsed_count,
    samai_estados_summary: { ...summary, called: false }, errors: [], warnings: [] };
}
