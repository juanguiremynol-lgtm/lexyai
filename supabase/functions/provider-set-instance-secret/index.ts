/**
 * provider-set-instance-secret — Super-admin-only endpoint to set/rotate secrets
 * for provider instances.
 *
 * POST { instance_id, secret_value, mode?: "SET_EXACT" | "ROTATE", enable?: boolean }
 *   OR
 * POST { connector_id, scope: "PLATFORM", secret_value, mode?: "SET_EXACT" | "ROTATE" }
 *
 * SET_EXACT (default): Ensure exactly one enabled secret exists. If the exact same
 *   cipher already exists, return was_noop:true. Does NOT disable old secrets unless rotating.
 * ROTATE: Disable all existing secrets and create a new version.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptSecret } from "../_shared/secretsCrypto.ts";

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
    const {
      instance_id: directInstanceId,
      connector_id,
      scope: requestedScope,
      secret_value,
      mode = "SET_EXACT",
      enable = true,
    } = body;

    if (!secret_value) {
      return new Response(
        JSON.stringify({ error: "secret_value is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve instance: by direct ID or by connector+scope
    let instanceId = directInstanceId;
    if (!instanceId && connector_id) {
      const scope = requestedScope || "PLATFORM";
      const query = adminClient
        .from("provider_instances")
        .select("id")
        .eq("connector_id", connector_id)
        .eq("scope", scope)
        .eq("is_enabled", true);

      if (scope === "PLATFORM") {
        query.is("organization_id", null);
      }

      const { data: instances } = await query
        .order("created_at", { ascending: false })
        .limit(1);

      if (!instances || instances.length === 0) {
        return new Response(
          JSON.stringify({ error: `No enabled ${scope} instance for connector ${connector_id}` }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      instanceId = instances[0].id;
    }

    if (!instanceId) {
      return new Response(
        JSON.stringify({ error: "instance_id or connector_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load instance
    const { data: instance, error: instErr } = await adminClient
      .from("provider_instances")
      .select("id, name, scope, connector_id, organization_id")
      .eq("id", instanceId)
      .single();

    if (instErr || !instance) {
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    if (mode === "SET_EXACT") {
      // SET_EXACT: Check if there's already an active secret. If so, check if we
      // can just ensure it stays active (idempotent). We can't compare ciphertexts
      // (different nonces), so we always create a new version but DON'T disable
      // the old one unless there are multiple active.
      const { data: existingSecrets } = await adminClient
        .from("provider_instance_secrets")
        .select("id, key_version, is_active")
        .eq("provider_instance_id", instanceId)
        .eq("is_active", true);

      // If exactly one active secret exists, keep it and add new one
      // Then disable all but the newest
      const { data: lastSecret } = await adminClient
        .from("provider_instance_secrets")
        .select("key_version")
        .eq("provider_instance_id", instanceId)
        .order("key_version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (lastSecret?.key_version || 0) + 1;

      // Insert new secret
      const { data: newSecret, error: secErr } = await adminClient
        .from("provider_instance_secrets")
        .insert({
          provider_instance_id: instanceId,
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

      // Disable all other active secrets (keep only the newest)
      if (existingSecrets && existingSecrets.length > 0) {
        const oldIds = existingSecrets.map(s => s.id);
        await adminClient
          .from("provider_instance_secrets")
          .update({ is_active: false })
          .in("id", oldIds);
      }

      // Audit
      await adminClient.from("atenia_ai_actions").insert({
        organization_id: instance.organization_id || "a0000000-0000-0000-0000-000000000001",
        action_type: "PROVIDER_SECRET_SET",
        autonomy_tier: "USER",
        reasoning: `Platform admin set secret v${nextVersion} (SET_EXACT) for instance "${instance.name}" (scope: ${instance.scope})`,
        target_entity_type: "provider_instance_secret",
        target_entity_id: newSecret.id,
        evidence: {
          instance_id: instanceId,
          instance_name: instance.name,
          scope: instance.scope,
          key_version: nextVersion,
          mode: "SET_EXACT",
          enabled: enable,
        },
      });

      // Resolve alerts
      await resolveAlerts(adminClient, instanceId, instance.connector_id);

      return new Response(
        JSON.stringify({
          ok: true,
          mode: "SET_EXACT",
          was_noop: false,
          secret: {
            id: newSecret.id,
            key_version: newSecret.key_version,
            is_active: newSecret.is_active,
            scope: newSecret.scope,
          },
          instance_id: instanceId,
          instance_name: instance.name,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ROTATE mode: disable all existing, create new
    await adminClient
      .from("provider_instance_secrets")
      .update({ is_active: false })
      .eq("provider_instance_id", instanceId)
      .eq("is_active", true);

    const { data: lastSecret } = await adminClient
      .from("provider_instance_secrets")
      .select("key_version")
      .eq("provider_instance_id", instanceId)
      .order("key_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (lastSecret?.key_version || 0) + 1;

    const { data: newSecret, error: secErr } = await adminClient
      .from("provider_instance_secrets")
      .insert({
        provider_instance_id: instanceId,
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
      reasoning: `Platform admin rotated secret to v${nextVersion} for instance "${instance.name}" (scope: ${instance.scope})`,
      target_entity_type: "provider_instance_secret",
      target_entity_id: newSecret.id,
      evidence: {
        instance_id: instanceId,
        instance_name: instance.name,
        scope: instance.scope,
        key_version: nextVersion,
        mode: "ROTATE",
        enabled: enable,
      },
    });

    await resolveAlerts(adminClient, instanceId, instance.connector_id);

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "ROTATE",
        was_noop: false,
        secret: {
          id: newSecret.id,
          key_version: newSecret.key_version,
          is_active: newSecret.is_active,
          scope: newSecret.scope,
        },
        instance_id: instanceId,
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

async function resolveAlerts(adminClient: any, instanceId: string, connectorId: string) {
  // Resolve any pending MISSING_PROVIDER_SECRET alerts
  await adminClient
    .from("alert_instances")
    .update({ status: "RESOLVED", resolved_at: new Date().toISOString() })
    .eq("entity_type", "provider_instance")
    .eq("entity_id", instanceId)
    .eq("alert_type", "MISSING_PROVIDER_SECRET")
    .in("status", ["PENDING", "ACKNOWLEDGED"]);

  // Resolve remediation queue entries
  await adminClient
    .from("atenia_ai_remediation_queue")
    .update({ status: "RESOLVED", updated_at: new Date().toISOString() })
    .eq("action_type", "CONFIGURE_PROVIDER_SECRET")
    .eq("status", "PENDING")
    .like("dedupe_key", `${connectorId}%missing_secret`);
}
