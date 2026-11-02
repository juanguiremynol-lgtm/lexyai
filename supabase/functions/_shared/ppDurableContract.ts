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

/** An implicit historical caller may consume a separately certified daily
 * window. This never completes or erases the historical caller's own range. */
export function completedDailyReference(data: unknown, radicado: string, now = Date.now()): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const parent = data as Record<string, any>;
  const daily = parent.consulta_diaria;
  if (parent.radicado !== radicado || !daily || typeof daily !== 'object' ||
      daily.radicado !== radicado || daily.tipo_cobertura !== 'RECIENTE' ||
      daily.alcance_efectivo_acreditado !== true) return null;
  const day = new Date(now - 5 * 3600_000).toISOString().slice(0, 10);
  const floor = new Date(Date.parse(day + 'T00:00:00Z') - 14 * 86400_000).toISOString().slice(0, 10);
  if (daily.checkpoint?.hasta !== day || typeof daily.checkpoint?.desde !== 'string' || daily.checkpoint.desde > floor ||
      durableVerdict(200, daily, daily.backend_run_id).kind !== 'complete') return null;
  return daily;
}

/** Partial source coverage may still deliver already persisted positive rows.
 * This permits a stored GET, never certifies coverage or starts a new scrape. */
export function mayReadPartialHistory(data: unknown, radicado: string, runId: string): boolean {
  if (!data || typeof data !== 'object' || !UUID.test(runId) || !/^\d{23}$/.test(radicado)) return false;
  const b = data as Record<string, unknown>;
  const observed = Date.parse(String(b.intento_observado_en ?? ''));
  return b.backend_run_id === runId && b.radicado === radicado && b.consulta_completa === false &&
    (b.estado === 'PARCIAL' || b.estado === 'ADMITIDA') && Number.isFinite(observed) && observed <= Date.now() + 60_000 &&
    (Number(b.backend_new_events ?? 0) > 0 || Number(b.eventos_detectados ?? 0) > 0);
}

/** Identity and persistence are mandatory even when no completeness is claimed.
 * Return the accepted native rows plus explicit rejected indices; the original
 * reader body stays in the trace. Historical rows retain their own dates. */
export function matchingPartialHistory(data: unknown, radicado: string, runId: string) {
  if (!data || typeof data !== 'object') return null;
  const b = data as Record<string, any>;
  if (b.backend_run_id !== runId || b.radicado !== radicado || b.consulta_completa !== false ||
      b.persistencia_completa !== true || !Number.isFinite(Date.parse(String(b.intento_observado_en ?? '')))) return null;
  const rows = Array.isArray(b.actuaciones) ? b.actuaciones : Array.isArray(b.publicaciones) ? b.publicaciones : null;
  if (!rows) return null;
  const rejected: number[] = [];
  const accepted = rows.filter((row: any, i: number) => {
    const a = row?.documento_atribucion;
    const pages = a?.paginas_fuente ?? a?.paquete?.paginas_caso ?? row?.paquete?.paginas_caso;
    const validPages = (v: unknown): boolean => Array.isArray(v) && v.length > 0 &&
      v.every((x) => typeof x === 'number' ? Number.isInteger(x) && x > 0 :
        Array.isArray(x) && x.length === 2 && x.every((n) => Number.isInteger(n) && n > 0) && x[1] >= x[0]);
    const exactRad = a?.radicado === radicado && (!a?.paquete?.radicado || a.paquete.radicado === radicado);
    const nativeArticle = /^\d+$/.test(String(row?.estado?.article_id ?? ''));
    const ok = exactRad && nativeArticle && validPages(pages);
    if (!ok) rejected.push(i);
    return ok;
  });
  return { body: { ...b, actuaciones: accepted, ...(Array.isArray(b.publicaciones) ? { publicaciones: accepted } : {}) },
    accepted: accepted.length, rejected, sourceObservedAt: String(b.intento_observado_en) };
}
