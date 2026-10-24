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
import { digitsOf, radicadoQueryVariants } from "../search/normalized-search";

type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

// Edge runtime: Deno.env is authoritative; `process` may be absent. Reading
// `process.env` directly threw ReferenceError/"supabaseKey is required" inside
// every handler, surfacing to clients as JSON-RPC -32603.
function runtimeEnv(name: string): string | undefined {
  const rt = globalThis as RuntimeGlobals;
  const v = rt.Deno?.env?.get?.(name) ?? rt.process?.env?.[name];
  return v?.trim() || undefined;
}

export function supabaseProjectUrl(): string {
  const url = runtimeEnv("SUPABASE_URL") ?? runtimeEnv("VITE_SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_URL no configurada en el runtime MCP");
  return url;
}

export function supabasePublishableKey(): string {
  const direct = runtimeEnv("SUPABASE_PUBLISHABLE_KEY") ?? runtimeEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (direct) return direct;
  const keyset = runtimeEnv("SUPABASE_PUBLISHABLE_KEYS");
  if (keyset) {
    try {
      const parsed: unknown = JSON.parse(keyset);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = parsed as Record<string, unknown>;
        const key = [keys.default, ...Object.values(keys)]
          .find((v): v is string => typeof v === "string" && v.trim().startsWith("sb_publishable_"))
          ?.trim();
        if (key) return key;
      }
    } catch {
      // Malformed dictionary; fall back to legacy key.
    }
  }
  const legacy = runtimeEnv("SUPABASE_ANON_KEY") ?? runtimeEnv("VITE_SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  throw new Error("Clave pública del backend no configurada en el runtime MCP");
}

