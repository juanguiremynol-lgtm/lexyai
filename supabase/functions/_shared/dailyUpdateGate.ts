/**
 * One logical update per owner + work item per Bogotá calendar day.
 * Channels ('acts', 'pubs') are sub-jobs of that single update: each is
 * admitted at most once per day by public.admit_daily_update (atomic row lock,
 * server-computed day, owner read from work_items). Repeated or concurrent
 * callers — cron, supervisor, watchdog, retries, manual, force — receive the
 * existing cycle state instead of a new extraction. There is no bypass.
 */
export type DailyChannel = 'acts' | 'pubs';
export const DAILY_DUPLICATE_CODE = 'DAILY_UPDATE_ALREADY_STARTED';

export interface DailyAdmission {
  admitted: boolean;
  mode?: 'new' | 'continuation';
  reason?: string;
  run_date?: string;
  channel?: DailyChannel;
  token?: string;
  existing?: Record<string, unknown>;
  next_eligible_at?: string;
}

export async function admitDailyUpdate(db: any, workItemId: string, channel: DailyChannel, req: Request,
  traceId: string, continuation = false): Promise<DailyAdmission> {
  const { data, error } = await db.rpc('admit_daily_update', {
    _work_item_id: workItemId, _channel: channel,
    _invoker: req.headers.get('x-invoker-function') ?? (continuation ? 'continuation' : null),
    _trace_id: traceId, _retry_task_id: req.headers.get('x-retry-task-id'), _continuation: continuation,
  });
  // Fail closed: without a durable admission no extraction starts.
  if (error || !data) return { admitted: false, reason: 'DAILY_ADMISSION_UNAVAILABLE' };
  return data as DailyAdmission;
}

/** Ingestion of an existing durable CPNU job result. Admitted only when the
 *  job is the matter's current IN_PROGRESS job AND bound to the acts admission
 *  that started it (any age: identity, not date). Never opens a new update. */
export async function admitCpnuContinuation(db: any, workItemId: string, jobId: unknown, traceId: string): Promise<DailyAdmission> {
  if (typeof jobId !== 'string' || jobId.length === 0) return { admitted: false, reason: 'JOB_ID_REQUIRED' };
  const { data, error } = await db.rpc('admit_cpnu_continuation', { _work_item_id: workItemId, _job_id: jobId, _trace_id: traceId });
  if (error || !data) return { admitted: false, reason: 'DAILY_ADMISSION_UNAVAILABLE' };
  return data as DailyAdmission;
}

/** Restrict a continuation to ingestion of the stored CPNU result: no /buscar,
 *  no forced refresh, no SAMAI/external/fallback, no orchestrator. */
export function continuationProviders(enabled: Set<string>): Set<string> {
  return new Set(enabled.has('cpnu') ? ['cpnu'] : []);
}

/** Body returned instead of a new extraction. Not success, not a failure:
 *  callers must defer without consuming attempts. */
export function dailyDuplicateBody(workItemId: string, traceId: string, a: DailyAdmission) {
  const unavailable = a.reason === 'DAILY_ADMISSION_UNAVAILABLE';
  return {
    ok: false, deduplicated: !unavailable, status: 'DAILY_LIMIT', work_item_id: workItemId,
    code: unavailable ? 'DAILY_ADMISSION_UNAVAILABLE' : DAILY_DUPLICATE_CODE,
    result_code: unavailable ? 'DAILY_ADMISSION_UNAVAILABLE' : DAILY_DUPLICATE_CODE,
    daily_update: { admitted: false, reason: a.reason, run_date: a.run_date, channel: a.channel,
      existing: a.existing ?? null, next_eligible_at: a.next_eligible_at ?? null },
    inserted_count: 0, skipped_count: 0, errors: [], warnings: [], trace_id: traceId,
  };
}

/** Seconds until the next Bogotá day, used to defer queued work. */
export function secondsUntil(iso: string | null | undefined, fallback = 3600): number {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? Math.max(60, Math.ceil((t - Date.now()) / 1000) + 60) : fallback;
}

/** Map a timeline status to the channel's terminal evidence. */
export function dailyChannelStatus(timelineStatus: string): string {
  switch (timelineStatus) {
    case 'success': case 'empty': return 'DONE';
    case 'pending_upstream': case 'skipped': return 'PENDING_UPSTREAM';
    case 'partial': return 'PARTIAL';
    default: return 'FAILED';
  }
}

/** Admission held per request so the timeline wrapper can seal it without
 *  echoing the fencing token in response bodies. */
const admissions = new WeakMap<Request, DailyAdmission>();
export function rememberAdmission(req: Request, a: DailyAdmission) { if (a.admitted && a.mode === 'new') admissions.set(req, a); }
export function takeAdmission(req: Request): DailyAdmission | undefined { const a = admissions.get(req); admissions.delete(req); return a; }
