/**
 * provider-set-instance-secret — Super-admin-only endpoint to set/rotate secrets
 * for provider instances. Temporary bridge until wizard StepInstance fully supports
 * secret management for existing instances.
 *
 * POST { instance_id, secret_value, enable?: boolean }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptSecret, bytesToB64 } from "../_shared/secretsCrypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
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

    // Allow service-role key as direct auth (for programmatic access)
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceKey;

    let userId: string | null = null;

    if (isServiceRole) {
      userId = "00000000-0000-0000-0000-000000000000"; // system actor
    } else {
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
      userId = user.id;

      // Platform admin check (only for non-service-role)
      const adminClient2 = createClient(supabaseUrl, serviceKey);
      const { data: platformAdmin } = await adminClient2
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

    const adminClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { instance_id, secret_value, enable = true } = body;

    if (!instance_id || !secret_value) {
      return new Response(
        JSON.stringify({ error: "instance_id and secret_value are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load instance
    const { data: instance, error: instErr } = await adminClient
      .from("provider_instances")
      .select("id, name, scope, connector_id, organization_id")
      .eq("id", instance_id)
      .single();

    if (instErr || !instance) {
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deactivate existing secrets for this instance
    await adminClient
      .from("provider_instance_secrets")
      .update({ is_active: false })
      .eq("provider_instance_id", instance_id)
      .eq("is_active", true);

    // Get next version number
    const { data: lastSecret } = await adminClient
      .from("provider_instance_secrets")
      .select("key_version")
      .eq("provider_instance_id", instance_id)
      .order("key_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (lastSecret?.key_version || 0) + 1;

    // Encrypt
    let encResult: { cipher: Uint8Array; nonce: Uint8Array };
    try {
      encResult = await encryptSecret(secret_value);
    } catch (encErr: unknown) {
      const msg = encErr instanceof Error ? encErr.message : String(encErr);
      const isMissingKey = msg.includes("Missing env") || msg.includes("ATENIA_SECRETS_KEY_B64");
      return new Response(
        JSON.stringify({
          error: isMissingKey
            ? "Server misconfigured: missing encryption key (ATENIA_SECRETS_KEY_B64). Contact platform admin."
            : `Encryption failed: ${msg}`,
          code: isMissingKey ? "MISSING_ENCRYPTION_KEY" : "ENCRYPTION_ERROR",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { cipher, nonce } = encResult;
    const { data: newSecret, error: secErr } = await adminClient
      .from("provider_instance_secrets")
      .insert({
        provider_instance_id: instance_id,
        organization_id: instance.scope === "PLATFORM" ? null : instance.organization_id,
        key_version: nextVersion,
        is_active: enable,
        cipher_text: cipher,
        nonce,
        created_by: userId,
        scope: instance.scope || "ORG",
      })
      .select("id, key_version, is_active, scope")
      .single();

    if (secErr) {
      return new Response(
        JSON.stringify({ error: "Failed to store secret", detail: secErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id: instance.organization_id || "a0000000-0000-0000-0000-000000000001",
      action_type: "PROVIDER_SECRET_SET",
      autonomy_tier: "USER",
      reasoning: `Platform admin set secret v${nextVersion} for instance "${instance.name}" (scope: ${instance.scope})`,
      target_entity_type: "provider_instance_secret",
      target_entity_id: newSecret.id,
      evidence: {
        instance_id,
        instance_name: instance.name,
        scope: instance.scope,
        key_version: nextVersion,
        enabled: enable,
      },
    });

    // Resolve any pending MISSING_PROVIDER_SECRET alerts
    await adminClient
      .from("alert_instances")
      .update({ status: "RESOLVED", resolved_at: new Date().toISOString() })
      .eq("entity_type", "provider_instance")
      .eq("entity_id", instance_id)
      .eq("alert_type", "MISSING_PROVIDER_SECRET")
      .in("status", ["PENDING", "ACKNOWLEDGED"]);

    // Resolve remediation queue entries
    await adminClient
      .from("atenia_ai_remediation_queue")
      .update({ status: "RESOLVED", updated_at: new Date().toISOString() })
      .eq("action_type", "CONFIGURE_PROVIDER_SECRET")
      .eq("status", "PENDING")
      .like("dedupe_key", `${instance.connector_id}%missing_secret`);

    return new Response(
      JSON.stringify({
        ok: true,
        secret: {
          id: newSecret.id,
          key_version: newSecret.key_version,
          is_active: newSecret.is_active,
          scope: newSecret.scope,
        },
        instance_id,
        instance_name: instance.name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
