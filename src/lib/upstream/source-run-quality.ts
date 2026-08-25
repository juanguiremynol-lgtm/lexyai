/**
 * source-run-quality.ts — TT5. COLLECTION QUALITY, NOT EXECUTION HEALTH.
 *
 * A Cloud Run job that exits 0 says the JOB ran. It says nothing about whether
 * the provider handed us authoritative detail for the expected portfolio. On
 * 2026-07-27 the CPNU job succeeded, attempted 28 radicados and obtained 0
 * usable reads (28 PENDING_UPSTREAM) — and the digest still printed CPNU = 0
 * novedades. That representation is the defect this module closes.
 *
 * Mirrors `public.classify_source_run_quality` (SQL) and
 * `supabase/functions/_shared/sourceRunQuality.ts` (edge). A parity test keeps
 * the three in lockstep.
 */

export const SOURCE_QUALITY_STATES = [
  /** A — every expected matter produced an interpretable terminal result. */
  "SOURCE_HEALTHY_COMPLETE",
  /** B — source operated correctly; some exact radicados are unknown to it. */
  "SOURCE_HEALTHY_WITH_NOT_FOUND",
  /** C — some expected matters are unconfirmed (pending / incomplete / error). */
  "SOURCE_DEGRADED_PARTIAL",
  /** D — a material portion of the expected portfolio is unusable. */
  "SOURCE_DEGRADED_SYSTEMIC",
  /** E — the collection execution failed technically. */
  "SOURCE_RUN_FAILED",
  /** F — no collection execution inside the expected window. */
  "SOURCE_STALE",
] as const;

export type SourceQualityState = (typeof SOURCE_QUALITY_STATES)[number];

/**
 * Counts as accounted by `public.v_source_run_coverage`.
 *
 * `usable_confirmed_count` = success + success_empty + not_found. All three are
 * ANSWERED reads: the provider reached a determination. PENDING_UPSTREAM is not
 * among them — the provider answered but gave no authoritative detail (TT5.1).
 */
export interface SourceRunCounts {
  source: string;
  expected_count: number;
  attempted_count: number;
  usable_confirmed_count: number;
  success_count: number;
  success_empty_count: number;
  not_found_count: number;
  pending_upstream_count: number;
  error_count: number;
  /** false when the expected run never happened inside its window. */
  run_executed?: boolean;
  /** true when the execution itself failed technically. */
  run_failed?: boolean;
}

export function classifySourceRunQuality(c: SourceRunCounts): SourceQualityState {
  const expected = c.expected_count ?? 0;
  const attempted = c.attempted_count ?? 0;
  const usable = c.usable_confirmed_count ?? 0;
  const pending = c.pending_upstream_count ?? 0;
  const errors = c.error_count ?? 0;
  const notFound = c.not_found_count ?? 0;

  if (c.run_executed === false) return "SOURCE_STALE";
  if (c.run_failed === true) return "SOURCE_RUN_FAILED";
  if (attempted === 0) return "SOURCE_STALE";
  if (usable === 0 && pending + errors > 0) return "SOURCE_DEGRADED_SYSTEMIC";
  if (pending > 0 || errors > 0 || attempted < (expected || attempted)) {
    return "SOURCE_DEGRADED_PARTIAL";
  }
  if (notFound > 0) return "SOURCE_HEALTHY_WITH_NOT_FOUND";
  return "SOURCE_HEALTHY_COMPLETE";
}

/** usable_confirmed / expected — knowable for every expected run (TT5.2). */
export function coverageRatio(c: SourceRunCounts): number | null {
  if (!c.expected_count) return null;
  return c.usable_confirmed_count / c.expected_count;
}

/**
 * TT6 — THE INVARIANT. ZERO_NEW_ROWS != AUTHORITATIVE_NO_NOVEDADES.
 *
 * Zero ingested rows may be stated as "sin novedades" only on a source whose
 * collection was authoritative. NOT_FOUND does not disqualify the source: it is
 * a per-matter determination (TT8), separately accounted for.
 */
export function mayAssertAuthoritativeNoNovedades(state: SourceQualityState): boolean {
  return state === "SOURCE_HEALTHY_COMPLETE" || state === "SOURCE_HEALTHY_WITH_NOT_FOUND";
}

/** Spanish, factual, no legal reading. Used by the digest and the health cards. */
export function describeSourceQuality(c: SourceRunCounts, novedades: number): string {
  const state = classifySourceRunQuality(c);
  const unconfirmed = (c.pending_upstream_count ?? 0) + (c.error_count ?? 0);
  const cobertura = `cobertura ${c.usable_confirmed_count}/${c.expected_count || c.attempted_count}`;

  switch (state) {
    case "SOURCE_HEALTHY_COMPLETE":
      return novedades > 0
        ? `${novedades} novedad(es) sobre ${c.usable_confirmed_count} lecturas confirmadas (${cobertura}).`
        : `Sin novedades: ${cobertura}, todas las lecturas confirmadas.`;
    case "SOURCE_HEALTHY_WITH_NOT_FOUND":
      return `${novedades} novedad(es) sobre ${c.usable_confirmed_count} lecturas confirmadas (${cobertura}); ` +
        `${c.not_found_count} radicado(s) no conocidos por la fuente.`;
    case "SOURCE_DEGRADED_PARTIAL":
      return `${novedades} novedad(es) detectadas sobre ${c.usable_confirmed_count} lecturas confirmadas; ` +
        `${cobertura}; ${unconfirmed} sin confirmar. Cobertura incompleta: este conteo no prueba que no haya movimiento.`;
    case "SOURCE_DEGRADED_SYSTEMIC":
      return `Sin lecturas utilizables: ${c.attempted_count} intento(s), ${c.pending_upstream_count} sin detalle del proveedor. ` +
        `No se obtuvo información autorizada; el conteo de novedades no es concluyente.`;
    case "SOURCE_RUN_FAILED":
      return "La recolección falló técnicamente. No se leyó la fuente: el silencio no prueba nada.";
    case "SOURCE_STALE":
      return "No hubo corrida de recolección dentro de la ventana esperada. Estado de fuente no confiable.";
  }
}

export const SOURCE_QUALITY_LABEL: Record<SourceQualityState, string> = {
  SOURCE_HEALTHY_COMPLETE: "Cobertura completa",
  SOURCE_HEALTHY_WITH_NOT_FOUND: "Cobertura completa (con radicados no encontrados)",
  SOURCE_DEGRADED_PARTIAL: "Cobertura parcial",
  SOURCE_DEGRADED_SYSTEMIC: "Degradación sistémica",
  SOURCE_RUN_FAILED: "Ejecución fallida",
  SOURCE_STALE: "Sin corrida esperada",
};
