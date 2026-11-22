/** Read-only eligibility for callers which can contact a judicial provider.
 * These are execution guards, never gates on registration/configuration updates.
 * A later legitimate reactivation is evaluated again; no queue/history is changed.
 */
export interface ProviderQueryWorkItem {
  deleted_at?: unknown;
  lifecycle_state?: string | null;
  monitoring_enabled?: boolean | null;
  scraping_enabled?: boolean | null;
}

export function providerQueryBlockReason(item: ProviderQueryWorkItem): string | null {
  if (item.deleted_at) return "WORK_ITEM_DELETED";
  if (item.lifecycle_state !== "ACTIVE") return "WORK_ITEM_NOT_ACTIVE";
  if (item.monitoring_enabled !== true) return "MONITORING_DISABLED";
  if (item.scraping_enabled !== true) return "SCRAPING_DISABLED";
  return null;
}
