/**
 * outlook-callback — Microsoft redirects the browser here with ?code&state.
 * Exchanges the code for tokens, stores them encrypted, and closes the popup.
 *
 * No JWT: identity comes from the HMAC-signed `state` minted by
 * outlook-connect, so the request cannot be forged or replayed after 15 min.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  msConfig,
  verifyState,
  exchangeCode,
  encryptToken,
  graphGet,
  parseScopes,
  grantsSend,
} from "../_shared/outlookGraph.ts";

function page(title: string, message: string, ok: boolean) {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
.card{max-width:26rem;padding:2rem;border-radius:1rem;background:#1e293b;text-align:center;line-height:1.5}
h1{font-size:1.1rem;margin:0 0 .5rem;color:${ok ? "#4ade80" : "#f87171"}}
p{font-size:.9rem;color:#94a3b8;margin:0}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div>
<script>try{window.opener&&window.opener.postMessage({type:"outlook-oauth",ok:${ok}},"*");}catch(e){}
setTimeout(function(){window.close();},${ok ? 1200 : 6000});</script>
</body></html>`,
    { status: ok ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (oauthError) return page("No se pudo conectar", oauthError, false);
  if (!code) return page("No se pudo conectar", "Microsoft no devolvió el código de autorización.", false);

  try {
    const payload = await verifyState(state);
    if (!payload?.uid) {
      return page("Sesión expirada", "Vuelve a intentar la conexión desde Andromeda.", false);
    }

    const { clientId, clientSecret } = msConfig();
    if (!clientId || !clientSecret) {
      return page("Integración no configurada", "Faltan las credenciales de Azure.", false);
    }

    const tokens = await exchangeCode(code);
    const access = await encryptToken(tokens.access_token);
    const refresh = tokens.refresh_token ? await encryptToken(tokens.refresh_token) : null;
    const scopes = parseScopes(tokens.scope);
    const canSend = grantsSend(scopes);

    let accountEmail: string | null = null;
    try {
      const me = await graphGet("/me?$select=mail,userPrincipalName", tokens.access_token);
      accountEmail = (me.mail as string) ?? (me.userPrincipalName as string) ?? null;
    } catch (_e) { /* non-fatal */ }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await admin.from("user_email_connections").upsert(
      {
        user_id: payload.uid as string,
        organization_id: (payload.org as string) ?? null,
        provider: "outlook",
        ms_account_email: accountEmail,
        scopes,
        can_send: canSend,
        access_token_cipher: access.cipherHex,
        access_token_nonce: access.nonceHex,
        ...(refresh
          ? { refresh_token_cipher: refresh.cipherHex, refresh_token_nonce: refresh.nonceHex }
          : {}),
        token_expires_at: new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString(),
        status: "CONNECTED",
        last_error: null,
        connected_at: new Date().toISOString(),
        delta_token_inbox: null,
        delta_token_sent: null,
      },
      { onConflict: "user_id,provider" },
    );
    if (error) throw new Error(error.message);

    return page(
      "Outlook conectado",
      `Andromeda leerá los metadatos de ${accountEmail ?? "tu buzón"} para vincular correos a tus expedientes${
        canSend ? " y podrá enviar correos en tu nombre cuando tú lo pidas" : ""
      }. Puedes cerrar esta ventana.`,
      true,
    );
  } catch (e) {
    console.error("[outlook-callback]", e);
    return page("No se pudo conectar", e instanceof Error ? e.message : "Error inesperado", false);
  }
});