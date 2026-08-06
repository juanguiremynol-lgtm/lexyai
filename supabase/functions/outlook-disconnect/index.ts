/**
 * outlook-disconnect — Ends the mailbox connection for the signed-in user.
 *
 * Two halves, and we are explicit about both:
 *   1. Andromeda's side: tokens are wiped and the row is marked REVOKED, so no
 *      further mailbox access is possible from here. Email links already
 *      inferred are kept (they are evidence).
 *   2. Microsoft's side: the delegated grant is removed with a best-effort
 *      Graph call; when the tenant does not allow the app to delete its own
 *      grant, we return the URL of Microsoft's own consent page so the user can
 *      finish the revocation there. The UI always shows that link.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, ensureAccessToken } from "../_shared/outlookGraph.ts";
import { resolveCaller } from "../_shared/callerIdentity.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Microsoft's own page where the user removes the consent they granted. */
function consentPage(tenantId: string | null) {
  return tenantId
    ? `https://myapps.microsoft.com/?tenantId=${tenantId}`
    : "https://myapps.microsoft.com/";
}

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
      .select(
        "id, ms_tenant_id, scopes, access_token_cipher, access_token_nonce, refresh_token_cipher, refresh_token_nonce, token_expires_at",
      )
      .eq("user_id", caller.userId)
      .eq("provider", "outlook")
      .maybeSingle();

    if (!conn) return json({ ok: true, message: "No había conexión activa." });

    // Best-effort revocation on Microsoft's side, with a real bearer token.
    let revokedOnMicrosoft = false;
    try {
      const token = await ensureAccessToken(admin, conn as never);
      const res = await fetch("https://graph.microsoft.com/v1.0/me/oauth2PermissionGrants", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { value?: Array<{ id?: string }> };
        for (const grant of body.value ?? []) {
          if (!grant.id) continue;
          const del = await fetch(
            `https://graph.microsoft.com/v1.0/oauth2PermissionGrants/${grant.id}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
          );
          if (del.ok) revokedOnMicrosoft = true;
        }
      }
    } catch (e) {
      console.warn("[outlook-disconnect] revocación remota no disponible:", e);
    }

    const { error } = await admin
      .from("user_email_connections")
      .update({
        status: "REVOKED",
        revoked_at: new Date().toISOString(),
        failure_code: null,
        failure_detail: null,
        last_error: null,
        access_token_cipher: null,
        access_token_nonce: null,
        refresh_token_cipher: null,
        refresh_token_nonce: null,
        pkce_verifier_cipher: null,
        pkce_verifier_nonce: null,
        pending_scopes: null,
        token_expires_at: null,
        delta_token_inbox: null,
        delta_token_sent: null,
        ms_account_email: null,
        can_send: false,
        connected_at: null,
      })
      .eq("id", (conn as { id: string }).id);
    if (error) throw new Error(error.message);

    return json({
      ok: true,
      revoked_on_microsoft: revokedOnMicrosoft,
      microsoft_consent_url: consentPage((conn as { ms_tenant_id: string | null }).ms_tenant_id),
      message: revokedOnMicrosoft
        ? "Conexión eliminada y permiso revocado en Microsoft."
        : "Conexión eliminada en Andromeda. Para retirar el permiso también en Microsoft, ábralo en «Mis aplicaciones» y elimine Andromeda.",
    });
  } catch (e) {
    console.error("[outlook-disconnect]", e);
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
