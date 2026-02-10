import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptSecret } from "../_shared/secretsCrypto.ts";
import { validateUrl } from "../_shared/externalProviderClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

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

    const adminClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const {
      organization_id,
      connector_id,
      name,
      base_url,
      auth_type,
      secret_value,
      timeout_ms,
      rpm_limit,
    } = body;

    if (!organization_id || !connector_id || !name || !base_url || !auth_type || !secret_value) {
      return new Response(
        JSON.stringify({ error: "organization_id, connector_id, name, base_url, auth_type, secret_value are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify org admin
    const { data: membership } = await adminClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Must be org admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load connector for domain allowlist
    const { data: connector, error: connErr } = await adminClient
      .from("provider_connectors")
      .select("*")
      .eq("id", connector_id)
      .single();

    if (connErr || !connector) {
      return new Response(JSON.stringify({ error: "Connector not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!connector.is_enabled) {
      return new Response(JSON.stringify({ error: "Connector is disabled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SSRF pre-validation of base_url
    try {
      validateUrl(base_url, connector.allowed_domains || []);
    } catch (ssrfErr: unknown) {
      const msg = ssrfErr instanceof Error ? ssrfErr.message : "SSRF validation failed";
      return new Response(
        JSON.stringify({ error: msg, code: "SSRF_BLOCKED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Create provider instance
    const { data: instance, error: instErr } = await adminClient
      .from("provider_instances")
      .insert({
        organization_id,
        connector_id,
        name,
        base_url,
        auth_type,
        timeout_ms: timeout_ms || 8000,
        rpm_limit: rpm_limit || 60,
        is_enabled: true,
        created_by: user.id,
      })
      .select()
      .single();

    if (instErr) {
      const status = instErr.code === "23505" ? 409 : 500;
      return new Response(
        JSON.stringify({ error: instErr.message, code: instErr.code }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Encrypt and store secret
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
    const { error: secErr } = await adminClient
      .from("provider_instance_secrets")
      .insert({
        provider_instance_id: instance.id,
        organization_id,
        key_version: 1,
        is_active: true,
        cipher_text: cipher,
        nonce,
        created_by: user.id,
      });

    if (secErr) {
      // Rollback instance
      await adminClient.from("provider_instances").delete().eq("id", instance.id);
      return new Response(
        JSON.stringify({ error: "Failed to store secret", detail: secErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id,
      action_type: "PROVIDER_INSTANCE_CREATE",
      autonomy_tier: "USER",
      reasoning: `Org admin created provider instance "${name}" for connector "${connector.key}"`,
      target_entity_type: "provider_instance",
      target_entity_id: instance.id,
      evidence: {
        connector_id,
        connector_key: connector.key,
        base_url_host: new URL(base_url).hostname,
        auth_type,
        duration_ms: Date.now() - startTime,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        instance: { ...instance },
        duration_ms: Date.now() - startTime,
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
