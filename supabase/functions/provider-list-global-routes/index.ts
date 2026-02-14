/**
 * provider-list-global-routes — List all global category routes and policies.
 * Authenticated users can read (for preview). Returns connector instance coverage counts.
 *
 * Returns: { routes, policies, coverage: { connector_id → org_count } }
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

    // Fetch global routes with connector details
    const { data: routes, error: routesErr } = await adminClient
      .from("provider_category_routes_global")
      .select("*, provider_connectors(id, name, key, is_enabled)")
      .order("workflow")
      .order("scope")
      .order("route_kind")
      .order("priority");

    if (routesErr) {
      return new Response(JSON.stringify({ error: routesErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch global policies
    const { data: policies, error: policiesErr } = await adminClient
      .from("provider_category_policies_global")
      .select("*")
      .order("workflow")
      .order("scope");

    if (policiesErr) {
      return new Response(JSON.stringify({ error: policiesErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate coverage: how many orgs have an enabled instance per connector
    const connectorIds = [...new Set((routes || []).map((r: any) => r.provider_connector_id))];
    const coverage: Record<string, number> = {};
    const platform_instances: Record<string, boolean> = {};

    for (const cid of connectorIds) {
      const { count } = await adminClient
        .from("provider_instances")
        .select("id", { count: "exact", head: true })
        .eq("connector_id", cid)
        .eq("is_enabled", true);
      coverage[cid] = count || 0;

      // Check if a PLATFORM-scoped enabled instance exists
      const { count: platformCount } = await adminClient
        .from("provider_instances")
        .select("id", { count: "exact", head: true })
        .eq("connector_id", cid)
        .eq("scope", "PLATFORM")
        .eq("is_enabled", true);
      platform_instances[cid] = (platformCount || 0) > 0;
    }

    return new Response(
      JSON.stringify({ ok: true, routes: routes || [], policies: policies || [], coverage, platform_instances }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
