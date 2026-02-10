/**
 * provider-list-effective-routing — Returns resolved effective policy+chain for an org/workflow/scope.
 * Shows source: ORG_OVERRIDE vs GLOBAL vs BUILTIN.
 * Any authenticated admin can call.
 *
 * Input: { organization_id, workflow?, scope? }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveEffectivePolicyAndChain } from "../_shared/resolveProviderChain.ts";
import type { GlobalRoute, ResolvedInstance, EffectivePolicy } from "../_shared/resolveProviderChain.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYNC_WORKFLOWS = ["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"];
const SCOPES = ["ACTS", "PUBS"] as const;

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
    const body = await req.json();
    const { organization_id, workflow: filterWorkflow, scope: filterScope } = body;

    if (!organization_id) {
      return new Response(JSON.stringify({ error: "organization_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all data in parallel
    const [globalRoutesRes, orgRoutesRes, globalPoliciesRes, orgPoliciesRes, orgInstancesRes] = await Promise.all([
      adminClient.from("provider_category_routes_global")
        .select("*, provider_connectors(id, name, key, is_enabled)")
        .order("workflow").order("scope").order("route_kind").order("priority"),
      adminClient.from("provider_category_routes_org_override")
        .select("*, provider_connectors(id, name, key, is_enabled)")
        .eq("organization_id", organization_id)
        .order("workflow").order("scope").order("route_kind").order("priority"),
      adminClient.from("provider_category_policies_global")
        .select("*").order("workflow").order("scope"),
      adminClient.from("provider_category_policies_org_override")
        .select("*")
        .eq("organization_id", organization_id)
        .order("workflow").order("scope"),
      adminClient.from("provider_instances")
        .select("id, connector_id, name, is_enabled")
        .eq("organization_id", organization_id)
        .eq("is_enabled", true),
    ]);

    const globalRoutes = (globalRoutesRes.data || []).map((r: any) => ({
      ...r,
      provider_connector_id: r.provider_connector_id,
      connector_name: r.provider_connectors?.name,
    })) as GlobalRoute[];

    const orgRoutes = (orgRoutesRes.data || []).map((r: any) => ({
      ...r,
      provider_connector_id: r.provider_connector_id,
      connector_name: r.provider_connectors?.name,
    })) as GlobalRoute[];

    const orgInstances: ResolvedInstance[] = (orgInstancesRes.data || []).map((i: any) => ({
      provider_connector_id: i.connector_id,
      provider_instance_id: i.id,
      provider_name: i.name,
    }));

    const globalPolicies = globalPoliciesRes.data || [];
    const orgPolicies = orgPoliciesRes.data || [];

    const workflows = filterWorkflow ? [filterWorkflow] : SYNC_WORKFLOWS;
    const scopes = filterScope ? [filterScope as "ACTS" | "PUBS"] : [...SCOPES];

    const results: any[] = [];

    for (const wf of workflows) {
      for (const sc of scopes) {
        const gp = globalPolicies.find((p: any) => p.workflow === wf && (p.scope === sc || p.scope === "BOTH"));
        const op = orgPolicies.find((p: any) => p.workflow === wf && (p.scope === sc || p.scope === "BOTH"));

        const resolution = resolveEffectivePolicyAndChain({
          workflow: wf,
          scope: sc,
          orgOverrideRoutes: orgRoutes,
          globalRoutes,
          orgInstances,
          orgOverridePolicy: op as any,
          globalPolicy: gp as any,
        });

        results.push({
          workflow: wf,
          scope: sc,
          routeSource: resolution.routeSource,
          policy: resolution.policy,
          chain: resolution.chain,
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        organization_id,
        resolutions: results,
        org_override_count: orgRoutes.filter((r: any) => r.enabled).length,
        global_route_count: globalRoutes.filter((r: any) => r.enabled).length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
