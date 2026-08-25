/**
 * runOutcomeTaxonomy.ts — CANONICAL interpretation of the outcome of a
 * provider read. Fixed on 2026-08-25 to close a recurring conflation:
 * a NOT_FOUND obtained AFTER a successful call to the provider is NOT a
 * failed run. The job ran, reached the provider, and the provider answered
 * that it does not know that radicado. That is an answered absence — a
 * determination, not an execution error.
 *
 * Five categories, mutually exclusive:
 *
 *   RUN_SUCCESS_WITH_DATA  — read ok, provider returned records.
 *   RUN_SUCCESS_EMPTY      — read ok, provider knows the matter, no new records.
 *   RUN_SUCCESS_NOT_FOUND  — read ok, provider ANSWERED that the radicado is
 *                            unknown to it (a.k.a. PROVIDER_NOT_FOUND).
 *   RUN_FAILED             — the read itself failed (transport, auth, 5xx,
 *                            timeout, parse). Nothing was learnt about the matter.
 *   SOURCE_STALE           — no run happened inside the expected window
 *                            (EXPECTED_RUN_MISSED). Silence proves nothing.
 *
 * Rules that depend on this taxonomy:
 *  - "sin novedades" may ONLY be said for RUN_SUCCESS_WITH_DATA/EMPTY.
 *  - fallback to a secondary provider is authorised by NOT_FOUND/EMPTY, never
 *    by RUN_FAILED (see providerStrategy.ts).
 *  - PROBABLE_RADICADO_INVALIDO requires RUN_SUCCESS_NOT_FOUND plus positive
 *    evidence from a covering provider; RUN_FAILED and SOURCE_STALE can never
 *    support it.
 */

export const RUN_OUTCOMES = [
  "RUN_SUCCESS_WITH_DATA",
  "RUN_SUCCESS_EMPTY",
  "RUN_SUCCESS_NOT_FOUND",
  "RUN_FAILED",
  "SOURCE_STALE",
] as const;

export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** Aliases accepted from providers/GCP, mapped onto the canonical category. */
const ALIASES: Record<string, RunOutcome> = {
  SUCCESS: "RUN_SUCCESS_WITH_DATA",
  OK: "RUN_SUCCESS_WITH_DATA",
  PARTIAL: "RUN_SUCCESS_WITH_DATA",
  EMPTY: "RUN_SUCCESS_EMPTY",
  SUCCESS_EMPTY: "RUN_SUCCESS_EMPTY",
  NOT_FOUND: "RUN_SUCCESS_NOT_FOUND",
  PROVIDER_NOT_FOUND: "RUN_SUCCESS_NOT_FOUND",
  RADICADO_NOT_FOUND: "RUN_SUCCESS_NOT_FOUND",
  PROCESO_NO_ENCONTRADO_EN_PROVEEDOR: "RUN_SUCCESS_NOT_FOUND",
  FAILED: "RUN_FAILED",
  ERROR: "RUN_FAILED",
  UNAVAILABLE: "RUN_FAILED",
  TIMEOUT: "RUN_FAILED",
  EXPECTED_RUN_MISSED: "SOURCE_STALE",
  STALE: "SOURCE_STALE",
};

export function classifyRunOutcome(raw: string | null | undefined): RunOutcome | null {
  const key = (raw ?? "").trim().toUpperCase();
  if (!key) return null;
  if ((RUN_OUTCOMES as readonly string[]).includes(key)) return key as RunOutcome;
  return ALIASES[key] ?? null;
}

/** The read reached the provider and produced a determination. */
export function isAnsweredRead(outcome: RunOutcome | null): boolean {
  return (
    outcome === "RUN_SUCCESS_WITH_DATA" ||
    outcome === "RUN_SUCCESS_EMPTY" ||
    outcome === "RUN_SUCCESS_NOT_FOUND"
  );
}

/**
 * "No hubo novedades" may only be asserted on an answered read that actually
 * covers the matter. NOT_FOUND is answered, but it says the provider does not
 * know the matter — it is not evidence that nothing happened.
 */
export function mayAssertNoNovedades(outcome: RunOutcome | null): boolean {
  return outcome === "RUN_SUCCESS_WITH_DATA" || outcome === "RUN_SUCCESS_EMPTY";
}
