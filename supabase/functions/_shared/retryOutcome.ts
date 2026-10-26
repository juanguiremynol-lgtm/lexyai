/** Transport acceptance is not completed ingestion; retained rows prove nothing. */
export function retryOutcome(httpStatus: number, payload: Record<string, unknown> | null): {
  outcome: "SUCCESS" | "RETRY"; code: string | null;
} {
  if (httpStatus === 401 || httpStatus === 403) return { outcome: "RETRY", code: "CALLER_UNAUTHORIZED" };
  if (httpStatus < 200 || httpStatus >= 300 || !payload) return { outcome: "RETRY", code: "INVOCATION_FAILED" };
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