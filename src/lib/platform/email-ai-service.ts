/**
 * Email AI Service — Wires Atenia AI (Gemini) to the email inbox/outbox
 * for AI-assisted responses, diagnostics, triage, and autonomous action.
 *
 * All email content is made available to Gemini for:
 * - Draft reply generation for info@andromeda.legal
 * - Email triage and classification
 * - Diagnostic intake (linking emails to support tickets / conversations)
 * - Autonomous email health monitoring
 */

import { supabase } from "@/integrations/supabase/client";
import { callGeminiViaEdge } from "@/lib/services/atenia-ai-engine";
import {
  findOrCreateConversation,
  addObservation,
  addMessage,
  type IncidentData,
} from "@/lib/services/atenia-ai-conversations";

const PLATFORM_EMAIL = "info@andromeda.legal";

// ─── Types ──────────────────────────────────────────────────

export interface EmailForAI {
  id: string;
  direction: "inbound" | "outbound";
  from_email: string;
  from_name?: string | null;
  to_emails?: string[];
  to_email?: string;
  cc_emails?: string[];
  subject: string;
  text_body?: string | null;
  html_body?: string | null;
  body_preview?: string | null;
  received_at?: string;
  created_at?: string;
  processing_status?: string;
  status?: string;
  thread_id?: string | null;
}

export interface AIDraftResult {
  draft: string;
  tone: string;
  classification: string;
  confidence: number;
  suggestedActions: string[];
}

export interface AITriageResult {
  classification: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  summary: string;
  suggestedActions: string[];
  shouldCreateTicket: boolean;
  relatedEntities: string[];
}

export interface AIEmailDigestResult {
  totalAnalyzed: number;
  classifications: Record<string, number>;
  criticalItems: Array<{ id: string; subject: string; reason: string }>;
  summary: string;
}

// ─── Formatters ─────────────────────────────────────────────

function formatEmailForPrompt(email: EmailForAI): string {
  const body = email.text_body || email.body_preview || stripHtml(email.html_body) || "(sin contenido)";
  const dir = email.direction === "inbound" ? "RECIBIDO" : "ENVIADO";
  const date = email.received_at || email.created_at || "desconocida";
  const to = email.to_emails?.join(", ") || email.to_email || "desconocido";

  return [
    `--- EMAIL [${dir}] ---`,
    `ID: ${email.id}`,
    `De: ${email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email}`,
    `Para: ${to}`,
    email.cc_emails?.length ? `CC: ${email.cc_emails.join(", ")}` : null,
    `Asunto: ${email.subject}`,
    `Fecha: ${date}`,
    `Estado: ${email.processing_status || email.status || "N/A"}`,
    email.thread_id ? `Thread: ${email.thread_id}` : null,
    `\nContenido:\n${body.slice(0, 4000)}`,
    `--- FIN EMAIL ---`,
  ].filter(Boolean).join("\n");
}

function stripHtml(html?: string | null): string | null {
  if (!html) return null;
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// ─── AI Draft Reply ─────────────────────────────────────────

const DRAFT_SYSTEM_PROMPT = `Eres el asistente de email de Atenia AI para la plataforma Andromeda Legal.
Tu rol es redactar respuestas profesionales en nombre de ${PLATFORM_EMAIL}.

Reglas:
- Responde SIEMPRE en español formal y profesional
- Identifícate como el equipo de soporte de Andromeda Legal
- Nunca inventes datos legales o números de radicado
- Si el email requiere información específica de un caso, indica qué datos son necesarios
- Incluye saludo y despedida apropiados
- Clasifica el email como: SOPORTE_TECNICO, CONSULTA_LEGAL, NOTIFICACION_JUDICIAL, SPAM, ADMINISTRATIVO, OTRO
- Sugiere acciones concretas (crear ticket, escalar, responder, archivar)

Responde en JSON con esta estructura:
{
  "draft": "texto completo del borrador de respuesta",
  "tone": "formal|amigable|urgente",
  "classification": "SOPORTE_TECNICO|CONSULTA_LEGAL|NOTIFICACION_JUDICIAL|SPAM|ADMINISTRATIVO|OTRO",
  "confidence": 0.0-1.0,
  "suggestedActions": ["acción1", "acción2"]
}`;

export async function generateDraftReply(email: EmailForAI): Promise<AIDraftResult> {
  const emailContext = formatEmailForPrompt(email);
  const prompt = `${DRAFT_SYSTEM_PROMPT}\n\nEmail a responder:\n${emailContext}\n\nGenera el borrador de respuesta en JSON:`;

  const raw = await callGeminiViaEdge(prompt);
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback below */ }

  return {
    draft: raw,
    tone: "formal",
    classification: "OTRO",
    confidence: 0.5,
    suggestedActions: ["Revisar manualmente"],
  };
}

// ─── AI Triage / Classify ───────────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `Eres el motor de triage de Atenia AI para emails de ${PLATFORM_EMAIL}.

Analiza el email y clasifícalo. Determina prioridad y acciones.

Reglas:
- Emails judiciales con radicados son SIEMPRE prioridad HIGH o CRITICAL
- Emails de soporte técnico son MEDIUM por defecto
- SPAM es siempre LOW
- Si mencionan un radicado de 23 dígitos, extráelo en relatedEntities
- Si el email parece urgente o menciona plazos legales, marca shouldCreateTicket = true

