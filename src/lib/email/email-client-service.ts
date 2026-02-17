/**
 * Email Client Service — Wires the user-facing email client
 * to the platform's provider-agnostic email infrastructure.
 *
 * SEND: Enqueues to `email_outbox` → `process-email-outbox` picks it up
 *       and routes to whichever provider is active (Resend, SendGrid, SES, Mailgun, SMTP, gateway).
 *
 * RECEIVE: Reads from `inbound_messages` (populated by the inbound-email edge function).
 *
 * SENT VIEW: Reads from `email_outbox` to show delivery status.
 */

import { supabase } from "@/integrations/supabase/client";

const PLATFORM_EMAIL = "info@andromeda.legal";

// ─── Types ──────────────────────────────────────────────────

export interface InboxEmail {
  id: string;
  from_email: string;
  from_name: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  subject: string;
  body_preview: string | null;
  html_body: string | null;
  text_body: string | null;
  received_at: string;
  processing_status: string;
  source_provider: string;
  thread_id: string | null;
}

export interface SentEmail {
  id: string;
  to_email: string;
  subject: string;
  html: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  error: string | null;
  attempts: number;
  trigger_reason: string | null;
}

export interface ComposePayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string; // plain text — converted to HTML
}

// ─── Inbox (inbound_messages) ───────────────────────────────

export async function fetchInboxEmails(limit = 50, offset = 0) {
  const { data, error, count } = await supabase
    .from("inbound_messages")
    .select(
      "id, from_email, from_name, to_emails, cc_emails, subject, body_preview, html_body, text_body, received_at, processing_status, source_provider, thread_id",
      { count: "exact" }
    )
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return { data: (data ?? []) as InboxEmail[], count: count ?? 0 };
}

export async function fetchInboxEmailDetail(id: string) {
  const { data, error } = await supabase
    .from("inbound_messages")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ─── Sent (email_outbox) ────────────────────────────────────

export async function fetchSentEmails(limit = 50, offset = 0) {
  const { data, error, count } = await supabase
    .from("email_outbox")
    .select(
      "id, to_email, subject, html, status, created_at, sent_at, error, attempts, trigger_reason",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return { data: (data ?? []) as SentEmail[], count: count ?? 0 };
}

// ─── Compose (enqueue → email_outbox → process-email-outbox) ─

export async function sendEmail(payload: ComposePayload) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  // Get user's organization
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();

  const orgId = profile?.organization_id ?? "00000000-0000-0000-0000-000000000000";

  const html = `<div style="font-family: sans-serif;">${payload.body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>")}</div>`;

  // Enqueue one row per recipient (To)
  const rows = payload.to.map((to) => ({
    to_email: to,
    subject: payload.subject,
    html,
    organization_id: orgId,
    trigger_reason: "EMAIL_CLIENT_COMPOSE",
    triggered_by: user.id,
    status: "PENDING",
  }));

  const { error: insertError } = await supabase
    .from("email_outbox")
    .insert(rows);

  if (insertError) throw insertError;

  // Trigger process-email-outbox immediately so email sends right away
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await supabase.functions.invoke("process-email-outbox", {});
    }
  } catch {
    // Not fatal — scheduler will pick it up
    console.warn("Could not trigger process-email-outbox immediately; scheduler will handle it.");
  }

  return { ok: true, queued: rows.length };
}

export { PLATFORM_EMAIL };
