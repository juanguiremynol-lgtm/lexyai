import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  session_id: string;
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
    const { session_id } = body;

    if (!session_id) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Missing session_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service client for DB operations
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Get checkout session
    const { data: session, error: sessionError } = await supabaseService
      .from("billing_checkout_sessions")
      .select("*")
      .eq("id", session_id)
      .single();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ ok: false, code: "NOT_FOUND", message: "Checkout session not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user is org admin
    const { data: membership, error: membershipError } = await supabaseUser
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", session.organization_id)
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
        JSON.stringify({ ok: false, code: "FORBIDDEN", message: "Only org admins can complete checkout" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check session status
    if (session.status !== "PENDING") {
      return new Response(
        JSON.stringify({ ok: false, code: "INVALID_STATE", message: `Session already ${session.status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only allow mock provider completions for now
    if (session.provider !== "mock") {
      return new Response(
        JSON.stringify({ ok: false, code: "INVALID_PROVIDER", message: "Only mock provider sessions can be completed this way" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // +30 days

    // Update checkout session to COMPLETED
    await supabaseService
      .from("billing_checkout_sessions")
      .update({
        status: "COMPLETED",
        completed_at: now,
        metadata: { ...session.metadata, completed_by: userId },
      })
      .eq("id", session_id);

    // Get pricing for the tier
    const { data: pricing } = await supabaseService
      .from("mrr_pricing_config")
      .select("monthly_price_usd")
      .eq("tier", session.tier)
      .single();

    const priceUsd = pricing?.monthly_price_usd || 0;

    // Update subscription
    const { data: existingSub } = await supabaseService
      .from("subscriptions")
      .select("id")
      .eq("organization_id", session.organization_id)
      .single();

    if (existingSub) {
      // Update existing subscription
      await supabaseService
        .from("subscriptions")
        .update({
          status: "active",
          current_period_start: now,
          current_period_end: periodEnd,
          updated_at: now,
        })
        .eq("id", existingSub.id);
    }

    // Create invoice record
    const invoiceId = crypto.randomUUID();
    await supabaseService
      .from("billing_invoices")
      .insert({
        id: invoiceId,
        organization_id: session.organization_id,
        provider: "mock",
        provider_invoice_id: `mock_inv_${Date.now()}`,
        amount_usd: priceUsd,
        currency: "USD",
        status: "PAID",
        period_start: now,
        period_end: periodEnd,
        metadata: { 
          checkout_session_id: session_id,
          tier: session.tier,
        },
      });

    // Ensure billing customer exists
    const { data: existingCustomer } = await supabaseService
      .from("billing_customers")
      .select("id")
      .eq("organization_id", session.organization_id)
      .single();

    if (!existingCustomer) {
      await supabaseService
        .from("billing_customers")
        .insert({
          organization_id: session.organization_id,
          provider: "mock",
          provider_customer_id: `mock_cus_${session.organization_id}`,
        });
    }

    // Audit logs
    await supabaseService.from("audit_logs").insert([
      {
        organization_id: session.organization_id,
        actor_user_id: userId,
        actor_type: "USER",
        action: "BILLING_CHECKOUT_COMPLETED",
        entity_type: "billing_checkout_session",
        entity_id: session_id,
        metadata: { tier: session.tier, amount_usd: priceUsd },
      },
      {
        organization_id: session.organization_id,
        actor_user_id: userId,
        actor_type: "USER",
        action: "BILLING_TIER_CHANGED",
        entity_type: "subscription",
        entity_id: existingSub?.id || null,
        metadata: { new_tier: session.tier, source: "checkout" },
      },
      {
        organization_id: session.organization_id,
        actor_user_id: userId,
        actor_type: "USER",
        action: "BILLING_INVOICE_CREATED",
        entity_type: "billing_invoice",
        entity_id: invoiceId,
        metadata: { amount_usd: priceUsd, status: "PAID" },
      },
    ]);

    console.log(`[billing-complete-checkout] Completed session ${session_id}, tier ${session.tier}, org ${session.organization_id}`);

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("billing-complete-checkout error:", error);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
