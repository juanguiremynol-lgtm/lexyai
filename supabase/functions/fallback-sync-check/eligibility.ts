export type Enrollment = { work_item_id: string; provider_key: string; enabled: boolean };
export type Candidate = { id: string; radicado: string | null; workflow_type: string };

// The current worker may consult more than one ACTS provider. Until the worker
// enforces per-provider enrollment at the boundary, never dispatch an item
// with an explicitly disabled ACTS enrollment through this generic task.
export function fallbackEligibility(item: Candidate, enrollments: Enrollment[]):
  { eligible: true; provider: string } | { eligible: false; reason: string } {
  if (!item.radicado || item.radicado.replace(/\D/g, "").length !== 23) {
    return { eligible: false, reason: "INSUFFICIENT_RADICADO" };
  }
  const sources = enrollments.filter((e) => e.work_item_id === item.id);
  if (!sources.length) return { eligible: false, reason: "NO_ACTS_ENROLLMENT" };
  if (sources.some((e) => !e.enabled)) return { eligible: false, reason: "DISABLED_SOURCE_REQUIRES_BOUNDARY_GUARD" };
  const preferred = item.workflow_type === "CPACA" ? "samai" : "cpnu";
  const provider = sources.find((e) => e.provider_key === preferred)?.provider_key ?? sources[0].provider_key;
  return { eligible: true, provider };
}
