import { hasUsableRadicado, judicialQueryState, JUDICIAL_QUERY_LABELS, type JudicialQueryState } from "../monitoring-reason";

export interface SyncCheckRow {
  provider?: string | null;
  status?: string | null;
  error_code?: string | null;
  records_inserted?: number | null;
  records_skipped?: number | null;
}

/** Same predicate the SQL freshness readers use: success + null error + fully attributable provider. */
export function isVerifiedSuccess(row: SyncCheckRow): boolean {
  if ((row.status ?? "").toLowerCase() !== "success") return false;
  if (row.error_code != null) return false;
  const tokens = String(row.provider ?? "").toLowerCase().split(/[+,/|]/).map((t) => t.trim());
  if (tokens.length === 0 || tokens.some((t) => t === "" || t === "unknown" || t === "none")) return false;
  return true;
}

export const UNVERIFIED_LABEL = "Consulta no acreditada: el registro no identifica una fuente consultada verificable";
export const DEDUP_LABEL = "Actualización diaria ya iniciada; se reutiliza el ciclo del día (no es una consulta nueva)";
export const EMPTY_UNVERIFIED_LABEL = "Sin resultados registrados; la cobertura de la consulta no está acreditada";

export function syncCheckState(radicado: string | null | undefined, row: SyncCheckRow): { state: JudicialQueryState; label: string } {
  const compatible = hasUsableRadicado(radicado);
  const status = (row.status ?? "").toLowerCase();
  if (compatible && status === "deduplicated") return { state: "PENDIENTE", label: DEDUP_LABEL };
  // Match the success-only freshness contract. An old empty row can describe
  // a narrow or stored window; it does not certify that the matter is current.
  const successLike = ["success", "success_empty", "empty", "not_found"].includes(status);
  if (compatible && successLike) {
    if (!isVerifiedSuccess(row)) return { state: "PENDIENTE", label:
      status !== "success" && row.error_code == null ? EMPTY_UNVERIFIED_LABEL : UNVERIFIED_LABEL };
  }
  if (compatible && status === "partial") {
    const cause = row.error_code?.trim();
    return { state: "PENDIENTE", label: cause
      ? `Consulta parcial: ${cause}; la cobertura no está acreditada`
      : "Consulta parcial; la cobertura no está acreditada" };
  }
  if (compatible && status === "pending_upstream") return { state: "PENDIENTE", label: "Fuente pendiente; la consulta aún no está completa" };
  const state = judicialQueryState({ compatible, status: row.status, count: (row.records_inserted ?? 0) + (row.records_skipped ?? 0) });
  return { state, label: JUDICIAL_QUERY_LABELS[state] };
}
