/**
 * A successful continuation is a stage verdict, not a certificate for the
 * daily chain. The ledger has no per-item confirmation for dispatched work,
 * so fail closed until a separate reconciliation proves those outcomes.
 */
export interface DailySyncChainRow {
  status?: unknown;
  chain_id?: unknown;
  is_continuation?: unknown;
  finished_at?: unknown;
  expected_total_items?: unknown;
  items_succeeded?: unknown;
  items_failed?: unknown;
  items_skipped?: unknown;
  dead_letter_count?: unknown;
  timeout_count?: unknown;
  metadata?: unknown;
}

export interface DailySyncChainEvidence {
  supported: boolean;
  scope: "SELECTED_ACTUACIONES_ONLY";
  reasons: string[];
  explanations: string[];
  dispatched_attempts: number | null;
  excluded_tracker_entries: number | null;
}

const EXPLANATIONS: Record<string, string> = {
  NO_LEDGER: "No hay una ejecución diaria registrada.",
  CHAIN_IDENTITY_UNVERIFIED: "Las etapas no identifican de forma inequívoca una sola cadena.",
  INITIAL_STAGE_UNVERIFIED: "No se identificó una única etapa inicial.",
  LAST_STAGE_NOT_FINISHED_SUCCESS: "La última etapa no terminó con éxito.",
  TARGET_COUNT_UNVERIFIED: "No se conoce un número positivo de asuntos seleccionados.",
  STAGE_NOT_SUCCESS_OR_PARTIAL: "Hay una etapa fallida, abierta o desconocida.",
  STAGE_COUNTS_UNVERIFIED: "Faltan contadores válidos de una o más etapas.",
  FAILED_ITEMS: "Hay asuntos con fallos registrados en la cadena.",
  SKIPPED_ITEMS: "Hay asuntos omitidos que requieren conciliación.",
  NEW_DEAD_LETTERS: "La ejecución registró asuntos en cola de fallos.",
  TIMEOUTS: "La cadena registró tiempos de espera sin conciliación en este indicador.",
  DISPATCH_OR_EXCLUSION_UNKNOWN: "Falta evidencia de los despachos o de las exclusiones.",
  DISPATCHED_NOT_RECONCILED: "Se despacharon consultas cuyo resultado no se concilia en este indicador.",
  DEAD_LETTER_TRACKERS_EXCLUDED: "El programador excluyó registros de fallos; su cantidad puede incluir asuntos inactivos.",
  TARGET_NOT_ACCOUNTED_FOR: "Los éxitos contabilizados no cubren el total seleccionado inicialmente.",
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function assessDailySyncChain(rows: readonly DailySyncChainRow[]): DailySyncChainEvidence {
  const reasons = new Set<string>();
  if (rows.length === 0) {
    return { supported: false, scope: "SELECTED_ACTUACIONES_ONLY", reasons: ["NO_LEDGER"],
      explanations: [EXPLANATIONS.NO_LEDGER], dispatched_attempts: null, excluded_tracker_entries: null };
  }

  const last = rows[rows.length - 1];
  const chainIds = new Set(rows.map((row) => row.chain_id));
  if (chainIds.size !== 1 || typeof rows[0].chain_id !== "string" || !rows[0].chain_id) {
    reasons.add("CHAIN_IDENTITY_UNVERIFIED");
  }
  const firstRows = rows.filter((row) => row.is_continuation === false);
  if (firstRows.length !== 1 || firstRows[0] !== rows[0]) reasons.add("INITIAL_STAGE_UNVERIFIED");
  if (last.status !== "SUCCESS" || typeof last.finished_at !== "string" || !last.finished_at) {
    reasons.add("LAST_STAGE_NOT_FINISHED_SUCCESS");
  }

  const expected = count(firstRows[0]?.expected_total_items);
  if (expected === null || expected === 0) reasons.add("TARGET_COUNT_UNVERIFIED");
  let succeeded = 0;
  let dispatchedTotal = 0;
  let excludedMax = 0;
  let metadataComplete = true;
  for (const row of rows) {
    if (row.status !== "SUCCESS" && row.status !== "PARTIAL") reasons.add("STAGE_NOT_SUCCESS_OR_PARTIAL");
    const values = [row.items_succeeded, row.items_failed, row.items_skipped,
      row.dead_letter_count, row.timeout_count].map(count);
    if (values.some((value) => value === null)) reasons.add("STAGE_COUNTS_UNVERIFIED");
    const [ok, failed, skipped, dead, timedOut] = values;
    succeeded += ok ?? 0;
    if ((failed ?? 0) > 0) reasons.add("FAILED_ITEMS");
    if ((skipped ?? 0) > 0) reasons.add("SKIPPED_ITEMS");
    if ((dead ?? 0) > 0) reasons.add("NEW_DEAD_LETTERS");
    if ((timedOut ?? 0) > 0) reasons.add("TIMEOUTS");

    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown> : {};
    const dispatched = count(metadata.items_dispatched);
    const excluded = count(metadata.dead_lettered_excluded);
    if (dispatched === null || excluded === null) {
      reasons.add("DISPATCH_OR_EXCLUSION_UNKNOWN");
      metadataComplete = false;
    }
    dispatchedTotal += dispatched ?? 0;
    excludedMax = Math.max(excludedMax, excluded ?? 0);
    if ((dispatched ?? 0) > 0) reasons.add("DISPATCHED_NOT_RECONCILED");
    if ((excluded ?? 0) > 0) reasons.add("DEAD_LETTER_TRACKERS_EXCLUDED");
  }
  if (expected !== null && expected > 0 && succeeded !== expected) reasons.add("TARGET_NOT_ACCOUNTED_FOR");
  const codes = [...reasons];
  return { supported: codes.length === 0, scope: "SELECTED_ACTUACIONES_ONLY", reasons: codes,
    explanations: codes.map((code) => EXPLANATIONS[code]),
    dispatched_attempts: metadataComplete ? dispatchedTotal : null,
    excluded_tracker_entries: metadataComplete ? excludedMax : null };
}
