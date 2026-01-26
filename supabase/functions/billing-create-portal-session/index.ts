import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  organization_id: string;
  return_url: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ ok: false, code: "UNAUTHORIZED", message: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Client with user auth for permission checks
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ ok: false, code: "UNAUTHORIZED", message: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;

    // Parse body
    const body: RequestBody = await req.json();
    const { organization_id, return_url } = body;

    if (!organization_id) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Missing organization_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is org admin
    const { data: membership, error: membershipError } = await supabaseUser
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", userId)
      .single();

    if (membershipError || !membership) {
      return new Response(
        JSON.stringify({ ok: false, code: "FORBIDDEN", message: "Not a member of this organization" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["OWNER", "ADMIN"].includes(membership.role)) {
      return new Response(
        JSON.stringify({ ok: false, code: "FORBIDDEN", message: "Only org admins can access billing portal" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get provider
    const provider = Deno.env.get("BILLING_PROVIDER") || "mock";

    // Generate portal URL
    let portalUrl: string;
    
    if (provider === "mock") {
      // Mock portal just returns to the billing page
      portalUrl = return_url || "/settings?tab=billing";
    } else {
      // Future: Call actual provider portal API
      portalUrl = return_url || "/settings?tab=billing";
    }

    console.log(`[billing-create-portal-session] Created portal session for org ${organization_id}`);

    return new Response(
      JSON.stringify({
        ok: true,
        portal_url: portalUrl,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("billing-create-portal-session error:", error);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
