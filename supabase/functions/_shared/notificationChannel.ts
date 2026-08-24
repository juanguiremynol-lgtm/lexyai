/**
 * notificationChannel.ts — one fact, one channel (D1).
 *
 * Andromeda has two user-facing senders for judicial movement:
 *   • `scheduled-daily-digest`  → the consolidated daily email (DEFAULT channel)
 *   • `dispatch-update-emails`  → the per-event email (EXCEPTION, opt-in)
 *
 * Until now neither knew about the other, so the same actuación was mailed
 * twice on the same morning. `notification_dispatch_ledger` is the shared
 * record: a movement written there by one channel is never mailed by the other.
 *
 * The channel choice is a USER preference (`alert_preferences.preferences`)
 * plus an optional per-matter override (`work_items.notification_override`),
 * never a constant in code.
 */

// deno-lint-ignore no-explicit-any
type Client = any;

export type DispatchChannel = "DIGEST" | "IMMEDIATE";
export type EntityKind = "ACT" | "PUB" | "ALERT";

export interface LedgerEntry {
  recipient_user_id: string;
  organization_id?: string | null;
  work_item_id?: string | null;
  entity_kind: EntityKind;
  entity_id: string;
  channel: DispatchChannel;
}

/** Events that may still be mailed the moment they happen, when enabled. */
export const IMMEDIATE_EVENT_KEYS = [
  "HEARING_SCHEDULED",
  "TERM_EXPIRING",
  "PERSONAL_NOTIFICATION",
] as const;
export type ImmediateEventKey = typeof IMMEDIATE_EVENT_KEYS[number];

export interface ChannelPolicy {
  /** 'DIGEST' (default) or 'IMMEDIATE'. */
  channelDefault: DispatchChannel;
  /** Event keys the recipient explicitly wants immediately. */
  immediateEvents: ImmediateEventKey[];
}

/**
 * Reads the recipient's channel policy. The default — with no preferences
 * stored at all — is the consolidated digest and nothing else.
 */
export function resolveChannelPolicy(
  preferences: Record<string, unknown> | null | undefined,
): ChannelPolicy {
  const prefs = preferences ?? {};
  const raw = String(prefs.channel_default ?? "DIGEST").toUpperCase();
  const channelDefault: DispatchChannel = raw === "IMMEDIATE" ? "IMMEDIATE" : "DIGEST";
  const list = Array.isArray(prefs.immediate_events) ? prefs.immediate_events : [];
  const immediateEvents = list
    .map((v) => String(v).toUpperCase())
    .filter((v): v is ImmediateEventKey =>
      (IMMEDIATE_EVENT_KEYS as readonly string[]).includes(v)
    );
  return { channelDefault, immediateEvents };
}

/**
 * Decides whether the per-event channel may mail this movement.
 *
 * `override` is the matter's own `notification_override`:
 *   'IMMEDIATE'   → always allowed for that matter
 *   'DIGEST_ONLY' → never allowed, whatever the user preference says
 */
export function immediateAllowed(
  policy: ChannelPolicy,
  override: string | null | undefined,
  eventKey?: ImmediateEventKey | null,
): boolean {
  if (override === "DIGEST_ONLY") return false;
  if (override === "IMMEDIATE") return true;
  if (policy.channelDefault === "IMMEDIATE") return true;
  return !!eventKey && policy.immediateEvents.includes(eventKey);
}

/**
 * Returns the subset of `ids` that has NOT been mailed to this recipient yet,
 * whatever the channel. A read failure is treated as "already dispatched" for
 * nothing — we prefer a duplicate over a silent loss only when the ledger is
 * unreachable, and that case is logged by the caller.
 */
export async function notYetDispatched(
  supabase: Client,
  recipientUserId: string,
  kind: EntityKind,
  ids: string[],
): Promise<Set<string>> {
  const remaining = new Set(ids);
  if (ids.length === 0) return remaining;
  const { data, error } = await supabase
    .from("notification_dispatch_ledger")
    .select("entity_id")
    .eq("recipient_user_id", recipientUserId)
    .eq("entity_kind", kind)
    .in("entity_id", ids);
  if (error) {
    console.warn(`[notificationChannel] ledger read failed: ${error.message}`);
    return remaining;
  }
  for (const row of data ?? []) remaining.delete(row.entity_id as string);
  return remaining;
}

/**
 * Records what a channel just mailed. Conflicts are ignored: the unique index
 * (recipient, kind, entity) is the guarantee, and a race must not fail a send
 * that already went out.
 */
export async function recordDispatch(
  supabase: Client,
  entries: LedgerEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await supabase
    .from("notification_dispatch_ledger")
    .upsert(entries, { onConflict: "recipient_user_id,entity_kind,entity_id", ignoreDuplicates: true });
  if (error) console.warn(`[notificationChannel] ledger write failed: ${error.message}`);
}
