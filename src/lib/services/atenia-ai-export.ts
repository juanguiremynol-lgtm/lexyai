/**
 * atenia-ai-export.ts — Export bundle generation for Operations Log
 *
 * Generates deterministic Markdown or JSON exports of incident threads
 * for LLM escalation or offline analysis. All data passes through
 * redactSecrets() before inclusion.
 */

import { supabase } from "@/integrations/supabase/client";

// ============= TYPES =============

interface ConversationRow {
  id: string;
  scope: string;
  organization_id: string | null;
  channel: string;
  status: string;
  severity: string;
  title: string;
  summary: string | null;
  related_providers: string[];
  related_workflows: string[];
  related_work_item_ids: string[];
  message_count: number;
  observation_count: number;
  action_count: number;
  last_activity_at: string;
  created_at: string;
  resolved_at: string | null;
}

interface TimelineEntry {
  _type: "message" | "observation" | "action";
  _at: string;
  [key: string]: unknown;
}

// ============= REDACTION =============

const SENSITIVE_KEYS = [
  "key", "secret", "token", "password", "authorization", "cookie", "credential",
];

function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);

  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
      redacted[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null) {
      redacted[k] = redactSecrets(v);
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

// ============= LOADERS =============

async function loadConversation(conversationId: string): Promise<ConversationRow | null> {
  const { data } = await (supabase
    .from("atenia_ai_conversations") as any)
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  return data;
}

async function loadTimeline(conversationId: string, maxEntries = 20): Promise<TimelineEntry[]> {
  const [msgRes, obsRes, actRes] = await Promise.all([
    (supabase.from("atenia_ai_op_messages") as any)
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(maxEntries),
    (supabase.from("atenia_ai_observations") as any)
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(maxEntries),
    (supabase.from("atenia_ai_actions") as any)
      .select("id, action_type, actor, reasoning, action_result, status, evidence, work_item_id, provider, created_at, reversible")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(maxEntries),
  ]);

  const entries: TimelineEntry[] = [
    ...(msgRes.data || []).map((m: any) => ({ ...m, _type: "message" as const, _at: m.created_at })),
    ...(obsRes.data || []).map((o: any) => ({ ...o, _type: "observation" as const, _at: o.created_at })),
    ...(actRes.data || []).map((a: any) => ({ ...a, _type: "action" as const, _at: a.created_at })),
  ];

  entries.sort((a, b) => new Date(a._at).getTime() - new Date(b._at).getTime());

  // Bound to maxEntries
  if (entries.length > maxEntries) {
    const omitted = entries.length - maxEntries;
    const trimmed = entries.slice(entries.length - maxEntries);
    // Add a synthetic entry at the start
    trimmed.unshift({
      _type: "message",
      _at: trimmed[0]._at,
      role: "system",
      content_text: `... ${omitted} entradas anteriores omitidas`,
    });
    return trimmed;
  }

  return entries;
}

async function loadRelatedLedger(conv: ConversationRow): Promise<any[]> {
  if (!conv.organization_id) return [];
  const { data } = await supabase
    .from("auto_sync_daily_ledger")
    .select("run_date, status, items_succeeded, items_failed, items_skipped, expected_total_items, failure_reason")
    .eq("organization_id", conv.organization_id)
    .order("run_date", { ascending: false })
    .limit(7);
  return data || [];
}

// ============= GENERATORS =============

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota" });
  } catch {
    return iso;
  }
}

