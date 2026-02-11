import { createClient } from "npm:@supabase/supabase-js@2";
import { encryptSecret } from "../_shared/secretsCrypto.ts";
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

    const db = createClient(supabaseUrl, serviceKey);

    // Wizard session gate
    const wizardResult = await requireWizardSession(req, user.id, corsHeaders, {
      allowPlatformAdminOverride: true,
    });
    if (isWizardError(wizardResult)) return wizardResult;

    const body = await req.json();
    const { provider_instance_id, new_secret_value } = body;

    if (!provider_instance_id || !new_secret_value) {
      return new Response(
        JSON.stringify({ error: "provider_instance_id and new_secret_value required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load instance
    const { data: instance } = await db
      .from("provider_instances")
      .select("id, organization_id, name")
      .eq("id", provider_instance_id)
      .single();

    if (!instance) {
      return new Response(JSON.stringify({ error: "Instance not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify org admin
    const { data: membership } = await db
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", instance.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Must be org admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get current max key_version
    const { data: currentSecret } = await db
      .from("provider_instance_secrets")
      .select("key_version")
      .eq("provider_instance_id", provider_instance_id)
      .eq("is_active", true)
      .single();

    const newVersion = (currentSecret?.key_version || 0) + 1;

    // Deactivate old secret
    await db
      .from("provider_instance_secrets")
      .update({ is_active: false, rotated_at: new Date().toISOString() })
      .eq("provider_instance_id", provider_instance_id)
      .eq("is_active", true);

    // Encrypt and insert new secret
    const { cipher, nonce } = await encryptSecret(new_secret_value);
    const { error: insertErr } = await db
      .from("provider_instance_secrets")
      .insert({
        provider_instance_id,
        organization_id: instance.organization_id,
        key_version: newVersion,
        is_active: true,
        cipher_text: cipher,
        nonce,
        created_by: user.id,
      });

    if (insertErr) {
      return new Response(
        JSON.stringify({ error: "Failed to store new secret", detail: insertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Audit
    await db.from("atenia_ai_actions").insert({
      organization_id: instance.organization_id,
      action_type: "PROVIDER_INSTANCE_ROTATE_SECRET",
      autonomy_tier: "USER",
      reasoning: `Rotated secret for provider instance "${instance.name}" to version ${newVersion}`,
      target_entity_type: "provider_instance",
      target_entity_id: instance.id,
      evidence: {
        new_key_version: newVersion,
        duration_ms: Date.now() - startTime,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        key_version: newVersion,
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
