/**
 * atenia-ai-conversations.ts — Conversation auto-creation and lifecycle management
 *
 * Provides helpers to create/find/update incident conversations from
 * heartbeat observations, daily sync results, and user reports.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  type ObservationKind,
  type ObservationSeverity,
  SECURITY_OBSERVATION_KINDS,
  validateObservationKind,
  isValidObservationSeverity,
} from "@/lib/constants/sync-constraints";

// ============= TYPES =============

export interface IncidentData {
  orgId: string;
  channel: "HEARTBEAT" | "DAILY_SYNC" | "USER_REPORT" | "SYSTEM" | "ADMIN_PANEL";
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  providers?: string[];
  workflows?: string[];
  workItemIds?: string[];
  userId?: string;
}

// ============= FINGERPRINTING =============

function generateFingerprint(kind: string, provider?: string, errorCode?: string): string {
  return `${kind}:${provider ?? "none"}:${errorCode ?? "none"}`;
}

// ============= FIND OR CREATE =============

export async function findOrCreateConversation(
  incident: IncidentData,
): Promise<string> {
  // Look for open conversation with similar title in last 24h
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: existing } = await (supabase
    .from("atenia_ai_conversations") as any)
    .select("id, severity")
    .eq("organization_id", incident.orgId)
    .eq("status", "OPEN")
    .eq("channel", incident.channel)
    .gte("last_activity_at", twentyFourHoursAgo)
    .order("last_activity_at", { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    const conv = existing[0];
    // Escalate severity if needed
    const severityOrder: Record<string, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
    if ((severityOrder[incident.severity] ?? 0) > (severityOrder[conv.severity] ?? 0)) {
      await (supabase.from("atenia_ai_conversations") as any)
        .update({
          severity: incident.severity,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", conv.id);
    } else {
      await (supabase.from("atenia_ai_conversations") as any)
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", conv.id);
    }
    return conv.id;
  }

  // Create new
  const { data: newConv } = await (supabase
    .from("atenia_ai_conversations") as any)
    .insert({
      scope: "ORG",
      organization_id: incident.orgId,
      channel: incident.channel,
      severity: incident.severity,
      title: incident.title,
      created_by_user_id: incident.userId ?? null,
      related_providers: incident.providers ?? [],
      related_workflows: incident.workflows ?? [],
      related_work_item_ids: incident.workItemIds ?? [],
    })
    .select("id")
    .single();

  return newConv?.id ?? "";
}

// ============= ADD OBSERVATION =============

/**
 * Add an observation to a conversation.
 *
 * Error policy (tiered):
 * - Security observation kinds (EGRESS_VIOLATION, SECURITY_ALERT): throws on failure
 *   → caller should deny the risky operation if observation can't be logged
 * - All other kinds: logs error + emits metric but does NOT throw
 *   → prevents observation subsystem failures from breaking core user flows
 */
export async function addObservation(
  conversationId: string,
  orgId: string,
  kind: string,
  severity: string,
  title: string,
  payload: Record<string, unknown> = {},
  links: Record<string, unknown> = {},
): Promise<void> {
  // Validate kind against centralized constants — fail loudly, never silently
  const validKind = validateObservationKind(kind.toUpperCase());
  const validSeverity = isValidObservationSeverity(severity.toUpperCase())
    ? severity.toUpperCase()
    : (() => { throw new Error(`Invalid observation severity: "${severity}"`); })();

  const isSecurityKind = SECURITY_OBSERVATION_KINDS.includes(validKind as any);

  const { error } = await (supabase.from("atenia_ai_observations") as any).insert({
    conversation_id: conversationId,
    organization_id: orgId,
    kind: validKind,
    severity: validSeverity,
    title,
    payload,
    links,
  });

  if (error) {
    console.error(`[observation_insert_failure] kind=${validKind} fn=addObservation error=${error.message}`);

    if (isSecurityKind) {
      // Security-critical: throw to force caller to deny the risky operation
      throw new Error(`Security observation insert failed (kind=${validKind}): ${error.message}`);
    }
    // Non-security: log metric but don't break the caller's primary flow
    console.warn(`[observation_non_fatal] kind=${validKind} — insert failed but primary flow continues`);
    return;
  }

  // Update counts
  await updateConversationCounts(conversationId);
}

// ============= ADD MESSAGE =============

export async function addMessage(
  conversationId: string,
  role: string,
  contentText: string,
  userId?: string,
  contentStructured?: Record<string, unknown>,
): Promise<void> {
  await (supabase.from("atenia_ai_op_messages") as any).insert({
    conversation_id: conversationId,
    role,
    content_text: contentText,
    content_structured: contentStructured ?? {},
    created_by_user_id: userId ?? null,
  });

  await (supabase.from("atenia_ai_conversations") as any)
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", conversationId);

  await updateConversationCounts(conversationId);
}

// ============= LINK ACTION =============

export async function linkActionToConversation(
  actionId: string,
  conversationId: string,
): Promise<void> {
  await (supabase.from("atenia_ai_actions") as any)
    .update({ conversation_id: conversationId })
    .eq("id", actionId);

  await updateConversationCounts(conversationId);
}

// ============= STATUS CHANGES =============

export async function updateConversationStatus(
  conversationId: string,
  newStatus: string,
  userId?: string,
): Promise<void> {
  const updates: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  if (newStatus === "RESOLVED") {
    updates.resolved_at = new Date().toISOString();
    updates.resolved_by_user_id = userId ?? null;
  }
  if (newStatus === "OPEN") {
    updates.resolved_at = null;
    updates.resolved_by_user_id = null;
  }

  await (supabase.from("atenia_ai_conversations") as any)
    .update(updates)
    .eq("id", conversationId);

  // Add system message
  const statusLabels: Record<string, string> = {
    OPEN: "Reabierto",
    RESOLVED: "Resuelto",
    MUTED: "Silenciado",
    ARCHIVED: "Archivado",
  };

  await addMessage(
    conversationId,
    "system",
    `Estado cambiado a ${statusLabels[newStatus] || newStatus}`,
    userId,
  );
}

// ============= COUNTS =============

async function updateConversationCounts(conversationId: string): Promise<void> {
  const [msgCount, obsCount, actCount] = await Promise.all([
    (supabase.from("atenia_ai_op_messages") as any)
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversationId),
    (supabase.from("atenia_ai_observations") as any)
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversationId),
    (supabase.from("atenia_ai_actions") as any)
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversationId),
  ]);

  await (supabase.from("atenia_ai_conversations") as any)
    .update({
      message_count: msgCount.count ?? 0,
      observation_count: obsCount.count ?? 0,
      action_count: actCount.count ?? 0,
    })
    .eq("id", conversationId);
}

// ============= LIFECYCLE =============

export async function autoMuteStaleConversations(): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  await (supabase.from("atenia_ai_conversations") as any)
    .update({ status: "MUTED" })
    .eq("status", "OPEN")
    .lt("last_activity_at", sevenDaysAgo);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await (supabase.from("atenia_ai_conversations") as any)
    .update({ status: "ARCHIVED" })
    .eq("status", "RESOLVED")
    .lt("resolved_at", thirtyDaysAgo);
}
