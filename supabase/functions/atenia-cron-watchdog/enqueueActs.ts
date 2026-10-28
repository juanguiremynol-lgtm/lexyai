export type WatchCandidate = {
  id: string; organization_id: string | null; radicado: string | null; workflow_type: string;
  monitoring_enabled: boolean; deleted_at: string | null; status: string;
};
export type ActsEnrollment = { work_item_id: string; provider_key: string; enabled: boolean };
type RetryInsert = {
  work_item_id: string; organization_id: string; radicado: string;
  kind: "ACT_SCRAPE_RETRY"; provider: string; attempt: number;
  max_attempts: number; next_run_at: string; last_error_code: string;
};

/** Accept only durable inserts; a duplicate must not reset an existing lease,
 * attempt counter, due date, or backoff. A completed attempt is not success. */
export async function enqueueMissingActs(
  candidates: WatchCandidate[], enrollments: ActsEnrollment[], recentCompletedIds: Set<string>,
  insert: (task: RetryInsert) => Promise<"inserted" | "existing">,
  now: string, activeLegacyIds: Set<string> = new Set(),
) {
  const stats = { inserted: 0, existing: 0, recently_finished: 0, legacy_pending: 0, ineligible: 0, source_blocked: 0, write_errors: 0 };
  const seen = new Set<string>();
  for (const item of candidates) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (!item.monitoring_enabled || item.deleted_at || item.status !== "ACTIVE" || !item.organization_id ||
      !item.radicado || item.radicado.replace(/\D/g, "").length !== 23) { stats.ineligible++; continue; }
    const sources = enrollments.filter(e => e.work_item_id === item.id);
    // The generic consumer can choose an alternative source. Until it checks
    // every provider at execution, avoid dispatching across a disabled source.
    if (!sources.length || sources.some(e => !e.enabled)) { stats.source_blocked++; continue; }
    const preferred = item.workflow_type === "CPACA" ? "samai" : "cpnu";
    const source = sources.find(e => e.provider_key === preferred) ?? sources[0];
    if (!source || !["cpnu", "samai"].includes(source.provider_key)) { stats.source_blocked++; continue; }
    if (recentCompletedIds.has(item.id)) { stats.recently_finished++; continue; }
    if (activeLegacyIds.has(item.id)) { stats.legacy_pending++; continue; }
    try {
      const result = await insert({
        work_item_id: item.id, organization_id: item.organization_id, radicado: item.radicado,
        kind: "ACT_SCRAPE_RETRY", provider: source.provider_key, attempt: 0, max_attempts: 3,
        next_run_at: now, last_error_code: "WATCHDOG_COVERAGE_PENDING",
      });
      stats[result]++;
    } catch { stats.write_errors++; }
  }
  return stats;
}
