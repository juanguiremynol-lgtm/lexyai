/**
 * outlook-callback — Microsoft redirects the browser here with ?code&state.
 * Exchanges the code server-side (PKCE) for tokens, stores them encrypted, and
 * closes the popup. The browser never touches a token.
 *
 * No JWT: identity comes from the HMAC-signed `state` minted by
 * outlook-connect, so the request cannot be forged or replayed after 15 min.
 *
 * Every Microsoft failure is classified and persisted with a plain-Spanish
 * explanation, so the UI can tell the lawyer what to do instead of showing a
 * raw AADSTS code.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  msConfig,
  verifyState,
  exchangeCode,
  encryptToken,
  decryptToken,
  graphGet,
  parseScopes,
  grantsSend,
} from "../_shared/outlookGraph.ts";
import {
  adminConsentUrl,
  classifyMsError,
  scopesFor,
  tenantFromToken,
} from "../_shared/msOAuth.ts";

function page(title: string, message: string, ok: boolean, extraHtml = "") {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
.card{max-width:28rem;padding:2rem;border-radius:1rem;background:#1e293b;text-align:center;line-height:1.5}
h1{font-size:1.1rem;margin:0 0 .5rem;color:${ok ? "#4ade80" : "#f87171"}}
p{font-size:.9rem;color:#94a3b8;margin:0}
a{color:#93c5fd;font-size:.8rem;word-break:break-all;display:inline-block;margin-top:1rem}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p>${extraHtml}</div>
<script>try{window.opener&&window.opener.postMessage({type:"outlook-oauth",ok:${ok}},"*");}catch(e){}
${ok ? 'setTimeout(function(){window.close();},1500);' : ""}
</script></body></html>`,
    { status: ok ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
  );
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const { clientId, clientSecret, redirectUri } = msConfig();

  const payload = state ? await verifyState(state) : null;

  /** Records the classified failure on the reserved row so the UI can react. */
  async function recordFailure(raw: unknown) {
    const failure = classifyMsError(raw);
    const consentUrl = failure.code === "ADMIN_CONSENT_REQUIRED" && clientId
      ? adminConsentUrl(clientId, redirectUri)
      : null;
    if (payload?.uid) {
      await adminClient()
        .from("user_email_connections")
        .update({
          status: "ERROR",
          failure_code: failure.code,
          failure_detail: String(raw).slice(0, 800),
          last_error: failure.message,
          admin_consent_url: consentUrl,
          pkce_verifier_cipher: null,
          pkce_verifier_nonce: null,
        })
        .eq("user_id", payload.uid as string)
        .eq("provider", "outlook");
    }
    const extra = consentUrl
      ? `<a href="${consentUrl}" target="_blank" rel="noopener">Enlace de autorización para su administrador</a>`
      : "";
    return page("No se pudo conectar", failure.message, false, extra);
  }

  if (oauthError) return await recordFailure(oauthError);
  if (!code) return await recordFailure("Microsoft no devolvió el código de autorización.");

  try {
    if (!payload?.uid) {
      return page("Sesión expirada", "Vuelva a intentar la conexión desde Andromeda.", false);
    }
    if (!clientId || !clientSecret) {
      return page("Integración no configurada", "Falta la configuración de Microsoft en Andromeda.", false);
    }

    const admin = adminClient();
    const { data: reserved } = await admin
      .from("user_email_connections")
      .select("id, pkce_verifier_cipher, pkce_verifier_nonce, pending_scopes")
      .eq("user_id", payload.uid as string)
      .eq("provider", "outlook")
      .maybeSingle();

    const verifier = reserved
      ? await decryptToken(
          (reserved as Record<string, string | null>).pkce_verifier_cipher,
          (reserved as Record<string, string | null>).pkce_verifier_nonce,
        )
      : null;
    const requested = ((reserved as { pending_scopes?: string[] } | null)?.pending_scopes) ??
      scopesFor(payload.send === true);

    let tokens;
    try {
      tokens = await exchangeCode(code, verifier, requested);
    } catch (e) {
      return await recordFailure(e);
    }

    const access = await encryptToken(tokens.access_token);
    const refresh = tokens.refresh_token ? await encryptToken(tokens.refresh_token) : null;
    const scopes = parseScopes(tokens.scope);
    const canSend = grantsSend(scopes);

    let accountEmail: string | null = null;
    try {
      const me = await graphGet("/me?$select=mail,userPrincipalName", tokens.access_token);
      accountEmail = (me.mail as string) ?? (me.userPrincipalName as string) ?? null;
    } catch (_e) { /* non-fatal */ }

    const { error } = await admin.from("user_email_connections").upsert(
      {
        user_id: payload.uid as string,
        organization_id: (payload.org as string) ?? null,
        provider: "outlook",
        ms_account_email: accountEmail,
        ms_tenant_id: tenantFromToken(tokens.access_token),
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
        failure_code: null,
        failure_detail: null,
        admin_consent_url: null,
        revoked_at: null,
        pkce_verifier_cipher: null,
        pkce_verifier_nonce: null,
        pending_scopes: null,
        connected_at: new Date().toISOString(),
        delta_token_inbox: null,
        delta_token_sent: null,
      },
      { onConflict: "user_id,organization_id,provider" },
    );
    if (error) throw new Error(error.message);

    return page(
      "Correo conectado",
      `Andromeda leerá los asuntos y remitentes de ${accountEmail ?? "su buzón"} para vincular correos a sus expedientes. No copia ni almacena el contenido de sus mensajes${
        canSend ? ". Además podrá enviar desde su cuenta cuando usted lo confirme correo por correo" : ""
      }. Puede cerrar esta ventana.`,
      true,
    );
  } catch (e) {
    console.error("[outlook-callback]", e);
    return await recordFailure(e);
  }
});
