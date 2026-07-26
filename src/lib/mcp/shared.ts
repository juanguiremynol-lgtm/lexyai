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

export function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export function requireAuth(ctx: ToolContext): string | null {
  return ctx.isAuthenticated() ? null : "No autenticado. Vuelve a conectar la herramienta con tu cuenta de Andromeda.";
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
