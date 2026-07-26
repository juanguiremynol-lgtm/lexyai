/**
 * outlook-connect — Starts the Microsoft authorization-code flow for the
 * signed-in user. Returns the authorize URL; the client opens it.
 *
 * Read-only by construction: only Mail.Read, offline_access and User.Read are
 * ever requested.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  msConfig,
  authorityBase,
  signState,
  GRAPH_SCOPES,
} from "../_shared/outlookGraph.ts";
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
            "La integración con Outlook no está configurada. Faltan las credenciales de Azure (MS_CLIENT_ID / MS_CLIENT_SECRET).",
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

    // Reserve the connection row so the callback only has to fill in tokens.
    await admin.from("user_email_connections").upsert(
      {
        user_id: caller.userId,
        organization_id: organizationId,
        provider: "outlook",
        status: "PENDING",
        last_error: null,
      },
      { onConflict: "user_id,provider" },
    );

    const state = await signState({ uid: caller.userId, org: organizationId });
    const url = new URL(`${authorityBase(tenant)}/authorize`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", GRAPH_SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");

    return json({ authorize_url: url.toString(), redirect_uri: redirectUri });
  } catch (e) {
    console.error("[outlook-connect]", e);
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});