/**
 * provider-secret-readiness — Super-admin-only diagnostic endpoint.
 * Returns secret health status WITHOUT exposing any secret material.
 *
 * GET ?connector_id=...
 * GET ?instance_id=...
 *
 * Returns: connector_id, resolved_instance_id, instance_scope, instance_enabled,
 *          active_secret_count, can_decrypt, last_secret_updated_at, failure_reason
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveActiveSecret, resolveActiveSecretByConnector } from "../_shared/resolveActiveSecret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authenticate
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceKey;

    if (!isServiceRole) {
      const userClient = createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Platform admin check
      const adminClient = createClient(supabaseUrl, serviceKey);
      const { data: platformAdmin } = await adminClient
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!platformAdmin) {
        return new Response(JSON.stringify({ error: "Platform admin required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const db = createClient(supabaseUrl, serviceKey);
    const url = new URL(req.url);
    const connectorId = url.searchParams.get("connector_id");
    const instanceId = url.searchParams.get("instance_id");
    const scope = (url.searchParams.get("scope") || "PLATFORM") as "PLATFORM" | "ORG";

    if (!connectorId && !instanceId) {
      return new Response(
        JSON.stringify({ error: "connector_id or instance_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve
    const result = instanceId
      ? await resolveActiveSecret(db, instanceId)
      : await resolveActiveSecretByConnector(db, connectorId!, scope);

    // Count all secrets for the instance (for diagnostics)
    let activeSecretCount = 0;
    let connectorKey: string | null = null;
    const resolvedInstanceId = result.ok ? result.instance_id : (result as any).instance_id;

    if (resolvedInstanceId) {
      const { count } = await db
        .from("provider_instance_secrets")
        .select("id", { count: "exact", head: true })
        .eq("provider_instance_id", resolvedInstanceId)
        .eq("is_active", true);
      activeSecretCount = count || 0;

      // Get connector key
      const { data: inst } = await db
        .from("provider_instances")
        .select("connector_id, provider_connectors(key)")
        .eq("id", resolvedInstanceId)
        .maybeSingle();
      connectorKey = (inst?.provider_connectors as any)?.key || null;
    }

    // Build response — NEVER include secret material
    const failureReason = result.ok ? null : (result as any).failure_reason;
    const remediationHint = failureReason === "DECRYPT_FAILED"
      ? "Run REENCRYPT_SAME_VALUE: paste the same provider API key in the Wizard (Step Instance → Re-encriptar). The platform key is unchanged; only the ciphertext is regenerated."
      : failureReason === "MISSING_SECRET"
      ? "Configure an active API key in the Wizard (Step Instance → Configurar Secreto)."
      : failureReason === "KEY_MISSING"
      ? "ATENIA_SECRETS_KEY_B64 environment variable is not set. Contact platform operator."
      : null;

    const response: Record<string, unknown> = {
      connector_id: connectorId || null,
      connector_key: connectorKey,
      resolved_instance_id: resolvedInstanceId || null,
      instance_scope: result.ok ? result.instance_scope : (result as any).instance_scope,
      instance_enabled: result.ok ? result.instance_enabled : (result as any).instance_enabled,
      active_secret_count: activeSecretCount,
      can_decrypt: result.ok,
      last_secret_updated_at: result.ok ? result.last_updated_at : null,
      failure_reason: failureReason,
      failure_detail: result.ok ? null : (result as any).detail,
      remediation_hint: remediationHint,
    };

    if (result.ok) {
      response.key_version = result.key_version;
      response.secret_scope = result.secret_scope;
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
