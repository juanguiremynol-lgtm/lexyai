export type Enrollment = { work_item_id: string; provider_key: string; enabled: boolean };
export type Candidate = { id: string; radicado: string | null; workflow_type: string };

// The worker re-reads enrollment and guards each provider at invocation. A
// disabled alternative must not prevent recovery of a separately enabled one.
export function fallbackEligibility(item: Candidate, enrollments: Enrollment[]):
  { eligible: true; provider: string } | { eligible: false; reason: string } {
  if (!item.radicado || item.radicado.replace(/\D/g, "").length !== 23) {
    return { eligible: false, reason: "INSUFFICIENT_RADICADO" };
  }
  const sources = enrollments.filter((e) => e.work_item_id === item.id);
  if (!sources.length) return { eligible: false, reason: "NO_ACTS_ENROLLMENT" };
  const enabled = sources.filter((e) => e.enabled && ["cpnu", "samai"].includes(e.provider_key));
  if (!enabled.length) return { eligible: false, reason: "NO_ENABLED_ACTS_SOURCE" };
  const preferred = item.workflow_type === "CPACA" ? "samai" : "cpnu";
  const primary = enabled.find((e) => e.provider_key === preferred);
  if (!primary && !["TUTELA", "INDETERMINADO"].includes(item.workflow_type)) {
    return { eligible: false, reason: "ENABLED_SOURCE_NOT_REACHABLE_BY_CHAIN" };
  }
  const provider = primary?.provider_key ?? enabled[0].provider_key;
  return { eligible: true, provider };
}
