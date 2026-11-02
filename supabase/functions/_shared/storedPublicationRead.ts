import type { DailyAdmission } from './dailyUpdateGate.ts';
import { matchingCompletedHistory } from './ppDurableContract.ts';

/** A terminal extraction admission can consume a later stored result. An
 * active extraction is never displaced and this path never authorizes POST. */
export function mayReadStoredPP(admission: DailyAdmission, workflow: string): boolean {
  return workflow !== 'CPACA' && admission.reason === 'DAILY_UPDATE_ALREADY_STARTED'
    && ['DONE', 'PARTIAL', 'FAILED', 'PENDING_UPSTREAM'].includes(String(admission.existing?.status));
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