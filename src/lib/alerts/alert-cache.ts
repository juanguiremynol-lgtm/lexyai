/**
 * Shared React Query cache helpers for alert management.
 * Every surface that lists or counts alert_instances must be reconciled here.
 */
import type { QueryClient } from "@tanstack/react-query";

/** Query keys of every list/counter that shows alert_instances. */
export const ALERT_LIST_KEYS = [
  ["alert_instances"],
  ["alerts-by-type"],
  ["alert-instances-notifications"],
] as const;
export const ALERT_COUNT_KEYS = [["unread-alert-count"], ["hoy-counts"]] as const;

type Row = { id: string; read_at?: string | null; seen_at?: string | null };

function isRowArray(v: unknown): v is Row[] {
  return Array.isArray(v);
}

export type AlertCacheSnapshot = Array<[readonly unknown[], unknown]>;

/** Cancel in-flight list fetches and snapshot them for rollback. */
export async function snapshotAlertLists(qc: QueryClient): Promise<AlertCacheSnapshot> {
  const snap: AlertCacheSnapshot = [];
  for (const key of ALERT_LIST_KEYS) {
    await qc.cancelQueries({ queryKey: key });
    for (const [k, v] of qc.getQueriesData({ queryKey: key })) snap.push([k, v]);
  }
  return snap;
}

export function restoreAlertLists(qc: QueryClient, snap?: AlertCacheSnapshot) {
  snap?.forEach(([k, v]) => qc.setQueryData(k, v));
}

/** Optimistically remove closed alerts from every list. */
export function removeAlertsFromCaches(qc: QueryClient, ids: string[]) {
  const set = new Set(ids);
  for (const key of ALERT_LIST_KEYS) {
    qc.setQueriesData({ queryKey: key }, (old: unknown) =>
      isRowArray(old) ? old.filter((a) => !set.has(a.id)) : old,
    );
  }
}

/** Optimistically mark alerts read (read_at + seen_at) in every list. */
export function markAlertsReadInCaches(qc: QueryClient, ids: string[]) {
  const set = new Set(ids);
  const now = new Date().toISOString();
  for (const key of ALERT_LIST_KEYS) {
    qc.setQueriesData({ queryKey: key }, (old: unknown) =>
      isRowArray(old)
        ? old.map((a) =>
            set.has(a.id) ? { ...a, read_at: a.read_at ?? now, seen_at: a.seen_at ?? now } : a,
          )
        : old,
    );
  }
}

/** Reconcile every alert list and counter with server truth. */
export function invalidateAlertSurfaces(qc: QueryClient) {
  for (const key of [...ALERT_LIST_KEYS, ...ALERT_COUNT_KEYS]) {
    qc.invalidateQueries({ queryKey: key });
  }
}
