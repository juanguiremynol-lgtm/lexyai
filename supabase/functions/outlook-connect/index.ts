/**
 * outlook-connect — Starts the Microsoft authorization-code flow (PKCE) for the
 * signed-in user against the MULTI-TENANT Andromeda app registration.
 *
 * The subscriber authenticates on Microsoft's own screen, inside their own
 * directory. Andromeda never sees their password and never asks them for a
 * client id or secret.
 *
 * Read-only by construction: only Mail.Read, offline_access and User.Read are
 * requested at connection time. Mail.Send is asked for incrementally, the first
 * time the user actually sends something (`include_send: true`).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  msConfig,
  authorityBase,
  signState,
  encryptToken,
} from "../_shared/outlookGraph.ts";
import {
  adminConsentUrl,
  createPkceVerifier,
  pkceChallenge,
  scopesFor,
} from "../_shared/msOAuth.ts";
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

    const { clientId, clientSecret, tenant, redirectUri } = msConfig();
    if (!clientId || !clientSecret) {
      return json(
        {
          error:
            "La integración de correo no está configurada en Andromeda. Escríbanos para habilitarla.",
        },
        503,
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const organizationId =
      typeof body.organization_id === "string" && caller.orgIds.includes(body.organization_id)
        ? body.organization_id
        : caller.orgIds[0] ?? null;
    const includeSend = body.include_send === true;
    const scopes = scopesFor(includeSend);

    // PKCE: the verifier stays server-side, encrypted, next to the reservation.
    const verifier = createPkceVerifier();
    const challenge = await pkceChallenge(verifier);
    const sealed = await encryptToken(verifier);

    // Reserve the connection row so the callback only has to fill in tokens.
    await admin.from("user_email_connections").upsert(
      {
        user_id: caller.userId,
        organization_id: organizationId,
        provider: "outlook",
        status: "PENDING",
        last_error: null,
        failure_code: null,
        failure_detail: null,
        pkce_verifier_cipher: sealed.cipherHex,
        pkce_verifier_nonce: sealed.nonceHex,
        pending_scopes: scopes,
      },
      { onConflict: "user_id,organization_id,provider" },
    );

    const state = await signState({ uid: caller.userId, org: organizationId, send: includeSend });
    const url = new URL(`${authorityBase(tenant)}/authorize`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");

    return json({
      authorize_url: url.toString(),
      redirect_uri: redirectUri,
      scopes,
      /** Shareable with the customer's IT administrator when their tenant requires it. */
      admin_consent_url: adminConsentUrl(clientId, redirectUri),
    });
  } catch (e) {
    console.error("[outlook-connect]", e);
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
