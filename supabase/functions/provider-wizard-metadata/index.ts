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

    const metadata = {
      is_platform_admin: !!adminRec,
      user_organization_id: profile?.organization_id || null,
      workflows,
      scopes,
      strategies,
      merge_modes: mergeModes,
      auth_modes: authModes,
      canonical_schema_versions: ["atenia.v1"],
      environment: "production",
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
