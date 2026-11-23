import { publicReadVerdict } from './publicReadVerdict.ts';

/** An HTTP response was received but its judicial-source result is incomplete.
 * Keep its stable code distinct from a transport failure in the durable ledger. */
export class DailySourceIncomplete extends Error {
  readonly sourceCode: string;
  constructor(code: unknown, message: string) {
    super(message);
    const normalized = typeof code === 'string' ? code.toUpperCase() : '';
    this.sourceCode = /^[A-Z0-9_]{1,80}$/.test(normalized) ? normalized : 'SOURCE_READ_INCOMPLETE';
  }
}

/** Supabase function errors retain the HTTP Response in `context`. Preserve
 * its status and an explicitly reported, bounded error code without storing a
 * provider response body or confusing an HTTP response with a network error. */
export async function classifyDailyInvocationError(error: unknown): Promise<unknown> {
  const context = error && typeof error === 'object' ? (error as { context?: unknown }).context : undefined;
  if (!(context instanceof Response) || context.status < 400 || context.status > 599) return error;
  let code = `EDGE_HTTP_${context.status}`;
  try {
    const clone = context.clone();
    const reader = clone.body?.getReader();
    if (reader) {
      try {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const deadline = Date.now() + 1000;
        while (size <= 4096) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error('error body read timed out');
          let timer: ReturnType<typeof setTimeout> | undefined;
          const next = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('error body read timed out')), remaining); }),
          ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
          if (next.done) break;
          size += next.value.length;
          if (size > 4096) break;
          chunks.push(next.value);
        }
        if (size <= 4096) {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          const payload = JSON.parse(new TextDecoder().decode(bytes));
          if (typeof payload?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(payload.code)) code = payload.code;
        }
      } finally {
        // Do not await cancellation of a cloned response's tee: the original
        // response may not be consumed by the SDK after it raises the error.
        void reader.cancel().catch(() => {});
      }
    }
  } catch { /* A malformed/unreadable body remains an HTTP-status diagnosis. */ }
  return new DailySourceIncomplete(code, `Edge Function HTTP ${context.status}: ${code}`);
}

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
  const verdict = failure instanceof DailySourceIncomplete
    // Preserve the existing retry policy; classification alone must not end or
    // accelerate the source's fenced retry budget.
    ? { success: false, retryable: true, code: failure.sourceCode }
    : dailyIngestionVerdict(response, !!failure);
  const { data: finished, error: finishError } = await db.rpc('finish_daily_source_attempt', {
    _date: claim.run_date, _work_item_id: item.id, _source: source, _token: claim.lease_token,
    _success: verdict.success, _retryable: verdict.retryable,
    _error_code: verdict.code, _result: response ?? { ok: false, error: String(failure) },
  });
  if (finishError || finished !== true) throw finishError ?? new Error('DAILY_ATTEMPT_FENCED');
  if (!verdict.success) throw failure ?? new Error(`PUBLIC_READ_INCOMPLETE: ${verdict.code}`);
  return response;
}