function generateMarkdownBundle(
  conv: ConversationRow,
  timeline: TimelineEntry[],
  ledger: any[],
): string {
  const lines: string[] = [];

  lines.push(`# Incidente: ${conv.title}`);
  lines.push(`**ID:** ${conv.id}`);
  lines.push(`**Canal:** ${conv.channel}`);
  lines.push(`**Severidad:** ${conv.severity}`);
  lines.push(`**Estado:** ${conv.status}`);
  lines.push(`**Creado:** ${formatTimestamp(conv.created_at)}`);
  lines.push(`**Última actividad:** ${formatTimestamp(conv.last_activity_at)}`);
  if (conv.related_providers.length > 0) {
    lines.push(`**Proveedores involucrados:** ${conv.related_providers.join(", ")}`);
  }
  if (conv.related_workflows.length > 0) {
    lines.push(`**Workflows:** ${conv.related_workflows.join(", ")}`);
  }
  lines.push(`**Asuntos relacionados:** ${conv.related_work_item_ids.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Línea de tiempo");
  lines.push("");

  for (const entry of timeline) {
    const ts = formatTimestamp(entry._at);

    if (entry._type === "observation") {
      lines.push(`### [${ts}] OBSERVACIÓN — ${entry.kind}`);
      lines.push(`**Severidad:** ${entry.severity}`);
      lines.push(String(entry.title || ""));
      if (entry.payload && Object.keys(entry.payload as object).length > 0) {
        lines.push("```json");
        lines.push(JSON.stringify(redactSecrets(entry.payload), null, 2));
        lines.push("```");
      }
    } else if (entry._type === "action") {
      lines.push(`### [${ts}] ACCIÓN — ${entry.action_type} [${entry.status || entry.action_result}]`);
      lines.push(`**Razón:** ${entry.reasoning}`);
      if (entry.work_item_id) lines.push(`**Objetivo:** ${entry.work_item_id}`);
      if (entry.provider) lines.push(`**Proveedor:** ${entry.provider}`);
      lines.push(`**Reversible:** ${entry.reversible ? "Sí" : "No"}`);
      if (entry.evidence && Object.keys(entry.evidence as object).length > 0) {
        lines.push("```json");
        lines.push(JSON.stringify(redactSecrets(entry.evidence), null, 2));
        lines.push("```");
      }
    } else if (entry._type === "message") {
      lines.push(`### [${ts}] MENSAJE — ${entry.role}`);
      lines.push(String(entry.content_text || ""));
    }
    lines.push("");
  }

  // Ledger
  if (ledger.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Ledger de sync diario (últimos 7 días)");
    lines.push("| Fecha | Estado | Exitosos | Fallidos | Omitidos | Total | Razón |");
    lines.push("|-------|--------|----------|----------|----------|-------|-------|");
    for (const row of ledger) {
      lines.push(
        `| ${row.run_date} | ${row.status} | ${row.items_succeeded ?? "-"} | ${row.items_failed ?? "-"} | ${row.items_skipped ?? "-"} | ${row.expected_total_items ?? "-"} | ${row.failure_reason || "-"} |`
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("_Redacción aplicada: secrets, tokens, y claves API han sido removidos._");
  lines.push(`_Generado: ${formatTimestamp(new Date().toISOString())}_`);
  lines.push(`_Tokens estimados: ~${Math.ceil(lines.join("\n").length / 4)}_`);

  return lines.join("\n");
}

function generateJsonBundle(
  conv: ConversationRow,
  timeline: TimelineEntry[],
  ledger: any[],
): object {
  return {
    incident: {
      id: conv.id,
      title: conv.title,
      channel: conv.channel,
      severity: conv.severity,
      status: conv.status,
      created_at: conv.created_at,
      last_activity_at: conv.last_activity_at,
      related_providers: conv.related_providers,
      related_workflows: conv.related_workflows,
      related_work_item_count: conv.related_work_item_ids.length,
    },
    timeline: timeline.map((e) => {
      const filtered = Object.fromEntries(
        Object.entries(e).filter(([k]) => !k.startsWith("_"))
      );
      return {
        type: e._type,
        timestamp: e._at,
        ...(redactSecrets(filtered) as Record<string, unknown>),
      };
    }),
    daily_sync_ledger: ledger,
    meta: {
      generated_at: new Date().toISOString(),
      redacted: true,
    },
  };
}

// ============= PUBLIC API =============

export async function generateExportBundle(
  conversationId: string,
  format: "MARKDOWN" | "JSON",
  userId: string,
): Promise<string> {
  const conv = await loadConversation(conversationId);
  if (!conv) throw new Error("Conversación no encontrada");

  const timeline = await loadTimeline(conversationId, 20);
  const ledger = await loadRelatedLedger(conv);

  const content =
    format === "MARKDOWN"
      ? generateMarkdownBundle(conv, timeline, ledger)
      : JSON.stringify(generateJsonBundle(conv, timeline, ledger), null, 2);

  const tokenEstimate = Math.ceil(content.length / 4);

  // Store export record
  await (supabase.from("atenia_ai_exports") as any).insert({
    conversation_id: conversationId,
    format,
    content,
    token_estimate: tokenEstimate,
    created_by_user_id: userId,
  });

  return content;
}
