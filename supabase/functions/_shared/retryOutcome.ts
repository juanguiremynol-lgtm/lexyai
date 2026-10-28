/** Transport acceptance is not completed ingestion; retained rows prove nothing. */
export function retryOutcome(httpStatus: number, payload: Record<string, unknown> | null): {
  outcome: "SUCCESS" | "RETRY" | "INELIGIBLE"; code: string | null;
} {
  if (httpStatus === 401 || httpStatus === 403) return { outcome: "RETRY", code: "CALLER_UNAUTHORIZED" };
  if (httpStatus < 200 || httpStatus >= 300 || !payload) return { outcome: "RETRY", code: "INVOCATION_FAILED" };
  // The source may be disabled after the queue's precheck and before the
  // dispatcher checks it. This is a terminal exclusion, not a failed query.
  if (payload.result_code === "ROUTING_SKIP_SOURCE_DISABLED" && payload.status === "SKIPPED") {
    return { outcome: "INELIGIBLE", code: "SOURCE_NOT_ENABLED" };
  }
  if (payload.pending_upstream || payload.scraping_initiated || payload.code === "SCRAPING_INITIATED" || payload.result_code === "PENDING_UPSTREAM") {
    return { outcome: "RETRY", code: "PENDING_UPSTREAM" };
  }
  if (payload.ok === true && !payload.errors && !payload.error && payload.status !== "PARTIAL") {
    return { outcome: "SUCCESS", code: null };
  }
  if (payload.ok === true && Array.isArray(payload.errors) && payload.errors.length === 0 && payload.status !== "PARTIAL") {
    return { outcome: "SUCCESS", code: null };
  }
  return { outcome: "RETRY", code: typeof payload.code === "string" ? payload.code : "INGESTION_INCOMPLETE" };
}

/** The shared provider breaker rejects a permit before any source call. */
export function breakerDeferral(payload: Record<string, unknown> | null): { delaySeconds: number; code: string } | null {
  const summary = payload?.samai_estados_summary;
  const signal = summary && typeof summary === 'object' ? String((summary as Record<string, unknown>).error ?? '') : '';
  if (!/^PROVIDER_BREAKER_(OPEN|UNAVAILABLE|LEASE_LOST)(:|$)/.test(signal)) return null;
  const retryAt = Date.parse(signal.slice(signal.indexOf(':') + 1));
  const delaySeconds = Number.isFinite(retryAt) ? Math.ceil((retryAt - Date.now()) / 1000) : 130;
  return { code: signal.split(':', 1)[0], delaySeconds: Math.max(5, Math.min(1800, delaySeconds)) };
}
