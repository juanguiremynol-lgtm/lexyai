/**
 * whatsapp-generate-link-code — Mints a one-time 6-digit code that a
 * user can send via WhatsApp to verify their phone as a linked identity.
 *
 * Caller must be authenticated (JWT verified via anon client). Platform
 * admins may generate a code for any user; org admins for their own org;
 * regular users only for themselves.
 *
 * Code lifecycle: sha-256 hash stored in whatsapp_link_codes; expires in
 * 15 minutes; consumed on first successful match by whatsapp-agent.
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const CODE_TTL_MINUTES = 15;

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input.trim()),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateNumericCode(): string {
  // 6 digits, zero-padded, cryptographically random
  const rand = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return rand.toString().padStart(6, "0");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userRes, error: userErr } = await authed.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const caller = userRes.user;

  const body = await req.json().catch(() => ({}));
  const targetUserId: string = (body as { user_id?: string }).user_id ?? caller.id;
  const targetOrgId: string | null = (body as { organization_id?: string | null }).organization_id ?? null;

  const svc = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Authorization check: platform admin OR caller-for-self OR org admin
  const { data: platAdminRow } = await svc
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", caller.id)
    .maybeSingle();
  const isPlatformAdmin = !!platAdminRow;

  let allowed = isPlatformAdmin || targetUserId === caller.id;
  if (!allowed && targetOrgId) {
    const { data: mem } = await svc
      .from("organization_memberships")
      .select("role")
      .eq("user_id", caller.id)
      .eq("organization_id", targetOrgId)
      .in("role", ["admin", "owner"])
      .maybeSingle();
    allowed = !!mem;
  }
  if (!allowed) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const code = generateNumericCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

  const { error: insertErr } = await svc.from("whatsapp_link_codes").insert({
    user_id: targetUserId,
    organization_id: targetOrgId,
    code_hash: codeHash,
    expires_at: expiresAt,
  } as never);

  if (insertErr) {
    return new Response(JSON.stringify({ error: insertErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      code,
      expires_at: expiresAt,
      ttl_minutes: CODE_TTL_MINUTES,
      instructions: `Envía este código de 6 dígitos por WhatsApp al número del bot. Expira en ${CODE_TTL_MINUTES} minutos.`,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});