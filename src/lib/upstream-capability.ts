/**
 * upstream-capability.ts — ITER43.
 *
 * The external provider does not accept every área we model. Enrolment happens
 * exclusively through `POST /lifecycle` with state ACTIVE, and that endpoint
 * validates `workflow_type` against a hardcoded allow-list:
 *
 *   andromeda-read-api/index.js:565
 *     const LIFECYCLE_WORKFLOWS =
 *       new Set(["CGP","CPACA","LABORAL","PENAL_906","TUTELA"]);
 *
 * Anything else answers 400 and writes nothing, so reclassifying a matter into
 * such an área would silently unsubscribe it from monitoring. This module is
 * the single downstream mirror of that set; the authoritative copy at runtime
 * is `public.upstream_workflow_capability`, which this constant seeds and which
 * `src/test/upstream-capability-iter43.test.ts` asserts against for drift.
 *
 * ITER44 — revision andromeda-read-api-00021-cvm admits EJECUTIVO, so the
 * guard is lifted. The mechanism stays: the next área we model will be blocked
 * by the same check until upstream accepts it.
 */

/** Verbatim transcription of the upstream allow-list, audited 2026-08-07. */
export const UPSTREAM_LIFECYCLE_WORKFLOWS = [
  "CGP",
  "CPACA",
  "LABORAL",
  "PENAL_906",
  "TUTELA",
  "EJECUTIVO",
] as const;

/**
 * ITER44 — PERMANENT ABSENCE, not a gap. `andromeda-sync-job/main.py:66` still
 * filters detectar_termino() by workflow_type, but GCP verified that
 * `terminos_procesales` has never held a row for ANY área: the upstream
 * detector produces nothing. Our downstream engine (workflow_deadline_rules +
 * rule-term-suggestions) is therefore the sole source of procedural terms, and
 * nothing in our pipeline may wait for an upstream term that will never come.
 */
export const UPSTREAM_TERM_DETECTION_WORKFLOWS = [] as const;

/** Upstream revision the mirrors above were audited against. */
export const UPSTREAM_AUDITED_REVISION = "andromeda-read-api-00021-cvm";

export const UPSTREAM_ENROLMENT_BLOCKED_REASON =
  "Pendiente de habilitación en el proveedor — al aplicar, el expediente dejaría de monitorearse";

export interface UpstreamCapability {
  workflow_type: string;
  lifecycle_enrollable: boolean;
  term_detection: boolean;
}

/** Fallback capability set, used when the live register cannot be read. */
export function fallbackCapabilities(): UpstreamCapability[] {
  const all = new Set<string>([
    ...UPSTREAM_LIFECYCLE_WORKFLOWS,
    ...UPSTREAM_TERM_DETECTION_WORKFLOWS,
    "EJECUTIVO",
    "PETICION",
    "GOV_PROCEDURE",
    "INDETERMINADO",
  ]);
  return [...all].map((workflow_type) => ({
    workflow_type,
    lifecycle_enrollable: (UPSTREAM_LIFECYCLE_WORKFLOWS as readonly string[]).includes(workflow_type),
    term_detection: (UPSTREAM_TERM_DETECTION_WORKFLOWS as readonly string[]).includes(workflow_type),
  }));
}

/** Capability check. Unknown áreas are treated as NOT enrollable (fail closed). */
export function isUpstreamEnrollable(
  workflowType: string | null | undefined,
  capabilities?: UpstreamCapability[] | null,
): boolean {
  const wf = (workflowType ?? "").toUpperCase();
  if (!wf) return false;
  const rows = capabilities && capabilities.length > 0 ? capabilities : fallbackCapabilities();
  return rows.some((c) => c.workflow_type.toUpperCase() === wf && c.lifecycle_enrollable);
}

export function hasUpstreamTermDetection(
  workflowType: string | null | undefined,
  capabilities?: UpstreamCapability[] | null,
): boolean {
  const wf = (workflowType ?? "").toUpperCase();
  const rows = capabilities && capabilities.length > 0 ? capabilities : fallbackCapabilities();
  return rows.some((c) => c.workflow_type.toUpperCase() === wf && c.term_detection);
}