export function sbForUser(ctx: ToolContext): SupabaseClient {
  const token = ctx.getToken();
  if (!token) throw new Error("sbForUser requiere un token OAuth verificado");
  return createClient(supabaseProjectUrl(), supabasePublishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Human-readable matter title for MCP payloads.
 *
 * Never returns null, never returns a bare workflow_type (some legacy rows were
 * created with title='CGP'), and collapses very long party lists.
 */
const WORKFLOW_TOKENS = new Set([
  "CGP", "CPACA", "LABORAL", "PENAL_906", "PENAL", "TUTELA", "PETICION",
  "GOV_PROCEDURE", "GENERIC",
]);

function collapseParties(raw: string): string {
  const parts = raw
    .split(/\s*(?:,|;|\||\/| y otros? )\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 2) return parts.join(", ") || raw.trim();
  return `${parts.slice(0, 2).join(", ")} y ${parts.length - 2} más`;
}

export function workItemTitle(
  wi: Record<string, unknown> | null | undefined,
  fallback?: string | null,
): string {
  const raw = wi?.title ? String(wi.title).trim() : "";
  const normalized = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (raw && !WORKFLOW_TOKENS.has(normalized)) {
    return raw.length > 180 ? `${raw.slice(0, 177)}…` : raw;
  }
  const dte = wi?.demandantes ? collapseParties(String(wi.demandantes)) : "";
  const ddo = wi?.demandados ? collapseParties(String(wi.demandados)) : "";
  const partes = dte && ddo ? `${dte} vs ${ddo}` : dte || ddo;
  if (partes) return partes;
  if (wi?.radicado) return String(wi.radicado);
  return fallback ? String(fallback) : "Asunto sin título";
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
  if (json.length > MAX_JSON_CHARS) json = JSON.stringify(structuredContent);
  if (json.length > MAX_JSON_CHARS) {
    // Slicing the JSON used to produce a broken document that the model then
    // "completed" by guessing. Better to return no JSON block at all and say so.
    return {
      content: [
        {
          type: "text" as const,
          text:
            `${text}\n\nLa respuesta es demasiado extensa para incluirla completa. ` +
            `Reduce el parámetro \`limit\` o pide menos columnas: no se muestran datos parciales ` +
            `porque un fragmento podría leerse como el total.`,
        },
      ],
      structuredContent,
    };
  }
  return {
    content: [{ type: "text" as const, text: `${text}\n\n\`\`\`json\n${json}\n\`\`\`` }],
    structuredContent,
  };
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
 * Write guard for every mutating MCP tool.
 *
 * Fail-closed: OAuth scopes emitted by the authorization server are OIDC only
 * and never prove management consent. Write access requires an explicit
 * per-user, per-OAuth-client "manage" grant that the user activates from a
 * first-party Andromeda session (Conectar IA). The database derives the
 * caller's session and OAuth client itself (public.mcp_access_level) and
 * enforces the same gate on every write path, so this check is a fast,
 * user-friendly pre-flight — not the only barrier.
 */
export const MANAGE_REQUIRED =
  "Esta conexión de IA es de solo lectura. Para que el asistente pueda hacer cambios, el usuario debe activar «Permitir gestionar» para esta conexión en Andromeda → Conectar IA.";

export async function requireWriteScope(ctx: ToolContext): Promise<string | null> {
  const unauth = requireAuth(ctx);
  if (unauth) return unauth;
  const { data, error } = await sbForUser(ctx).rpc("mcp_access_level");
  if (error) return `No se pudo verificar el permiso de gestión: ${error.message}`;
  return data === "manage" || data === "first_party" ? null : MANAGE_REQUIRED;
}

/** Maps database errors from the mcp_* RPCs to caller-visible text. */
export function rpcErrorText(error: { message?: string; code?: string } | null | undefined): string {
  const msg = error?.message ?? "Error desconocido";
  switch (error?.code) {
    case "MCP01": return MANAGE_REQUIRED;
    case "MCP04": return `No encontrado o sin permiso: ${msg}`;
    case "MCP09": return `Conflicto (nada se modificó): ${msg}`;
    case "MCP22": return `Solicitud inválida (nada se modificó): ${msg}`;
    default: return msg;
  }
}

/** Shared description for the idempotency_key argument of every write tool. */
export const IDEMPOTENCY_KEY_DESCRIPTION =
  "Clave única (8-200 caracteres) para esta acción concreta. Si la respuesta se pierde, repite la llamada con la MISMA clave y los mismos datos: se devuelve el resultado ya confirmado sin repetir el cambio. Reusar la clave con otros datos es un error.";

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

/**
 * UTC instant for the start of a Bogota calendar day (fixed UTC-05:00).
 *
 * `fecha_fijacion` / `published_at` are timestamptz and rows land at 12:00+00,
 * so comparing them against a bare "YYYY-MM-DD" (cast to midnight UTC) never
 * matches. Always filter with [start of day, start of next day).
 */
export function bogotaDayStartUTC(day: string, offsetDays = 0): string {
  const base = new Date(`${day}T05:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString();
}

/**
 * Server-side platform-admin gate for the Atenia observability tools.
 *
 * The OAuth scope is NEVER enough: we validate the token's `sub` against
 * `platform_admins`. Returns an error string for non-admins, null otherwise.
 */
export const NOT_PLATFORM_ADMIN =
  "Esta herramienta está restringida a administradores de la plataforma.";

export async function requirePlatformAdmin(
  ctx: ToolContext,
): Promise<{ error: string | null; sb: SupabaseClient }> {
  const sb = sbForUser(ctx);
  const unauth = requireAuth(ctx);
  if (unauth) return { error: unauth, sb };
  const userId = ctx.getUserId?.();
  if (!userId) return { error: NOT_PLATFORM_ADMIN, sb };
  const { data, error } = await sb
    .from("platform_admins")
    .select("user_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return { error: NOT_PLATFORM_ADMIN, sb };
  return { error: null, sb };
}

/** Lifecycle states that make an instance a poor resolution target. */
const INACTIVE_LIFECYCLE = new Set(["DELETED", "ARCHIVED", "CLOSED", "TERMINATED"]);

function instanceSuffix(radicado: unknown): number {
  const d = digitsOf(String(radicado ?? ""));
  return d.length >= 23 ? Number(d.slice(21, 23)) : 0;
}

/**
 * Resolve a work item by UUID or radicado, scoped by RLS to the caller.
 *
 * The `radicado` argument accepts every normalized form of iteration 4.2:
 * canonical 23 digits, hyphenated, space-separated, 21-digit BASE, 22-digit
 * missing-leading-zero and BASE+instance. When a BASE matches several
 * instances (00, 01, …) the active one wins and the choice is reported back
 * through `note` so the agent can state it.
 */
export async function resolveWorkItem(
  sb: SupabaseClient,
  args: { id?: string; radicado?: string },
  columns = "id, radicado, title, workflow_type, stage, authority_name, client_id",
): Promise<{
  item: Record<string, unknown> | null;
  error: string | null;
  note?: string | null;
  candidates?: { id: string; radicado: string | null }[];
}> {
  const select = columns.includes("radicado_digits")
    ? columns
    : `${columns}, radicado_digits, lifecycle_state, updated_at`;

  if (args.id) {
    const { data, error } = await sb
      .from("work_items")
      .select(select)
      .is("deleted_at", null)
      .eq("id", args.id)
      .limit(1);
    if (error) return { item: null, error: error.message };
    const item = (data as unknown as Record<string, unknown>[])?.[0];
    return item
      ? { item, error: null, note: null }
      : { item: null, error: "Asunto no encontrado (o no pertenece a tu cuenta)." };
  }

  const raw = (args.radicado ?? "").trim();
  if (!raw) return { item: null, error: "Indica el id o el radicado del asunto." };

  const v = radicadoQueryVariants(raw);
  let rows: Record<string, unknown>[] = [];

  if (v.base21) {
    const { data, error } = await sb
      .from("work_items")
      .select(select)
      .is("deleted_at", null)
      .like("radicado_digits", `${v.base21}%`)
      .limit(20);
    if (error) return { item: null, error: error.message };
    rows = (data as unknown as Record<string, unknown>[]) ?? [];
  } else if (v.partial) {
    const { data, error } = await sb
      .from("work_items")
      .select(select)
      .is("deleted_at", null)
      .like("radicado_digits", `%${v.digits}%`)
      .limit(20);
    if (error) return { item: null, error: error.message };
    rows = (data as unknown as Record<string, unknown>[]) ?? [];
  } else {
    const { data, error } = await sb
      .from("work_items")
      .select(select)
      .is("deleted_at", null)
      .eq("radicado", raw)
      .limit(1);
    if (error) return { item: null, error: error.message };
    rows = (data as unknown as Record<string, unknown>[]) ?? [];
  }

  if (rows.length === 0) {
    return { item: null, error: "Asunto no encontrado (o no pertenece a tu cuenta)." };
  }
  if (rows.length === 1) return { item: rows[0], error: null, note: null };

  // Several instances share the BASE (or the fragment). Prefer an exact hit on
  // the 23-digit form the caller typed; otherwise the active instance.
  const exact = v.canonical23
    ? rows.find((r) => digitsOf(String(r.radicado ?? "")) === v.canonical23)
    : undefined;
  const ranked = [...rows].sort((a, b) => {
    const aInactive = INACTIVE_LIFECYCLE.has(String(a.lifecycle_state ?? "ACTIVE").toUpperCase());
    const bInactive = INACTIVE_LIFECYCLE.has(String(b.lifecycle_state ?? "ACTIVE").toUpperCase());
    if (aInactive !== bInactive) return aInactive ? 1 : -1;
    const bySuffix = instanceSuffix(b.radicado) - instanceSuffix(a.radicado);
    if (bySuffix !== 0) return bySuffix;
    return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  });
  const chosen = exact ?? ranked[0];
  const candidates = rows.map((r) => ({
    id: String(r.id),
    radicado: (r.radicado as string | null) ?? null,
  }));
  const note = exact
    ? `El radicado "${raw}" coincide con ${rows.length} instancias; se usó la coincidencia exacta ${chosen.radicado}.`
    : `El radicado "${raw}" coincide con ${rows.length} instancias (${candidates
        .map((c) => c.radicado ?? c.id)
        .join(", ")}); se resolvió a la instancia activa ${chosen.radicado}.`;
  return { item: chosen, error: null, note, candidates };
}

/**
 * Canonical workflow_type for MCP filters.
 *
 * The enum has no 'PENAL' value — the criminal type is PENAL_906. Legacy
 * callers (and LLMs guessing) still send 'PENAL', so it is accepted as a
 * defensive alias here and never emitted.
 */
export function canonicalWorkflowType(raw: string): string {
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (key === "PENAL" || key === "PENAL906" || key === "LEY_906") return "PENAL_906";
  if (key === "PROC_ADMIN" || key === "GOV_PROC") return "GOV_PROCEDURE";
  return key;
}
