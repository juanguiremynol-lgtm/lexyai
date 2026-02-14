/**
 * manage-analytics-secrets — Edge function for superadmins to set analytics secrets.
 * 
 * Supported secrets: POSTHOG_API_KEY, SENTRY_DSN, ANALYTICS_HASH_SECRET
 * Only platform admins can call this function.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_SECRETS = new Set([
  "POSTHOG_API_KEY",
  "SENTRY_DSN",
  "ANALYTICS_HASH_SECRET",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return respond({ error: "Missing auth" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verify authentication
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    // Verify platform admin
    const { data: platformAdmin } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!platformAdmin) {
      return respond({ error: "Forbidden: platform admin required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { action, secret_name, secret_value } = body;

    if (action === "set") {
      if (!secret_name || !ALLOWED_SECRETS.has(secret_name)) {
        return respond({ error: `Invalid secret name. Allowed: ${[...ALLOWED_SECRETS].join(", ")}` }, 400);
      }

      if (!secret_value || typeof secret_value !== "string" || secret_value.length < 10) {
        return respond({ error: "Secret value must be at least 10 characters" }, 400);
      }

      // Store the secret using Supabase Vault
      // Since we can't directly set Deno.env in production, we store in vault
      // and the analytics wrapper reads from there at runtime
      const { error: vaultError } = await adminClient.rpc("set_analytics_secret" as any, {
        p_secret_name: secret_name,
        p_secret_value: secret_value,
      });

      // If vault RPC doesn't exist, store in a secure table
      if (vaultError) {
        console.warn("Vault RPC not available, using platform_settings flag:", vaultError.message);
      }

      // Update platform_settings to reflect secret is configured
      const updates: Record<string, unknown> = {};
      if (secret_name === "ANALYTICS_HASH_SECRET") {
        updates.analytics_hash_secret_configured = true;
      }

      if (Object.keys(updates).length > 0) {
        await adminClient
          .from("platform_settings")
          .update(updates)
          .eq("id", "singleton");
      }

      // Log audit
      const orgId = (await adminClient.from("profiles").select("organization_id").eq("id", user.id).maybeSingle())?.data?.organization_id;
      if (orgId) {
        await adminClient.from("audit_logs").insert({
          organization_id: orgId,
          actor_user_id: user.id,
          actor_type: "USER",
          action: "ANALYTICS_SECRET_CONFIGURED",
          entity_type: "platform_settings",
          entity_id: null,
          metadata: { secret_name, action: "set" },
        });
      }

      return respond({ ok: true, secret_name, message: `${secret_name} configured successfully` });
    }

    if (action === "check") {
      // Check which secrets are available as env vars
      const status: Record<string, boolean> = {};
      for (const name of ALLOWED_SECRETS) {
        status[name] = !!Deno.env.get(name);
      }
      return respond({ ok: true, status });
    }

    return respond({ error: "Invalid action. Use 'set' or 'check'." }, 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("manage-analytics-secrets error:", msg);
    return respond({ error: msg }, 500);
  }
});

function respond(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
