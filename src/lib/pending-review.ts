/**
 * pending-review — pure helpers for the Lexy pending-review queue.
 *
 * The queue is fed by work_item_deadlines rows in REQUIERE_REVISION_MANUAL.
 * Rows are per-deadline; the same source event can produce several rows, so
 * the UI counts and lists deduplicated events while acknowledgment always
 * covers every underlying row id.
 */

export interface PendingDeadlineRow {
  id: string;
  work_item_id: string;
  label: string | null;
  deadline_type: string | null;
  trigger_date: string | null;
  work_items?: { id: string; radicado: string | null; title: string | null } | null;
}

export interface DeadlineReviewState {
  deadline_id: string;
  acknowledged_at: string | null;
  snoozed_until: string | null;
}

export interface PendingReviewEvent {
  key: string;
  work_item_id: string;
  radicado: string | null;
  title: string | null;
  label: string | null;
  deadline_type: string | null;
  /** Every row id behind this event — acknowledgment marks them all. */
  ids: string[];
}

/** Identity of the source event: same matter + term type + label. */
export function deadlineEventKey(row: Pick<PendingDeadlineRow, "work_item_id" | "deadline_type" | "label">): string {
  return `${row.work_item_id}|${row.deadline_type ?? ""}|${row.label ?? ""}`;
}

/** Rows still visible to this user: not acknowledged, not snoozed into the future. */
export function visibleDeadlineRows(
  rows: PendingDeadlineRow[],
  states: DeadlineReviewState[],
  now: Date = new Date(),
): PendingDeadlineRow[] {
  const byId = new Map(states.map((s) => [s.deadline_id, s]));
  return rows.filter((row) => {
    const state = byId.get(row.id);
    if (!state) return true;
    if (state.acknowledged_at) return false;
    if (state.snoozed_until && new Date(state.snoozed_until) > now) return false;
    return true;
  });
}

/** Group visible rows into one card per source event, preserving every id. */
export function groupDeadlineEvents(rows: PendingDeadlineRow[]): PendingReviewEvent[] {
  const byKey = new Map<string, PendingReviewEvent>();
  for (const row of rows) {
    const key = deadlineEventKey(row);
    const existing = byKey.get(key);
    if (existing) {
      existing.ids.push(row.id);
      continue;
    }
    byKey.set(key, {
      key,
      work_item_id: row.work_item_id,
      radicado: row.work_items?.radicado ?? null,
      title: row.work_items?.title ?? null,
      label: row.label ?? row.deadline_type ?? null,
      deadline_type: row.deadline_type ?? null,
      ids: [row.id],
    });
  }
  return [...byKey.values()];
}
