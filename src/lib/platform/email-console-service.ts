/**
 * Platform Email Console Service
 * Provider-agnostic service layer for super admin email operations.
 * Reads from inbound_messages (receive) and email_outbox (send).
 * Compose enqueues to email_outbox — actual delivery is handled by process-email-outbox.
 */

import { supabase } from "@/integrations/supabase/client";

export interface EmailConsoleFilters {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  organizationId?: string;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface InboxMessage {
  id: string;
  owner_id: string;
  received_at: string;
  source_provider: string;
  from_name: string | null;
  from_email: string;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  text_body: string | null;
  html_body: string | null;
  body_preview: string | null;
  thread_id: string | null;
  in_reply_to: string | null;
  processing_status: string;
  created_at: string;
}

export interface OutboxMessage {
  id: string;
  organization_id: string;
  to_email: string;
  subject: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  error: string | null;
  trigger_reason: string | null;
  triggered_by: string | null;
  failed_permanent: boolean;
  last_event_type: string | null;
  attempts: number;
}

export interface ComposePayload {
  to_email: string;
  subject: string;
  html: string;
  organization_id?: string;
}

// ─── Inbox (Inbound) ───────────────────────────────────────

export async function fetchPlatformInbox(
  filters: EmailConsoleFilters,
  { page, pageSize }: PaginationParams
) {
  let query = supabase
    .from("inbound_messages")
    .select("id, owner_id, received_at, source_provider, from_name, from_email, to_emails, cc_emails, subject, body_preview, thread_id, processing_status, created_at", { count: "exact" })
    .order("received_at", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (filters.search) {
    query = query.or(`subject.ilike.%${filters.search}%,from_email.ilike.%${filters.search}%`);
  }
  if (filters.status) {
    query = query.eq("processing_status", filters.status);
  }
  if (filters.dateFrom) {
    query = query.gte("received_at", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("received_at", filters.dateTo);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data ?? []) as InboxMessage[], count: count ?? 0 };
}

export async function fetchInboxMessageDetail(messageId: string) {
  const { data, error } = await supabase
    .from("inbound_messages")
    .select("*, inbound_attachments(*), message_links(*)")
    .eq("id", messageId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ─── Sent (Outbox) ──────────────────────────────────────────

export async function fetchPlatformSent(
  filters: EmailConsoleFilters,
  { page, pageSize }: PaginationParams
) {
  let query = supabase
    .from("email_outbox")
    .select("id, organization_id, to_email, subject, status, created_at, sent_at, error, trigger_reason, triggered_by, failed_permanent, last_event_type, attempts", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (filters.search) {
    query = query.or(`subject.ilike.%${filters.search}%,to_email.ilike.%${filters.search}%`);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.dateFrom) {
    query = query.gte("created_at", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("created_at", filters.dateTo);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data ?? []) as OutboxMessage[], count: count ?? 0 };
}

export async function fetchOutboxMessageDetail(messageId: string) {
  const { data, error } = await supabase
    .from("email_outbox")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ─── Compose ────────────────────────────────────────────────

export async function composePlatformEmail(payload: ComposePayload, userId: string) {
  const { data, error } = await supabase
    .from("email_outbox")
    .insert({
      to_email: payload.to_email,
      subject: payload.subject,
      html: payload.html,
      organization_id: payload.organization_id ?? null,
      trigger_reason: "PLATFORM_COMPOSE",
      triggered_by: userId,
      status: "PENDING",
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}
