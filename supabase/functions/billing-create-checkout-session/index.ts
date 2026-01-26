import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  organization_id: string;
  tier: string;
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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const { organization_id, tier } = body;

    if (!organization_id || !tier) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Missing organization_id or tier" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate tier
    const validTiers = ["BASIC", "PRO", "ENTERPRISE"];
    if (!validTiers.includes(tier)) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Invalid tier" }),
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
        JSON.stringify({ ok: false, code: "FORBIDDEN", message: "Only org admins can create checkout sessions" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service client for DB writes
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Get provider (mock for now)
    const provider = Deno.env.get("BILLING_PROVIDER") || "mock";

    // Generate mock session ID and URL
    const sessionId = crypto.randomUUID();
    const checkoutUrl = provider === "mock" 
      ? `/billing/checkout/mock?session=${sessionId}`
      : null;

    // Create checkout session record
    const { data: session, error: insertError } = await supabaseService
      .from("billing_checkout_sessions")
      .insert({
        id: sessionId,
        organization_id,
        provider,
        tier,
        status: "PENDING",
        checkout_url: checkoutUrl,
        created_by: userId,
        metadata: { 
          created_via: "edge_function",
          user_agent: req.headers.get("User-Agent") || "unknown"
        },
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to create checkout session:", insertError);
      return new Response(
        JSON.stringify({ ok: false, code: "DB_ERROR", message: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Audit log
    await supabaseService.from("audit_logs").insert({
      organization_id,
      actor_user_id: userId,
      actor_type: "USER",
      action: "BILLING_CHECKOUT_STARTED",
      entity_type: "billing_checkout_session",
      entity_id: sessionId,
      metadata: { tier, provider },
    });

    console.log(`[billing-create-checkout-session] Created session ${sessionId} for org ${organization_id}, tier ${tier}`);

    return new Response(
      JSON.stringify({
        ok: true,
        session_id: session.id,
        checkout_url: session.checkout_url,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("billing-create-checkout-session error:", error);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
