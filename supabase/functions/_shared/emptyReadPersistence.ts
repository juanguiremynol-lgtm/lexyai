/** A validated zero-row query is successful; a partial read stays partial. */
export function emptyReadPersistence(incomplete: boolean, previousFailures: number | null | undefined): {
  scrape_status: "SUCCESS" | "PARTIAL_SUCCESS";
  last_error_code: "PARTIAL_SOURCE" | null;
  consecutive_failures: number;
} {
  const prior = Number.isFinite(previousFailures) ? Math.max(0, previousFailures ?? 0) : 0;
  return {
    scrape_status: incomplete ? "PARTIAL_SUCCESS" : "SUCCESS",
    last_error_code: incomplete ? "PARTIAL_SOURCE" : null,
    consecutive_failures: incomplete ? prior + 1 : 0,
  };
}
