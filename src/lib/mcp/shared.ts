/**
 * shared.ts — Common helpers for Andromeda MCP tools.
 *
 * IMPORT-SAFE: no env reads, no I/O at module top level. Every helper reads
 * env only when a tool handler invokes it.
 *
 * SECURITY: MCP tools NEVER use the service role key. Every query runs with the
 * caller's own OAuth bearer token so Postgres RLS enforces tenant isolation.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

export function sbForUser(ctx: ToolContext): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

/**
 * MCP tool result.
 *
 * CRITICAL: most MCP clients (Claude, ChatGPT) only render the `content` text
 * blocks and ignore `structuredContent`. Returning the payload solely as
 * structured output made every tool look like a one-line summary. We therefore
 * ALWAYS serialize the payload into the text block as JSON, and keep
 * `structuredContent` for clients that do read it.
 */
const MAX_JSON_CHARS = 90_000;

export function textResult(text: string, structuredContent?: Record<string, unknown>) {
  if (!structuredContent) {
    return { content: [{ type: "text" as const, text }] };
  }
  let json = JSON.stringify(structuredContent, null, 2);
  let truncated = false;
  if (json.length > MAX_JSON_CHARS) {
    json = JSON.stringify(structuredContent);
    if (json.length > MAX_JSON_CHARS) {
      json = json.slice(0, MAX_JSON_CHARS);
      truncated = true;
    }
  }
  const body = truncated
    ? `${text}\n\n(Respuesta truncada: reduce el parámetro \`limit\` para ver todo.)\n\n\`\`\`json\n${json}\n\`\`\``
    : `${text}\n\n\`\`\`json\n${json}\n\`\`\``;
  return { content: [{ type: "text" as const, text: body }], structuredContent };
}

/** Business days (Mon-Fri) between two ISO dates, excluding provided holidays. */
export function businessDaysBetween(fromISO: string, toISO: string, holidays: Set<string> = new Set()): number {
  const start = new Date(`${fromISO}T12:00:00Z`);
  const end = new Date(`${toISO}T12:00:00Z`);
  const sign = end < start ? -1 : 1;
  let count = 0;
  const cursor = new Date(sign > 0 ? start : end);
  const stop = sign > 0 ? end : start;
  while (cursor < stop) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const iso = cursor.toISOString().slice(0, 10);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) count += 1;
  }
  return count * sign;
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export function requireAuth(ctx: ToolContext): string | null {
  return ctx.isAuthenticated() ? null : "No autenticado. Vuelve a conectar la herramienta con tu cuenta de Andromeda.";
}

/**
 * Write-scope guard for the two mutating tools (`add_note`, `add_hearing`).
 *
 * Supabase-issued OAuth access tokens do not carry an OAuth `scope` claim, so a
 * token without any scope claim is treated as a full-access user token (the
 * connection was approved by the user on the consent screen). When a scope
 * claim IS present, `read_write` must be among the granted scopes — this makes
 * read-only tokens genuinely read-only as soon as the authorization server
 * starts emitting scopes.
 */
export function requireWriteScope(ctx: ToolContext): string | null {
  const unauth = requireAuth(ctx);
  if (unauth) return unauth;
  const claims = (ctx.getClaims?.() ?? {}) as Record<string, unknown>;
  const raw = claims.scope ?? claims.scopes ?? claims.scp;
  if (raw == null) return null; // no scope claim → user token, full access
  const granted = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[\s,]+/);
  return granted.includes("read_write")
    ? null
    : "Esta conexión es de solo lectura. Autoriza el permiso `read_write` para escribir en Andromeda.";
}

/** Organization of the caller (used to stamp inserted rows). */
export async function callerOrganizationId(sb: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await sb
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return (data as { organization_id?: string } | null)?.organization_id ?? null;
}

/** Bogota-local calendar day (YYYY-MM-DD) — the ratified "hoy" semantics. */
export function bogotaToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** Resolve a work item by UUID or radicado, scoped by RLS to the caller. */
export async function resolveWorkItem(
  sb: SupabaseClient,
  args: { id?: string; radicado?: string },
  columns = "id, radicado, title, workflow_type, stage, authority_name, client_id",
) {
  let q = sb.from("work_items").select(columns).is("deleted_at", null).limit(1);
  if (args.id) q = q.eq("id", args.id);
  else if (args.radicado) q = q.eq("radicado", args.radicado.trim());
  else return { item: null, error: "Indica el id o el radicado del asunto." };
  const { data, error } = await q;
  if (error) return { item: null, error: error.message };
  const item = (data as unknown as Record<string, unknown>[])?.[0];
  if (!item) return { item: null, error: "Asunto no encontrado (o no pertenece a tu cuenta)." };
  return { item, error: null as string | null };
}
