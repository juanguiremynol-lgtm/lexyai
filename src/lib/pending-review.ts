/**
 * pending-review — pure helpers for the Lexy pending-review queue.
 *
 * The queue is fed by work_item_deadlines rows in REQUIERE_REVISION_MANUAL.
 * Event identity is semantic and matches public.deadline_event_key:
 * matter + rule + trigger event + bound party + trigger date + source event.
 * It never uses the row id or technical timestamps, so a resynced copy of the
 * SAME event keeps the user's acknowledgment, while a material change (new
 * date, rule, party or source event) produces a new key and re-notifies.
 */

export interface PendingDeadlineRow {
  id: string;
  work_item_id: string;
  label: string | null;
  deadline_type: string | null;
  trigger_date: string | null;
  trigger_event?: string | null;
  bound_party_role?: string | null;
  source_event_id?: string | null;
  work_items?: { id: string; radicado: string | null; title: string | null } | null;
}

export interface DeadlineReviewState {
  deadline_id: string;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  event_key?: string | null;
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

/**
 * Semantic identity of the source event. MUST stay in sync with
 * public.deadline_event_key (see migration 0052): same fields, same order,
 * same pipe separator, empty string for nulls.
 */
export function deadlineEventKey(
  row: Pick<
    PendingDeadlineRow,
    "work_item_id" | "deadline_type" | "trigger_event" | "bound_party_role" | "trigger_date" | "source_event_id"
  >,
): string {
  return [
    row.work_item_id,
    row.deadline_type ?? "",
    row.trigger_event ?? "",
    row.bound_party_role ?? "",
    row.trigger_date ?? "",
    row.source_event_id ?? "",
  ].join("|");
}

/**
 * Rows still visible to this user: not acknowledged, not snoozed into the
 * future. A state row matches either by deadline_id (legacy) or by semantic
 * event key, so a new row id for an already-acknowledged event stays hidden.
 */
export function visibleDeadlineRows(
  rows: PendingDeadlineRow[],
  states: DeadlineReviewState[],
  now: Date = new Date(),
): PendingDeadlineRow[] {
  const byId = new Map(states.map((s) => [s.deadline_id, s]));
  const byKey = new Map(states.filter((s) => s.event_key).map((s) => [s.event_key as string, s]));
  const hidden = (state: DeadlineReviewState | undefined): boolean => {
    if (!state) return false;
    if (state.acknowledged_at) return true;
    if (state.snoozed_until && new Date(state.snoozed_until) > now) return true;
    return false;
  };
  return rows.filter((row) => !hidden(byId.get(row.id)) && !hidden(byKey.get(deadlineEventKey(row))));
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
