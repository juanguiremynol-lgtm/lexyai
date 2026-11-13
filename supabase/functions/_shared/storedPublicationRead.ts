import type { DailyAdmission } from './dailyUpdateGate.ts';
import { matchingCompletedHistory } from './ppDurableContract.ts';

/** A terminal extraction admission can consume a later stored result. An
 * active extraction is never displaced and this path never authorizes POST. */
export function mayReadStoredPP(admission: DailyAdmission, workflow: string): boolean {
  return workflow !== 'CPACA' && admission.reason === 'DAILY_UPDATE_ALREADY_STARTED'
    && ['DONE', 'PARTIAL', 'FAILED', 'PENDING_UPSTREAM'].includes(String(admission.existing?.status));
}

interface StoredRead {
  runStatusRead?: { run_id: string; http_status: number | null; body: unknown; polled_at: string };
  historicoRead?: { http_status: number | null; body: unknown };
  error?: string;
}

/** Save only bounded evidence returned by this read, never case text or credentials.
 * Identifiers from an unrelated response must never be attributed to this matter. */
export function storedReadEvidence(read: StoredRead, radicado: string) {
  const record = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v) ? v : null;
  const code = (v: unknown) => typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(v) ? v : null;
  const day = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const run = read.runStatusRead;
  const history = read.historicoRead;
  const body = record(run ? run.body : history?.body);
  const requested = uuid(run?.run_id);
  const observed = uuid(body.backend_run_id);
  const matched = body.radicado === radicado && !!observed && (!run || requested === observed);
  const info = {
    backend_run_id: requested ?? (matched ? observed : null),
    reason: read.error ?? 'PP_CERTIFICATE_NOT_VALID_FOR_CURRENT_WINDOW',
    endpoint: run ? 'run_status' : history ? 'historico' : null,
    http_status: run ? run.http_status : history?.http_status ?? null,
    polled_at: run?.polled_at ?? null,
    identity_match: matched,
  };
  if (!matched) return info;
  const checkpoint = record(body.checkpoint);
  const subset = (value: unknown) => {
    if (!Array.isArray(value)) return null;
    const ids = [...new Set(value.map(v => record(v).article_id ?? v)
      .filter(v => (typeof v === 'string' || typeof v === 'number') && /^\d{1,22}$/.test(String(v))).map(String))];
    return { count: value.length, article_ids: ids.slice(0, 20), ids_truncated: ids.length > 20 };
  };
  return { ...info, trace_id: uuid(body.trazabilidad_id), status: code(body.estado ?? body.run_status),
    cause: code(body.motivo_parcial), persistence_complete: typeof body.persistencia_completa === 'boolean' ? body.persistencia_completa : null,
    checkpoint: { from: day(checkpoint.desde), until: day(checkpoint.hasta), next: day(checkpoint.siguiente_desde),
      completed_articles: count(checkpoint.articulos_con_checkpoint_persistido), processing_articles: count(checkpoint.articulos_en_progreso) },
    detected_events: count(body.eventos_detectados), estimated_states: count(body.total_estimado),
    date_revalidation: subset(body.publication_dates_requiring_revalidation),
    metadata_observations: subset(body.publication_metadata_observations),
    negative_variants: subset(body.publication_variant_negative_evidence),
  };
}

/** Require the actual persisted, identified reader certificate for today's
 * requested public window. A retained feed or a successful HTTP code is not it. */
export function certifiedStoredPPHistory(result: unknown, radicado: string, day: string | undefined,
  now = Date.now()): Record<string, unknown> | null {
  if (!result || typeof result !== 'object' || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const record = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  const r = record(result);
  const b = record(record(r?.historicoRead)?.body);
  const window = record(b?.ventana_solicitada);
  const id = b?.backend_run_id;
  if (r?.ok !== true || !b || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)
    || !matchingCompletedHistory(id, b, radicado) || b.persistencia_completa !== true) return null;
  const observed = b.intento_observado_en;
  const clock = typeof observed === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(observed) ? Date.parse(observed) : NaN;
  const floorTime = Date.parse(day + 'T00:00:00Z') - 14 * 86400_000;
  if (!Number.isFinite(clock) || !Number.isFinite(floorTime) || clock > now + 60_000 || now - clock > 86400_000
    || new Date(clock - 5 * 3600_000).toISOString().slice(0, 10) !== day
    || window?.hasta !== day || typeof window?.desde !== 'string'
    || window.desde > new Date(floorTime).toISOString().slice(0, 10)) return null;
  return b;
}
