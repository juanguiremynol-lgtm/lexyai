import { publicReadVerdict } from './publicReadVerdict.ts';

export function dailyIngestionVerdict(response: any, failed = false) {
  const base = publicReadVerdict(!failed, response ?? { ok: false, error: 'NETWORK_ERROR' }, failed ? 500 : 200);
  const errors = Array.isArray(response?.errors) && response.errors.length > 0;
  const uncertain = Array.isArray(response?.persistence_unknown) && response.persistence_unknown.length > 0;
  const accounted = Number.isInteger(response?.inserted_count) && response.inserted_count >= 0
    && Number.isInteger(response?.skipped_count) && response.skipped_count >= 0;
  const empty = response?.result_code === 'SUCCESS_EMPTY';
  if (base.success && (errors || uncertain || (!accounted && !empty))) {
    return { success: false, retryable: true, code: 'INGESTION_NOT_CONFIRMED' };
  }
  return base;
}

/** Same bounded lease/fencing contract as the public monitor items. A late
 * HTTP reply cannot finish a reclaimed attempt; only a confirmed ingestion
 * response seals success. No global state or successful source is reset. */
export async function runDailySourceAttempt(db: any, item: { id: string; workflow_type: string }, invoke: () => Promise<any>) {
  const source = item.workflow_type === 'CPACA' ? 'samai' : item.workflow_type === 'TUTELA' ? 'tutelas' : 'cpnu';
  const { data: claim, error } = await db.rpc('claim_daily_source_attempt', { _work_item_id: item.id, _source: source });
  if (error || !claim) throw error ?? new Error('DAILY_CLAIM_MISSING');
  if (!claim.acquired) {
    if (claim.status === 'SUCCESS') return claim.result;
    throw new Error(`DAILY_SOURCE_${claim.status}: ${claim.error_code ?? 'lease or retry pending'}`);
  }
  let response: any;
  let failure: unknown;
  try { response = await invoke(); } catch (err) { failure = err; }
  const verdict = dailyIngestionVerdict(response, !!failure);
  const { data: finished, error: finishError } = await db.rpc('finish_daily_source_attempt', {
    _date: claim.run_date, _work_item_id: item.id, _source: source, _token: claim.lease_token,
    _success: verdict.success, _retryable: verdict.retryable,
    _error_code: verdict.code, _result: response ?? { ok: false, error: String(failure) },
  });
  if (finishError || finished !== true) throw finishError ?? new Error('DAILY_ATTEMPT_FENCED');
  if (!verdict.success) throw failure ?? new Error(`PUBLIC_READ_INCOMPLETE: ${verdict.code}`);
  return response;
}