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

/**
 * Explicit non-eligible categories currently present in the database.
 * Kept explicit (not just "everything else") so surprises are visible.
 *
 * Verified against distinct work_items.workflow_type values:
 *   CGP, CPACA, TUTELA, GOV_PROCEDURE, PENAL_906
 *
 * NOTE: the real value in the DB is `GOV_PROCEDURE`, NOT `GOV_PROC`.
 * `PETICION` is not in work_items today but is a first-class app category
 * that must never be dispatched to Cloud Run.
 */
export const NON_ONLINE_SYNC_WORKFLOWS = [
  "GOV_PROCEDURE",
  "GOV_PROC", // legacy/spec name — safeguard
  "PROC_ADMIN", // spec synonym
  "PETICION",
] as const;

export function isKnownNonOnlineSync(
  workflowType: string | null | undefined,
): boolean {
  if (!workflowType) return false;
  return (NON_ONLINE_SYNC_WORKFLOWS as readonly string[]).includes(workflowType);
}

/**
 * Sync purpose per category. Publicaciones vs Estados routes differ.
 *   - "publicaciones": Rama Judicial publications flow (CGP, LABORAL, TUTELA, PENAL_906)
 *   - "estados":       SAMAI/CPACA estados electrónicos flow
 *   - "none":          not online-sync eligible
 */
export type ExternalDisplayMode = "estados" | "publicaciones" | "none";

export function externalDisplayModeFor(
  workflowType: string | null | undefined,
): ExternalDisplayMode {
  if (!workflowType) return "none";
  if (workflowType === "CPACA") return "estados";
  if (isOnlineSyncEligible(workflowType)) return "publicaciones";
  return "none";
}

/** Default per-work-item cooldown between successful publicaciones syncs. */
export const SYNC_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Structured coordinator response contract shared with all callers.
 * ok:true covers not_applicable and skipped_recent_sync — these are NOT failures.
 * ok:false is reserved for actual failures with a classified reason.
 */
export type SyncStatus =
  | "success"
  | "not_applicable"
  | "skipped_recent_sync"
  | "degraded"
  | "configuration_error"
  | "auth_error"
  | "route_mismatch"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_5xx"
  | "bad_payload"
  | "internal_error";