/** Query completion is independent of attachment completeness. */
export interface PublicReadSignals {
  ok?: unknown; result_code?: unknown; code?: unknown; run_status?: unknown;
  outcome?: unknown; error?: unknown; status?: unknown; cpnu_buscar_deferred?: unknown;
  scraping_initiated?: unknown; consulta_completa?: unknown; snapshot_stale?: unknown; stale?: unknown;
}
export function publicReadVerdict<T extends PublicReadSignals>(httpOK: boolean, result: T, httpStatus = 200) {
  const code = String(result.result_code ?? result.code ?? result.run_status ?? result.outcome ?? result.error ?? result.status ?? '').toUpperCase();
  const signals = [result.result_code, result.code, result.run_status, result.outcome, result.status].join('|').toUpperCase();
  // SUCCESS_EMPTY is an authoritative, completed zero-row read; a legacy
  // status 'NO_DATA' alongside it must not turn it into a pending retry.
  const authoritativeEmpty = String(result.result_code ?? '').toUpperCase() === 'SUCCESS_EMPTY';
  const pendingSignals = authoritativeEmpty ? signals.replace(/(^|\|)NO_DATA(?=\||$)/g, '$1') : signals;
  const pending = result.cpnu_buscar_deferred === true || result.scraping_initiated === true ||
    result.consulta_completa === false || result.snapshot_stale === true || result.stale === true ||
    /PENDING|DEFERRED|STALE|NO_DATA|SCRAPING_INITIATED|PROCESSING|PARTIAL|PARCIAL|INDETERMINADO|TIMEOUT|CONTRACT_MISMATCH/.test(pendingSignals);
  const skipped = /SKIP|NOT_APPLICABLE|NO_APLICA/.test(code);
  const success = httpOK && result.ok === true && !pending && !skipped;
  const accessOrAbsent = /UNAUTHORIZED|FORBIDDEN|AUTH|401|403|PROVIDER_NO_DOCUMENT|NOT_FOUND|NO_APLICA|ROUTING_SKIP/.test(code) || [401, 403, 404].includes(httpStatus);
  const retryable = !success && !accessOrAbsent && (pending || httpStatus === 429 || httpStatus >= 500 || /NETWORK|FETCH|ABORT|SYNC_FAILED|TIMEOUT/.test(code));
  return { success, retryable, code: success ? null : code || `HTTP_${httpStatus}` };
}