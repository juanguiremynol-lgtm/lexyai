/**
 * Pure builders for insert_notification arguments used by scheduled-alert-evaluator.
 * p_metadata is jsonb in SQL: always pass a plain object, never JSON.stringify
 * (a string becomes a jsonb scalar and `p_metadata - 'html'` raises
 * "cannot delete from scalar").
 */
export function buildDedupeKey(kind: string, entityId: string, bucket?: string): string {
  return bucket ? `${kind}:${entityId}:${bucket}` : `${kind}:${entityId}`;
}

export interface HearingInput {
  id: string; title: string; location: string | null; is_virtual: boolean;
  scheduled_at: string; work_item_id: string | null;
}

export function hearingNotificationArgs(h: HearingInput, userId: string, bracket: string, hoursUntil: number, hourBucket: string) {
  return {
    p_audience_scope: "USER",
    p_user_id: userId,
    p_category: "WORK_ITEM_ALERTS",
    p_type: "AUDIENCIA_PROXIMA",
    p_title: `Audiencia próxima: ${h.title}`,
    p_body: `En ${hoursUntil}h — ${h.location || (h.is_virtual ? "Virtual" : "Sin ubicación")}`,
    p_severity: bracket === "1h" ? "critical" : bracket === "24h" ? "warning" : "info",
    p_metadata: { hearing_id: h.id, scheduled_at: h.scheduled_at, hours_until: hoursUntil, bracket },
    p_dedupe_key: buildDedupeKey("hearing_reminder", h.id, `${bracket}:${hourBucket}`),
    p_deep_link: h.work_item_id ? `/app/work-items/${h.work_item_id}` : "/app/hearings",
    p_work_item_id: h.work_item_id,
  };
}

export interface TaskInput {
  id: string; owner_id: string; assigned_to: string | null; title: string;
  due_date: string; work_item_id: string; priority: string | null;
}

export function taskNotificationArgs(t: TaskInput, daysPast: number, today: string) {
  return {
    p_audience_scope: "USER",
    p_user_id: t.assigned_to || t.owner_id,
    p_category: "WORK_ITEM_ALERTS",
    p_type: "TAREA_VENCIDA",
    p_title: `Tarea vencida: ${t.title}`,
    p_body: `Vencida hace ${daysPast} día(s) — Prioridad: ${t.priority || "MEDIA"}`,
    p_severity: daysPast >= 3 ? "critical" : "warning",
    p_metadata: { task_id: t.id, due_date: t.due_date, days_past: daysPast, priority: t.priority },
    p_dedupe_key: buildDedupeKey("task_overdue", t.id, today),
    p_deep_link: `/app/work-items/${t.work_item_id}`,
    p_work_item_id: t.work_item_id,
  };
}

export function taskOwnerNotificationArgs(t: TaskInput, daysPast: number, today: string) {
  return {
    p_audience_scope: "USER",
    p_user_id: t.owner_id,
    p_category: "WORK_ITEM_ALERTS",
    p_type: "TAREA_VENCIDA",
    p_title: `Tarea vencida: ${t.title}`,
    p_body: `Vencida hace ${daysPast} día(s) — Asignada a otro usuario`,
    p_severity: daysPast >= 3 ? "critical" : "warning",
    p_metadata: { task_id: t.id, due_date: t.due_date, days_past: daysPast, assigned_to: t.assigned_to },
    p_dedupe_key: buildDedupeKey("task_overdue", t.id, today),
    p_deep_link: `/app/work-items/${t.work_item_id}`,
    p_work_item_id: t.work_item_id,
  };
}

/**
 * Observability: insert_notification returns void and may skip the insert
 * (preferences/dedupe), so an accepted RPC is NOT a created alert. This
 * function sends no email: email counters stay 0 for consumer compatibility.
 */
export function buildEmailStats(r: { evaluated: number; accepted: number; failed: number }) {
  return {
    pending_alerts: r.evaluated,
    notification_requests_accepted: r.accepted,
    notification_requests_failed: r.failed,
    emails_sent: 0,
    emails_failed: 0,
  };
}
