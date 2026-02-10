import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check platform admin
    const { data: adminRec } = await supabase
      .from("platform_admins")
      .select("user_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    // Get user org
    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    const workflows = ["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906", "PETICION", "GOV_PROCEDURE"];
    const scopes = ["ACTS", "PUBS", "BOTH"];
    const strategies = ["SELECT", "MERGE"];
    const mergeModes = ["UNION_PREFER_PRIMARY", "UNION", "VERIFY_ONLY"];
    const authModes = ["API_KEY", "HMAC_SHARED_SECRET"];

    // Built-in provider defaults per workflow
    const builtinsMap: Record<string, { acts: string[]; pubs: string[] }> = {
      CGP:       { acts: ["cpnu"],  pubs: ["publicaciones"] },
      LABORAL:   { acts: ["cpnu"],  pubs: ["publicaciones"] },
      CPACA:     { acts: ["samai"], pubs: ["publicaciones"] },
      TUTELA:    { acts: ["cpnu", "tutelas-api"], pubs: [] },
      PENAL_906: { acts: ["cpnu", "samai"], pubs: ["publicaciones"] },
    };

    // Effective routing preview for the user's org (if available)
    let effectiveRoutingPreview: any = null;
    const orgId = profile?.organization_id;
    if (orgId) {
      const [globalRoutesRes, orgRoutesRes] = await Promise.all([
        supabase.from("provider_category_routes_global")
          .select("workflow, scope, route_kind, priority, enabled, provider_connector_id, provider_connectors(name)")
          .eq("enabled", true)
          .order("workflow").order("scope").order("priority"),
        supabase.from("provider_category_routes_org_override")
          .select("workflow, scope, route_kind, priority, enabled, provider_connector_id, provider_connectors(name)")
          .eq("organization_id", orgId)
          .eq("enabled", true)
          .order("workflow").order("scope").order("priority"),
      ]);

      effectiveRoutingPreview = {
        organization_id: orgId,
        global_route_count: (globalRoutesRes.data || []).length,
        org_override_count: (orgRoutesRes.data || []).length,
        has_org_overrides: (orgRoutesRes.data || []).length > 0,
        sample_workflows: [...new Set((globalRoutesRes.data || []).map((r: any) => r.workflow))].slice(0, 5),
      };
    }

    // Instance coverage: how many orgs have provisioned instances per connector
    const { data: instanceCoverage } = await supabase
      .from("provider_instances")
      .select("connector_id, organization_id")
      .eq("is_enabled", true);

    const coverageMap: Record<string, Set<string>> = {};
    for (const inst of instanceCoverage || []) {
      if (!coverageMap[inst.connector_id]) coverageMap[inst.connector_id] = new Set();
      coverageMap[inst.connector_id].add(inst.organization_id);
    }
    const instanceCoverageSummary = Object.entries(coverageMap).map(([connectorId, orgs]) => ({
      connector_id: connectorId,
      org_count: orgs.size,
    }));

    const metadata = {
      is_platform_admin: !!adminRec,
      user_organization_id: orgId || null,
      workflows,
      scopes,
      strategies,
      merge_modes: mergeModes,
      auth_modes: authModes,
      canonical_schema_versions: ["atenia.v1"],
      environment: "production",
      builtins_fallback_enabled: true,
      builtins_map: builtinsMap,
      routing_precedence: [
        "1. ORG_OVERRIDE — org-specific policy/routes (highest priority)",
        "2. GLOBAL — platform-wide policy/routes",
        "3. BUILTIN — default built-in providers (CPNU, SAMAI)",
      ],
      ssrf_rules: {
        https_only: true,
        private_ips_blocked: true,
        localhost_blocked: true,
        allowlist_required: true,
      },
      effective_routing_preview: effectiveRoutingPreview,
      instance_coverage: instanceCoverageSummary,
    };

    return new Response(JSON.stringify(metadata), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
