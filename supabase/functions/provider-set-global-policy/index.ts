/**
 * provider-set-global-policy — Upsert global merge policy for a workflow/scope.
 * Platform admin only.
 *
 * Input: { workflow, scope, strategy, merge_mode, merge_budget_max_providers, merge_budget_max_ms, allow_merge_on_empty, max_provider_attempts_per_run, enabled }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // Verify platform admin
    const { data: platformAdmin } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!platformAdmin) {
      return new Response(JSON.stringify({ error: "Platform admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      workflow, scope, strategy, merge_mode,
      merge_budget_max_providers, merge_budget_max_ms,
      allow_merge_on_empty, max_provider_attempts_per_run, enabled,
    } = body;

    if (!workflow || !scope) {
      return new Response(JSON.stringify({ error: "workflow and scope required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = {
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
      .from("provider_category_policies_global")
      .select("id")
      .eq("workflow", workflow)
      .eq("scope", scope)
      .maybeSingle();

    if (existing) {
      await adminClient
        .from("provider_category_policies_global")
        .update(payload)
        .eq("id", existing.id);
    } else {
      await adminClient
        .from("provider_category_policies_global")
        .insert(payload);
    }

    // Audit
    await adminClient.from("atenia_ai_actions").insert({
      organization_id: "00000000-0000-0000-0000-000000000000",
      action_type: "GLOBAL_POLICY_UPDATED",
      autonomy_tier: "USER",
      reasoning: `Platform admin updated global policy for ${workflow}/${scope}`,
      target_entity_type: "provider_category_policies_global",
      evidence: { workflow, scope, strategy: payload.strategy, actor: user.id },
    });

    // Return all policies
    const { data: policies } = await adminClient
      .from("provider_category_policies_global")
      .select("*")
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
