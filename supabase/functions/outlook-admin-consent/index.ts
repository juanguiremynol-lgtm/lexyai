/**
 * outlook-admin-consent — Returns the tenant-wide admin-consent URL the lawyer
 * forwards to their IT administrator when their directory blocks third-party
 * apps (AADSTS65001 and friends).
 *
 * Once the administrator approves once, every user of that firm connects in a
 * single click.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, msConfig } from "../_shared/outlookGraph.ts";
import { adminConsentUrl } from "../_shared/msOAuth.ts";
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

    const { clientId, redirectUri } = msConfig();
    if (!clientId) return json({ error: "Integración de correo no configurada." }, 503);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await admin
      .from("user_email_connections")
      .select("ms_tenant_id")
      .eq("user_id", caller.userId)
      .eq("provider", "outlook")
      .maybeSingle();

    const tenant = (data as { ms_tenant_id?: string | null } | null)?.ms_tenant_id || "organizations";
    const url = adminConsentUrl(clientId, redirectUri, tenant);

    await admin
      .from("user_email_connections")
      .update({ admin_consent_url: url })
      .eq("user_id", caller.userId)
      .eq("provider", "outlook");

    return json({
      admin_consent_url: url,
      message:
        "Envíe este enlace a la persona que administra el correo de su firma. Al aprobarlo, usted podrá conectar su buzón en un clic.",
    });
  } catch (e) {
    console.error("[outlook-admin-consent]", e);
    return json({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
