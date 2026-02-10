/**
 * provider-list-category-routes — List all category routes for an organization.
 * Admin / superadmin only.
 *
 * Input: { organization_id }
 * Returns: routes grouped by workflow/scope with provider instance details.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
    const { organization_id } = body;

    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: "organization_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify access
    const { data: membership } = await adminClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: platformAdmin } = await adminClient
      .from("platform_admins")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!platformAdmin && (!membership || !["OWNER", "ADMIN"].includes(membership.role))) {
      return new Response(JSON.stringify({ error: "Must be org admin or platform admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch routes with provider instance details
    const { data: routes, error: fetchErr } = await adminClient
      .from("provider_category_routes")
      .select("*, provider_instances(id, name, base_url, auth_type, is_enabled, connector_id)")
      .eq("organization_id", organization_id)
      .order("workflow")
      .order("scope")
      .order("route_kind")
      .order("priority");

    if (fetchErr) {
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by workflow
    const grouped: Record<string, any[]> = {};
    for (const route of (routes || [])) {
      const key = route.workflow;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(route);
    }

    return new Response(
      JSON.stringify({ ok: true, routes: routes || [], grouped }),
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
