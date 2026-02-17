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

/** Structured error from compose operations */
export interface ComposeError {
  code: string;
  message: string;
  details?: string;
  phase: "validation" | "insert" | "trigger" | "unknown";
}

const PLATFORM_ORG_ID = "00000000-0000-0000-0000-000000000000";

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

/**
 * Composes and enqueues a platform email.
 * Returns structured result with email ID or a ComposeError.
 */
export async function composePlatformEmail(
  payload: ComposePayload,
  userId: string,
): Promise<{ id: string; triggered: boolean }> {
  // Phase 1: Validation
  if (!payload.to_email?.trim()) {
    throw createComposeError("MISSING_RECIPIENT", "El campo 'Para' es obligatorio.", "validation");
  }
  if (!payload.subject?.trim()) {
    throw createComposeError("MISSING_SUBJECT", "El campo 'Asunto' es obligatorio.", "validation");
  }
  if (!payload.html?.trim()) {
    throw createComposeError("MISSING_BODY", "El cuerpo del email no puede estar vacío.", "validation");
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(payload.to_email.trim())) {
    throw createComposeError("INVALID_EMAIL", `"${payload.to_email}" no es una dirección de email válida.`, "validation");
  }

  // Phase 2: Insert into email_outbox
  const orgId = payload.organization_id || PLATFORM_ORG_ID;
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("email_outbox")
    .insert({
      to_email: payload.to_email.trim(),
      subject: payload.subject.trim(),
      html: payload.html,
      organization_id: orgId,
      next_attempt_at: now,
      trigger_reason: "PLATFORM_COMPOSE",
      triggered_by: userId,
      status: "PENDING",
    })
    .select("id")
    .single();

  if (error) {
    const isRLS = error.message?.includes("row-level security") || error.code === "42501";
    const isFK = error.code === "23503";
    throw createComposeError(
      isRLS ? "RLS_DENIED" : isFK ? "INVALID_REFERENCE" : `DB_${error.code || "ERROR"}`,
      isRLS
        ? "Permiso denegado: tu cuenta no tiene acceso para enviar emails desde la plataforma. Verifica que eres Super Admin."
        : isFK
        ? `Referencia inválida en la base de datos: ${error.details || error.message}`
        : `Error de base de datos: ${error.message}`,
      "insert",
      error.details || undefined,
    );
  }

  // Phase 3: Trigger process-email-outbox immediately
  let triggered = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-email-outbox`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ triggered_by: "PLATFORM_COMPOSE" }),
        },
      );
      triggered = true;
    }
  } catch (triggerErr) {
    // Not fatal — scheduler will pick it up
    console.warn("Could not trigger process-email-outbox:", triggerErr);
  }

  return { id: data.id, triggered };
}

function createComposeError(
  code: string,
  message: string,
  phase: ComposeError["phase"],
  details?: string,
): ComposeError {
  return { code, message, phase, details };
}

/** Type guard for ComposeError */
export function isComposeError(err: unknown): err is ComposeError {
  return typeof err === "object" && err !== null && "code" in err && "phase" in err;
}
