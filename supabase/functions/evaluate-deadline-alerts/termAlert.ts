// deno-lint-ignore-file no-explicit-any
/**
 * One live alert per deadline. Re-evaluations update that row and append to
 * payload.escalation_history when the milestone / type / severity changes.
 * Pure over a tiny store port so idempotency is testable without a database.
 */
export const LIVE_STATUSES = ["PENDING", "SENT", "ACKNOWLEDGED"];

export interface TermAlertStore {
  findByDeadline(deadlineId: string): Promise<any[]>;
  insert(row: Record<string, unknown>): Promise<{ message: string } | null>;
  update(id: string, patch: Record<string, unknown>): Promise<{ message: string } | null>;
}

export type TermAlertOutcome = "inserted" | "updated" | "error" | "closed_by_lawyer" | "muted_by_preference";

export async function upsertTermAlertCore(db: TermAlertStore, args: {
  deadlineId: string;
  ownerId: string;
  organizationId: string | null;
  workItemId: string;
  alertType: string;
  severity: string;
  title: string;
  message: string | null;
  payload: Record<string, unknown>;
  allowInsert?: boolean;
}, now: Date = new Date()): Promise<{ outcome: TermAlertOutcome; superseded: number }> {
  const fingerprint = `deadline_TERM_${args.deadlineId}`;
  const all = await db.findByDeadline(args.deadlineId);
  const rows = all.filter((r) => LIVE_STATUSES.includes(r.status));
  // Closed by the lawyer: never resurrected as a new row.
  if (rows.length === 0 && all.some((r) => ["RESOLVED", "DISMISSED", "CANCELLED"].includes(r.status))) {
    return { outcome: "closed_by_lawyer", superseded: 0 };
  }
  if (rows.length === 0 && args.allowInsert === false) return { outcome: "muted_by_preference", superseded: 0 };
  if (rows.length === 0) {
    const err = await db.insert({
      owner_id: args.ownerId,
      organization_id: args.organizationId,
      entity_id: args.workItemId,
      entity_type: "WORK_ITEM",
      severity: args.severity,
      alert_type: args.alertType,
      title: args.title,
      message: args.message,
      status: "PENDING",
      fingerprint,
      payload: {
        ...args.payload,
        escalation_history: [{
          at: now.toISOString(), to_bucket: (args.payload as any)?.bucket ?? null,
          to_alert_type: args.alertType, to_severity: args.severity,
        }],
      },
    });
    if (err) {
      if ((err.message || "").includes("duplicate")) return { outcome: "updated", superseded: 0 };
      console.error("[evaluate-deadline-alerts:insert]", err);
      return { outcome: "error", superseded: 0 };
    }
    return { outcome: "inserted", superseded: 0 };
  }

  const keep = rows[0];
  const history = Array.isArray(keep.payload?.escalation_history) ? keep.payload.escalation_history : [];
  const prevBucket = keep.payload?.bucket ?? null;
  const nextBucket = (args.payload as any)?.bucket ?? null;
  const changed = keep.alert_type !== args.alertType || keep.severity !== args.severity || prevBucket !== nextBucket;
  const nextHistory = changed
    ? [...history, {
        at: now.toISOString(), from_bucket: prevBucket, to_bucket: nextBucket,
        from_alert_type: keep.alert_type, from_severity: keep.severity,
        to_alert_type: args.alertType, to_severity: args.severity,
      }].slice(-10)
    : history;

  const upErr = await db.update(keep.id, {
    alert_type: args.alertType,
    severity: args.severity,
    title: args.title,
    message: args.message,
    fingerprint,
    payload: { ...args.payload, escalation_history: nextHistory },
  });
  if (upErr) {
    console.error("[evaluate-deadline-alerts:update]", upErr);
    return { outcome: "error", superseded: 0 };
  }
  let superseded = 0;
  for (const extra of rows.slice(1)) {
    await db.update(extra.id, { status: "SUPERSEDED" });
    superseded++;
  }
  return { outcome: "updated", superseded };
}

/**
 * Colombian business days (weekends + holidays) between today and the
 * deadline, delegated to the engine's authoritative SQL calendar
 * (public.business_days_between_sql). Negative when overdue. No JS calendar.
 */
export type BdRpc = (a: string, b: string) => Promise<number | null>;
export async function businessDaysRemaining(rpc: BdRpc, todayIso: string, deadlineIso: string): Promise<number | null> {
  if (deadlineIso === todayIso) return 0;
  if (deadlineIso > todayIso) return await rpc(todayIso, deadlineIso);
  const n = await rpc(deadlineIso, todayIso);
  return n === null ? null : -n;
}

export type TermBucket = "D-8" | "D-3" | "D-1" | "D-DAY" | "OVERDUE";
/** Real milestones supported by the evaluator: 8/3/1/0 business days + overdue. */
export function bucketFor(bd: number): TermBucket | null {
  if (bd < 0) return "OVERDUE";
  if (bd === 0) return "D-DAY";
  if (bd === 1) return "D-1";
  if (bd <= 3) return "D-3";
  if (bd <= 8) return "D-8";
  return null;
}

/** Manual-review notice: INFO, own type, no provisional date, no urgency. */
export const MANUAL_REVIEW_ALERT_TYPE = "TERMINO_REVISION_MANUAL";
export const TERM_ALERT_TYPES = ["TERMINO_CRITICO", "TERMINO_POR_VENCER", "TERMINO_VENCIDO", MANUAL_REVIEW_ALERT_TYPE];
