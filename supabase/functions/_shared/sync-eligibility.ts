/**
 * sync-eligibility.ts — Single source of truth for "which work items need sync"
 *
 * Used by:
 *   - scheduled-daily-sync (no limit, no recent filter, cursor pagination)
 *   - login sync (small batch, optionally recent)
 *
 * This ensures both paths use identical eligibility criteria.
 */

import {
  SYNC_ENABLED_WORKFLOWS,
  TERMINAL_STAGES,
} from "./syncPolicy.ts";

export interface EligibleWorkItem {
  id: string;
  radicado: string;
  workflow_type: string;
  stage: string | null;
  last_synced_at: string | null;
  total_actuaciones: number | null;
  scrape_status: string | null;
  consecutive_failures: number | null;
}

export interface SelectOptions {
  /** Max items to return. Daily sync does NOT set this (processes all). */
  limit?: number;
  /** Cursor for id-based pagination: returns items with id > afterId */
  afterId?: string;
  /** If true, only return items updated in the last 7 days (login sync) */
  onlyRecentlyAccessed?: boolean;
}

/**
 * Select work items eligible for sync from a given org.
 *
 * Eligibility rules (canonical):
 *   - monitoring_enabled = true
 *   - workflow_type IN SYNC_ENABLED_WORKFLOWS
 *   - stage NOT IN TERMINAL_STAGES
 *   - radicado IS NOT NULL
 *   - organization_id matches
 *
 * Results are ordered by id ASC for deterministic cursor pagination.
 */
export async function selectEligibleWorkItems(
  supabase: any,
  orgId: string,
  options?: SelectOptions,
): Promise<EligibleWorkItem[]> {
  let query = supabase
    .from("work_items")
    .select("id, radicado, workflow_type, stage, last_synced_at, total_actuaciones, scrape_status, consecutive_failures")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .is("deleted_at", null)
    .in("workflow_type", [...SYNC_ENABLED_WORKFLOWS])
    .not("stage", "in", `(${[...TERMINAL_STAGES].join(",")})`)
    .not("radicado", "is", null)
    .order("id", { ascending: true });

  if (options?.afterId) {
    query = query.gt("id", options.afterId);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.onlyRecentlyAccessed) {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("updated_at", cutoff);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Filter to valid 23-digit radicados
  return (data || []).filter(
    (item: any) => item.radicado && item.radicado.replace(/\D/g, "").length === 23,
  );
}
