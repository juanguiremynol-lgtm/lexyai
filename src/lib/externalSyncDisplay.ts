/**
 * externalSyncDisplay — Single frontend source of truth for
 * which external-sync tab a work item shows.
 *
 * Must stay in sync with supabase/functions/_shared/onlineSyncEligibility.ts
 * (the Edge Function module cannot be imported into the client bundle).
 * A vitest asserts these two lists agree.
 */

export const ONLINE_SYNC_ELIGIBLE_WORKFLOWS = [
  "CGP",
  "CPACA",
  "LABORAL",
  "PENAL_906",
  "TUTELA",
] as const;

export type ExternalDisplayMode = "estados" | "publicaciones" | "none";

export function externalDisplayModeFor(
  workflowType: string | null | undefined,
): ExternalDisplayMode {
  if (!workflowType) return "none";
  if (workflowType === "CPACA") return "estados";
  if ((ONLINE_SYNC_ELIGIBLE_WORKFLOWS as readonly string[]).includes(workflowType)) {
    return "publicaciones";
  }
  return "none";
}

export function isOnlineSyncEligible(
  workflowType: string | null | undefined,
): boolean {
  if (!workflowType) return false;
  return (ONLINE_SYNC_ELIGIBLE_WORKFLOWS as readonly string[]).includes(workflowType);
}