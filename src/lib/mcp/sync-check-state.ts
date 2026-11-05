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

export function syncCheckState(radicado: string | null | undefined, row: SyncCheckRow): { state: JudicialQueryState; label: string } {
  const compatible = hasUsableRadicado(radicado);
  const status = (row.status ?? "").toLowerCase();
  if (compatible && status === "deduplicated") return { state: "PENDIENTE", label: DEDUP_LABEL };
  const successLike = status === "success" || status === "empty";
  if (compatible && successLike) {
    const verifiedEmpty = status === "empty" && row.error_code == null && isVerifiedSuccess({ ...row, status: "success" });
    if (!isVerifiedSuccess(row) && !verifiedEmpty) return { state: "PENDIENTE", label: UNVERIFIED_LABEL };
  }
  const state = judicialQueryState({ compatible, status: row.status, count: (row.records_inserted ?? 0) + (row.records_skipped ?? 0) });
  return { state, label: JUDICIAL_QUERY_LABELS[state] };
}
