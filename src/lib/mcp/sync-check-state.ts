import { hasUsableRadicado, judicialQueryState, JUDICIAL_QUERY_LABELS, type JudicialQueryState } from "../monitoring-reason";

export interface SyncCheckRow {
  provider?: string | null;
  status?: string | null;
  error_code?: string | null;
  records_inserted?: number | null;
  records_skipped?: number | null;
  metadata?: unknown;
}

function attributed(row: SyncCheckRow): boolean {
  if (row.error_code != null) return false;
  const tokens = String(row.provider ?? "").toLowerCase().split(/[+,/|]/).map((t) => t.trim());
  return tokens.length > 0 && !tokens.some((t) => t === "" || t === "unknown" || t === "none");
}

export function sourceEvidence(row: SyncCheckRow) {
  const m = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown> : {};
  const value = typeof m.source_observed_at === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(m.source_observed_at)
    ? m.source_observed_at : null;
  const time = value ? Date.parse(value) : NaN;
  const validTime = Number.isFinite(time) && time <= Date.now() + 60_000;
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", {timeZone:"America/Bogota"}).format(date);
  return {consulta_completa: m.source_complete === true,
    fuente_observada_en: validTime ? value : null,
    observacion_de_hoy: validTime && day(new Date(time)) === day(new Date()),
    lectura_almacenada: m.reused_completed_read === true,
    consulta_nueva: typeof m.source_query_attempted === "boolean" ? m.source_query_attempted : null};
}

/** A successful source result must include a complete scope and a real observation time. */
export function isVerifiedSuccess(row: SyncCheckRow): boolean {
  const evidence = sourceEvidence(row);
  return ["success", "empty"].includes((row.status ?? "").toLowerCase()) && attributed(row)
    && evidence.consulta_completa && evidence.fuente_observada_en !== null && evidence.observacion_de_hoy;
}

/** Preserve the raw database history, but do not expose an unverified result
 * to agents with a success-shaped status. */
export function publicCheckStatus(row: SyncCheckRow): string | null {
  return ["success", "empty"].includes((row.status ?? "").toLowerCase()) && !isVerifiedSuccess(row)
    ? "unverified" : row.status ?? null;
}

export const UNVERIFIED_LABEL = "Consulta no acreditada: el registro no identifica una fuente consultada verificable";
export const DEDUP_LABEL = "Actualización diaria ya iniciada; se reutiliza el ciclo del día (no es una consulta nueva)";
export const EMPTY_UNVERIFIED_LABEL = "Sin resultados registrados; la cobertura de la consulta no está acreditada";
export const PROVIDER_UNRESOLVED_LABEL = "No se pudo identificar el proveedor consultado; la consulta no está acreditada (PROVIDER_UNRESOLVED)";
export const COVERAGE_UNVERIFIED_LABEL = "La fuente o el alcance de la consulta no están acreditados; no se puede confirmar que el asunto esté actualizado";

export function syncCheckState(radicado: string | null | undefined, row: SyncCheckRow): { state: JudicialQueryState; label: string } {
  const compatible = hasUsableRadicado(radicado);
  const status = (row.status ?? "").toLowerCase();
  if (compatible && row.error_code === "PP_STORED_READ_INCOMPLETE") return { state: "PENDIENTE", label:
    "La lectura almacenada de Publicaciones Procesales está incompleta; la vigilancia diaria no está acreditada" };
  if (compatible && status === "deduplicated") return { state: "PENDIENTE", label: DEDUP_LABEL };
  if (compatible && row.error_code === "PROVIDER_UNRESOLVED") return { state: "PENDIENTE", label: PROVIDER_UNRESOLVED_LABEL };
  if (compatible && row.error_code === "PROVIDER_NOT_FOUND") return { state: "PENDIENTE", label:
    "El proveedor no encontró el expediente; esto no demuestra que no exista (PROVIDER_NOT_FOUND)" };
  if (compatible && row.error_code === "PP_DAILY_WINDOW_NOT_CERTIFIED") return { state: "PENDIENTE", label:
    "La consulta no acredita la ventana diaria de Publicaciones Procesales; se conservan los registros anteriores" };
  if (compatible && row.error_code === "SAMAI_INVENTORY_INCOMPLETE") return { state: "PENDIENTE", label:
    "SAMAI no acreditó un inventario completo de estados; hay resultados pendientes de verificación" };
  if (compatible && row.error_code === "PP_NATIVE_DATE_CONFLICT") return { state: "PENDIENTE", label:
    "La fecha de la publicación entra en conflicto con un registro anterior y requiere revisión" };
  // An old, empty, or stored row is not a current coverage certificate merely
  // because an attributable provider returned it.
  const successLike = ["success", "success_empty", "empty", "not_found"].includes(status);
  if (compatible && successLike) {
    if (!attributed(row)) return { state: "PENDIENTE", label: UNVERIFIED_LABEL };
    const evidence = sourceEvidence(row);
    if (!isVerifiedSuccess(row)) return { state: "PENDIENTE", label:
      evidence.consulta_completa && evidence.fuente_observada_en && !evidence.observacion_de_hoy
        ? `La fuente se observó el ${evidence.fuente_observada_en}; la vigilancia de hoy no está acreditada.`
        : status !== "success" ? EMPTY_UNVERIFIED_LABEL : COVERAGE_UNVERIFIED_LABEL };
    if (evidence.lectura_almacenada) return {
      state: status === "empty" ? "SIN_NOVEDADES" : "CON_RESULTADOS",
      label: `Lectura almacenada completa; fuente observada el ${evidence.fuente_observada_en}. No es una consulta nueva.`,
    };
  }
  if (compatible && status === "partial") {
    const cause = row.error_code?.trim();
    return { state: "PENDIENTE", label: cause
      ? `Consulta parcial: ${cause}; la cobertura no está acreditada`
      : "Consulta parcial; la cobertura no está acreditada" };
  }
  if (compatible && status === "pending_upstream") return { state: "PENDIENTE", label: "Fuente pendiente; la consulta aún no está completa" };
  if (compatible && status === "skipped" && row.error_code) return { state: "PENDIENTE", label: "Consulta no realizada; revisa la causa registrada" };
  const state = judicialQueryState({ compatible, status: row.status, count: (row.records_inserted ?? 0) + (row.records_skipped ?? 0) });
  return { state, label: JUDICIAL_QUERY_LABELS[state] };
}
