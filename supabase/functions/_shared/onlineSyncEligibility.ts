/**
 * Online-Sync Eligibility — single source of truth for which work-item
 * categories can be dispatched to external Cloud Run judicial APIs.
 *
 * Eligible (online sync via external orchestrator):
 *   - CGP, CPACA, LABORAL, PENAL_906, TUTELA
 *
 * NOT eligible (internal-only app state; never enqueue for external sync,
 * never include in 24h sync invariant, never dispatch to Cloud Run):
 *   - GOV_PROC / PROC_ADMIN (procesos administrativos: authorities, NOT CPACA)
 *   - PETICION (derechos de petición)
 *   - any future non-judicial category
 *
 * IMPORTANT: "Procesos administrativos" in this app are proceedings before
 * administrative *authorities*. They are NOT CPACA (which is judicial before
 * administrative *courts*). Do not conflate them.
 */

export const ONLINE_SYNC_ELIGIBLE_WORKFLOWS = [
  "CGP",
  "CPACA",
  "LABORAL",
  "PENAL_906",
  "TUTELA",
] as const;

export type OnlineSyncEligibleWorkflow =
  (typeof ONLINE_SYNC_ELIGIBLE_WORKFLOWS)[number];

export function isOnlineSyncEligible(
  workflowType: string | null | undefined,
): boolean {
  if (!workflowType) return false;
  return (ONLINE_SYNC_ELIGIBLE_WORKFLOWS as readonly string[]).includes(
    workflowType,
  );
}

/** For use in PostgREST `.in("workflow_type", [...])` filters. */
export const ONLINE_SYNC_ELIGIBLE_LIST = [
  ...ONLINE_SYNC_ELIGIBLE_WORKFLOWS,
] as string[];