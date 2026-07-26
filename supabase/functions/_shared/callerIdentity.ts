/**
 * Shared caller-identity resolution for edge functions that run with the
 * service-role key.
 *
 * Service-role functions bypass RLS, so any identifier taken from the request
 * body (owner_id, organization_id, user_id) must be validated against the
 * caller's verified JWT — otherwise one tenant can act on another tenant's data.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

export type Caller =
  | { kind: "service" }
  | { kind: "user"; userId: string; isPlatformAdmin: boolean; orgIds: string[] }
  | { kind: "anon" };

const url = () => Deno.env.get("SUPABASE_URL")!;
const anonKey = () => Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Resolve the caller from the Authorization header. Never trusts the body. */
export async function resolveCaller(req: Request): Promise<Caller> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { kind: "anon" };

  try {
    const client = createClient(url(), anonKey());
    const { data, error } = await client.auth.getClaims(token);
    const claims = data?.claims as Record<string, unknown> | undefined;
    if (error || !claims) return { kind: "anon" };

    if (claims.role === "service_role") return { kind: "service" };

    const userId = typeof claims.sub === "string" ? claims.sub : null;
    if (!userId) return { kind: "anon" };

    const admin = createClient(url(), serviceKey());
    const [{ data: pa }, { data: memberships }] = await Promise.all([
      admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      admin.from("organization_memberships").select("organization_id").eq("user_id", userId),
    ]);

    return {
      kind: "user",
      userId,
      isPlatformAdmin: Boolean(pa),
      orgIds: (memberships ?? []).map((m: { organization_id: string }) => m.organization_id),
    };
  } catch (_e) {
    return { kind: "anon" };
  }
}

export function isPrivileged(caller: Caller): boolean {
  return caller.kind === "service" || (caller.kind === "user" && caller.isPlatformAdmin);
}

/** True when the caller may act on the given organization. */
export function canAccessOrg(caller: Caller, orgId: string | null | undefined): boolean {
  if (isPrivileged(caller)) return true;
  if (caller.kind !== "user" || !orgId) return false;
  return caller.orgIds.includes(orgId);
}

export function unauthorized(corsHeaders: Record<string, string>, message = "Unauthorized") {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function forbidden(corsHeaders: Record<string, string>, message = "Forbidden") {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
