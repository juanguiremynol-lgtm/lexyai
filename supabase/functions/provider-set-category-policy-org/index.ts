/**
 * provider-set-category-policy-org — Upsert org-specific merge policy override.
 * Org admin or platform admin only.
 *
 * Input: { organization_id, workflow, scope, strategy, merge_mode, ... }
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
    const { organization_id, workflow, scope, strategy, merge_mode,
      merge_budget_max_providers, merge_budget_max_ms,
      allow_merge_on_empty, max_provider_attempts_per_run, enabled } = body;

    if (!organization_id || !workflow || !scope) {
      return new Response(JSON.stringify({ error: "organization_id, workflow and scope required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify org admin or platform admin
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
      return new Response(JSON.stringify({ error: "Org admin or platform admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = {
      organization_id,
      workflow,
      scope,
      strategy: strategy || "SELECT",
      merge_mode: merge_mode || "UNION_PREFER_PRIMARY",
      merge_budget_max_providers: merge_budget_max_providers ?? 2,
      merge_budget_max_ms: merge_budget_max_ms ?? 15000,
      allow_merge_on_empty: allow_merge_on_empty ?? false,
      max_provider_attempts_per_run: max_provider_attempts_per_run ?? 2,
      enabled: enabled ?? true,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await adminClient
      .from("provider_category_policies_org_override")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("workflow", workflow)
      .eq("scope", scope)
      .maybeSingle();

    if (existing) {
      await adminClient
        .from("provider_category_policies_org_override")
        .update(payload)
        .eq("id", existing.id);
    } else {
      await adminClient
        .from("provider_category_policies_org_override")
        .insert(payload);
    }

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id,
      action_type: "ORG_POLICY_UPDATED",
      autonomy_tier: "USER",
      reasoning: `Org admin updated policy override for ${workflow}/${scope}`,
      target_entity_type: "provider_category_policies_org_override",
      evidence: { workflow, scope, strategy: payload.strategy, actor: user.id },
    });

    const { data: policies } = await adminClient
      .from("provider_category_policies_org_override")
      .select("*")
      .eq("organization_id", organization_id)
      .order("workflow")
      .order("scope");

    return new Response(
      JSON.stringify({ ok: true, policies }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
