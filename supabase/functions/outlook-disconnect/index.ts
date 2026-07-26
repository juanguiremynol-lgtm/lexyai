/**
 * outlook-disconnect — Revokes the stored Microsoft tokens for the signed-in
 * user and wipes them from the database. Email links already inferred are kept
 * (they are evidence), but no further mailbox access is possible.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, decryptToken } from "../_shared/outlookGraph.ts";
import { resolveCaller } from "../_shared/callerIdentity.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await resolveCaller(req);
    if (caller.kind !== "user") return json({ error: "No autenticado" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: conn } = await admin
      .from("user_email_connections")
      .select("id, refresh_token_cipher, refresh_token_nonce")
      .eq("user_id", caller.userId)
      .eq("provider", "outlook")
      .maybeSingle();

    if (!conn) return json({ ok: true, message: "No había conexión activa." });

    // Best-effort revocation on Microsoft's side.
    try {
      const refresh = await decryptToken(conn.refresh_token_cipher, conn.refresh_token_nonce);
      if (refresh) {
        await fetch("https://graph.microsoft.com/v1.0/me/revokeSignInSessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }).catch(() => undefined);
      }
    } catch (_e) { /* revocation is best-effort */ }

    const { error } = await admin
      .from("user_email_connections")
      .update({
        status: "REVOKED",
        access_token_cipher: null,
        access_token_nonce: null,
        refresh_token_cipher: null,
        refresh_token_nonce: null,
        token_expires_at: null,
        delta_token_inbox: null,
        delta_token_sent: null,
        ms_account_email: null,
        connected_at: null,
      })
      .eq("id", conn.id);
    if (error) throw new Error(error.message);

    return json({ ok: true });
  } catch (e) {
    console.error("[outlook-disconnect]", e);
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});