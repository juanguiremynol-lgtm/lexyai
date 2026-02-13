import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptSecret } from "../_shared/secretsCrypto.ts";
import { validateUrl } from "../_shared/externalProviderClient.ts";
import { requireWizardSession, isWizardError } from "../_shared/requireWizardSession.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
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

    // Wizard session gate — accept both PLATFORM and ORG sessions
    const wizardResult = await requireWizardSession(req, user.id, corsHeaders, {
      allowPlatformAdminOverride: true,
    });
    if (isWizardError(wizardResult)) return wizardResult;

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
      scope: requestedScope,
    } = body;

    const instanceScope = requestedScope || "ORG";

    if (!connector_id || !name || !base_url || !auth_type || !secret_value) {
      return new Response(
        JSON.stringify({ error: "connector_id, name, base_url, auth_type, secret_value are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Scope-specific validation
    if (instanceScope === "PLATFORM") {
      // Platform admin only
      const { data: platformAdmin } = await adminClient
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!platformAdmin) {
        return new Response(JSON.stringify({ error: "Platform admin required for PLATFORM instances" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // organization_id must be null for PLATFORM
      if (organization_id) {
        return new Response(JSON.stringify({ error: "PLATFORM instances must not have organization_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // ORG scope — require org admin
      if (!organization_id) {
        return new Response(
          JSON.stringify({ error: "organization_id required for ORG instances" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
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

    // Create provider instance (or reuse existing for PLATFORM scope)
    let instance: any;
    const insertPayload = {
      organization_id: instanceScope === "PLATFORM" ? null : organization_id,
      connector_id,
      name,
      base_url,
      auth_type,
      timeout_ms: timeout_ms || 8000,
      rpm_limit: rpm_limit || 60,
      is_enabled: true,
      created_by: user.id,
      scope: instanceScope,
      created_by_role: instanceScope === "PLATFORM" ? "PLATFORM_ADMIN" : "ORG_ADMIN",
    };

    const { data: newInstance, error: instErr } = await adminClient
      .from("provider_instances")
      .insert(insertPayload)
      .select()
      .single();

    if (instErr) {
      if (instErr.code === "23505") {
        // Duplicate — find existing instance and update it instead
        const query = adminClient
          .from("provider_instances")
          .select("*")
          .eq("connector_id", connector_id)
          .eq("scope", instanceScope);

        if (instanceScope === "PLATFORM") {
          query.is("organization_id", null);
        } else {
          query.eq("organization_id", organization_id);
        }

        const { data: existing } = await query.maybeSingle();
        if (existing) {
          // Update the existing instance with new values
          const { data: updated } = await adminClient
            .from("provider_instances")
            .update({ name, base_url, auth_type, timeout_ms: timeout_ms || 8000, rpm_limit: rpm_limit || 60, is_enabled: true })
            .eq("id", existing.id)
            .select()
            .single();
          instance = updated || existing;
        } else {
          return new Response(
            JSON.stringify({ error: instErr.message, code: instErr.code }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } else {
        return new Response(
          JSON.stringify({ error: instErr.message, code: instErr.code }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      instance = newInstance;
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
    // Deactivate any existing secrets for this instance
    await adminClient
      .from("provider_instance_secrets")
      .update({ is_active: false })
      .eq("provider_instance_id", instance.id)
      .eq("is_active", true);

    const { error: secErr } = await adminClient
      .from("provider_instance_secrets")
      .insert({
        provider_instance_id: instance.id,
        organization_id: instanceScope === "PLATFORM" ? null : organization_id,
        key_version: 1,
        is_active: true,
        cipher_text: cipher,
        nonce,
        created_by: user.id,
        scope: instanceScope,
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
      organization_id: organization_id || "a0000000-0000-0000-0000-000000000001",
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
