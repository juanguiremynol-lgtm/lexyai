/**
 * sourceRunQuality.ts — TT5, edge mirror of `src/lib/upstream/source-run-quality.ts`
 * and of `public.classify_source_run_quality`.
 *
 * EXECUTION HEALTH != COLLECTION QUALITY. A successful job that obtained no
 * authoritative detail must never let a consumer print "0 novedades".
 * Keep this file byte-compatible in behaviour with the app-side module; the
 * parity test asserts the classifier branch by branch.
 */

export const SOURCE_QUALITY_STATES = [
  "SOURCE_HEALTHY_COMPLETE",
  "SOURCE_HEALTHY_WITH_NOT_FOUND",
  "SOURCE_DEGRADED_PARTIAL",
  "SOURCE_DEGRADED_SYSTEMIC",
  "SOURCE_RUN_FAILED",
  "SOURCE_STALE",
] as const;

export type SourceQualityState = (typeof SOURCE_QUALITY_STATES)[number];

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
  run_executed?: boolean;
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

export function mayAssertAuthoritativeNoNovedades(state: SourceQualityState): boolean {
  return state === "SOURCE_HEALTHY_COMPLETE" || state === "SOURCE_HEALTHY_WITH_NOT_FOUND";
}

export const SOURCE_LABEL: Record<string, string> = {
  cpnu: "CPNU (actuaciones)",
  publicaciones: "Publicaciones Procesales (estados)",
  samai: "SAMAI (actuaciones CPACA)",
  samai_estados: "SAMAI Estados",
};

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
