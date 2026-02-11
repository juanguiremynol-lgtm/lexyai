/**
 * provider-create-connector — Create a provider connector template.
 * Supports GLOBAL (platform admin) and ORG_PRIVATE (org admin) visibility.
 *
 * Input: { key, name, description, capabilities, allowed_domains, schema_version, visibility?, organization_id? }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireWizardSession, isWizardError } from "../_shared/requireWizardSession.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session",
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Wizard session gate
    const wizardResult = await requireWizardSession(req, user.id, corsHeaders, {
      allowPlatformAdminOverride: true,
    });
    if (isWizardError(wizardResult)) return wizardResult;

    const body = await req.json();
    const { key, name, description, capabilities, allowed_domains, schema_version, visibility, organization_id } = body;
    const effectiveVisibility = visibility || "GLOBAL";

    if (!key || !name) {
      return new Response(JSON.stringify({ error: "key and name are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Permission check based on visibility
    if (effectiveVisibility === "GLOBAL") {
      const { data: adminRow } = await adminClient
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!adminRow) {
        return new Response(JSON.stringify({ error: "Platform admin required for GLOBAL connectors" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (effectiveVisibility === "ORG_PRIVATE") {
      if (!organization_id) {
        return new Response(JSON.stringify({ error: "organization_id required for ORG_PRIVATE connectors" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Check org admin/owner or platform admin
      const { data: membership } = await adminClient
        .from("organization_memberships")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", organization_id)
        .maybeSingle();
      const { data: platformAdmin } = await adminClient
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!platformAdmin && (!membership || !["admin", "owner"].includes(membership.role))) {
        return new Response(JSON.stringify({ error: "Org admin required for ORG_PRIVATE connectors" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      return new Response(JSON.stringify({ error: `Invalid visibility: ${effectiveVisibility}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: connector, error: insertErr } = await adminClient
      .from("provider_connectors")
      .insert({
        key,
        name,
        description: description || null,
        schema_version: schema_version || "atenia.v1",
        capabilities: capabilities || [],
        allowed_domains: allowed_domains || [],
        is_enabled: true,
        created_by: user.id,
        visibility: effectiveVisibility,
        organization_id: effectiveVisibility === "ORG_PRIVATE" ? organization_id : null,
      })
      .select()
      .single();

    if (insertErr) {
      const status = insertErr.code === "23505" ? 409 : 500;
      return new Response(
        JSON.stringify({ error: insertErr.message, code: insertErr.code }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id: organization_id || "a0000000-0000-0000-0000-000000000001",
      action_type: "PROVIDER_CONNECTOR_CREATE",
      autonomy_tier: "USER",
      reasoning: `${effectiveVisibility} connector "${key}" created`,
      target_entity_type: "provider_connector",
      target_entity_id: connector.id,
      evidence: {
        key, name, visibility: effectiveVisibility,
        capabilities: capabilities || [],
        duration_ms: Date.now() - startTime,
      },
    });

    return new Response(
      JSON.stringify({ ok: true, connector, duration_ms: Date.now() - startTime }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
