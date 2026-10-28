/** Semantics of the PP durable admission/status contract. Never infer success
 * from HTTP 202 or from a returned identifier alone. */
export type DurableVerdict =
  | { kind: 'pending'; runId: string; traceId: string | null; reason: string }
  | { kind: 'complete'; runId: string; traceId: string | null }
  | { kind: 'error'; runId: string | null; traceId: string | null; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function durableVerdict(httpStatus: number, value: unknown, expectedRunId?: string): DurableVerdict {
  const b = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const runId = typeof b.backend_run_id === 'string' && UUID.test(b.backend_run_id) ? b.backend_run_id : null;
  const traceId = typeof b.trazabilidad_id === 'string' ? b.trazabilidad_id : null;
  if (httpStatus < 200 || httpStatus >= 300) {
    const detail = typeof b.detail === 'string' ? `: ${b.detail.slice(0, 200)}` : '';
    return { kind: 'error', runId, traceId, reason: `HTTP ${httpStatus}${detail}` };
  }
  if (!runId || (expectedRunId && runId !== expectedRunId)) {
    return { kind: 'error', runId, traceId, reason: 'PP_RUN_ID_INVALID_OR_MISMATCH' };
  }
  const state = b.estado;
  if (state === 'ADMITIDA' || state === 'EN_CURSO') {
    if (b.consulta_completa === true) return { kind: 'error', runId, traceId, reason: 'PP_RUN_CONTRADICTORY_STATUS' };
    return { kind: 'pending', runId, traceId, reason: 'PP_RUN_PENDING' };
  }
  if (state === 'COMPLETA' && b.consulta_completa === true) return { kind: 'complete', runId, traceId };
  if (state === 'PARCIAL' || state === 'FALLIDA') {
    const cause = typeof b.motivo_parcial === 'string' ? b.motivo_parcial.slice(0, 200) : 'SIN_CAUSA';
    return { kind: 'error', runId, traceId, reason: `PP_RUN_${state}: ${cause}` };
  }
  return { kind: 'error', runId, traceId, reason: 'PP_RUN_INVALID_STATUS' };
}

/** A completed ticket only certifies this matching persisted reader result. */
export function matchingCompletedHistory(runId: string, data: unknown, radicado?: string): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const b = data as Record<string, unknown>;
  return (!radicado || b.radicado === radicado) && b.backend_run_id === runId && b.consulta_completa === true &&
    /^(SUCCESS_EMPTY|SUCCESS_WITH_DATA)$/.test(String(b.run_status ?? '')) &&
    b.persistencia_completa !== false;
}