Responde en JSON:
{
  "classification": "SOPORTE_TECNICO|CONSULTA_LEGAL|NOTIFICACION_JUDICIAL|SPAM|ADMINISTRATIVO|OTRO",
  "priority": "LOW|MEDIUM|HIGH|CRITICAL",
  "summary": "resumen en 1-2 oraciones",
  "suggestedActions": ["acción1"],
  "shouldCreateTicket": true|false,
  "relatedEntities": ["radicado u otra entidad detectada"]
}`;

export async function triageEmail(email: EmailForAI): Promise<AITriageResult> {
  const emailContext = formatEmailForPrompt(email);
  const prompt = `${TRIAGE_SYSTEM_PROMPT}\n\nEmail:\n${emailContext}\n\nAnaliza y clasifica en JSON:`;

  const raw = await callGeminiViaEdge(prompt);
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback below */ }

  return {
    classification: "OTRO",
    priority: "MEDIUM",
    summary: raw.slice(0, 200),
    suggestedActions: ["Revisar manualmente"],
    shouldCreateTicket: false,
    relatedEntities: [],
  };
}

// ─── AI Bulk Email Digest ───────────────────────────────────

export async function digestRecentEmails(limit = 20): Promise<AIEmailDigestResult> {
  const { data: emails, error } = await supabase
    .from("inbound_messages")
    .select("id, from_email, from_name, subject, body_preview, text_body, received_at, processing_status, thread_id")
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error || !emails?.length) {
    return { totalAnalyzed: 0, classifications: {}, criticalItems: [], summary: "No hay emails recientes para analizar." };
  }

  const emailSummaries = emails.map((e: any) => {
    const body = e.text_body || e.body_preview || "(vacío)";
    return `- [${e.id.slice(0, 8)}] De: ${e.from_name || e.from_email} | Asunto: ${e.subject} | Preview: ${body.slice(0, 150)}`;
  }).join("\n");

  const prompt = `Eres Atenia AI. Analiza estos ${emails.length} emails recientes de ${PLATFORM_EMAIL} y proporciona un resumen ejecutivo.

Emails:
${emailSummaries}

Responde en JSON:
{
  "totalAnalyzed": ${emails.length},
  "classifications": { "TIPO": count },
  "criticalItems": [{ "id": "...", "subject": "...", "reason": "..." }],
  "summary": "resumen ejecutivo de la bandeja"
}`;

  const raw = await callGeminiViaEdge(prompt);
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }

  return { totalAnalyzed: emails.length, classifications: {}, criticalItems: [], summary: raw.slice(0, 500) };
}

// ─── Atenia AI Conversation Wiring ──────────────────────────

/**
 * Registers an inbound email as an Atenia AI observation for
 * autonomous intake and diagnostic tracking.
 */
export async function registerEmailInAteniaAI(
  email: EmailForAI,
  orgId: string,
  triage?: AITriageResult,
): Promise<string | null> {
  const severity = triage?.priority === "CRITICAL"
    ? "CRITICAL"
    : triage?.priority === "HIGH"
      ? "WARNING"
      : "INFO";

  const incident: IncidentData = {
    orgId,
    channel: "SYSTEM",
    severity: severity as any,
    title: `Email: ${email.subject?.slice(0, 80) || "(sin asunto)"}`,
  };

  try {
    const convId = await findOrCreateConversation(incident);
    if (convId) {
      const body = email.text_body || email.body_preview || stripHtml(email.html_body) || "";
      await addObservation(
        convId,
        orgId,
        "EMAIL_INTAKE",
        severity,
        `Email de ${email.from_email}: ${email.subject}`,
        {
          email_id: email.id,
          from: email.from_email,
          subject: email.subject,
          classification: triage?.classification,
          priority: triage?.priority,
          body_preview: body.slice(0, 500),
          suggested_actions: triage?.suggestedActions,
        },
      );

      if (triage?.shouldCreateTicket) {
        await addMessage(
          convId,
          "system",
          `[Auto-ticket] Email clasificado como ${triage.classification} con prioridad ${triage.priority}. Acciones sugeridas: ${triage.suggestedActions?.join(", ")}`,
        );
      }
    }
    return convId;
  } catch (err) {
    console.warn("[email-ai] Failed to register email in Atenia AI:", err);
    return null;
  }
}

// ─── Full Email Content Access for AI ───────────────────────

/**
 * Fetches complete email content (inbound or outbound) for AI processing.
 * This gives Atenia AI full visibility into email content.
 */
export async function fetchEmailForAI(
  messageId: string,
  direction: "inbound" | "outbound",
): Promise<EmailForAI | null> {
  if (direction === "inbound") {
    const { data, error } = await supabase
      .from("inbound_messages")
      .select("id, from_email, from_name, to_emails, cc_emails, subject, text_body, html_body, body_preview, received_at, processing_status, thread_id")
      .eq("id", messageId)
      .maybeSingle();
    if (error || !data) return null;
    return { ...data, direction: "inbound" } as EmailForAI;
  } else {
    const { data, error } = await supabase
      .from("email_outbox")
      .select("id, to_email, subject, html, status, created_at")
      .eq("id", messageId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      direction: "outbound",
      from_email: PLATFORM_EMAIL,
      to_email: data.to_email,
      subject: data.subject,
      html_body: data.html,
      status: data.status,
      created_at: data.created_at,
    } as EmailForAI;
  }
}
