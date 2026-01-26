import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  session_id: string;
}

// Map billing tier to subscription_plans.name
const TIER_TO_PLAN_NAME: Record<string, string> = {
  "FREE_TRIAL": "trial",
  "BASIC": "basic",
  "PRO": "standard",
  "ENTERPRISE": "unlimited",
};

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
    const { error: updateSessionError } = await supabaseService
      .from("billing_checkout_sessions")
      .update({
        status: "COMPLETED",
        completed_at: now,
        metadata: { ...session.metadata, completed_by: userId },
      })
      .eq("id", session_id);

    if (updateSessionError) {
      console.error("Failed to update checkout session:", updateSessionError);
      return new Response(
        JSON.stringify({ ok: false, code: "DB_ERROR", message: "Failed to update session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get pricing for the tier from mrr_pricing_config
    const { data: pricing } = await supabaseService
      .from("mrr_pricing_config")
      .select("monthly_price_usd")
      .eq("tier", session.tier)
      .single();

    const priceUsd = pricing?.monthly_price_usd || 0;

    // Map tier to plan_id via subscription_plans
    const planName = TIER_TO_PLAN_NAME[session.tier];
    if (!planName) {
      console.error(`Unknown tier: ${session.tier}`);
      return new Response(
        JSON.stringify({ ok: false, code: "INVALID_TIER", message: `Unknown tier: ${session.tier}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get plan_id from subscription_plans
    const { data: planRow, error: planError } = await supabaseService
      .from("subscription_plans")
      .select("id")
      .eq("name", planName)
      .single();

    if (planError || !planRow) {
      console.error(`Plan not found for name: ${planName}`, planError);
      return new Response(
        JSON.stringify({ ok: false, code: "PLAN_NOT_FOUND", message: `Plan not found: ${planName}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newPlanId = planRow.id;

    // Get existing subscription
    const { data: existingSub, error: subQueryError } = await supabaseService
      .from("subscriptions")
      .select("id, plan_id")
      .eq("organization_id", session.organization_id)
      .single();

    if (subQueryError && subQueryError.code !== "PGRST116") {
      console.error("Failed to query subscription:", subQueryError);
    }

    const oldPlanId = existingSub?.plan_id || null;

    if (existingSub) {
      // Update existing subscription with new plan_id
      const { error: subUpdateError } = await supabaseService
        .from("subscriptions")
        .update({
          plan_id: newPlanId,
          status: "active",
          current_period_start: now,
          current_period_end: periodEnd,
          trial_ends_at: null, // Clear trial on paid plan
          updated_at: now,
        })
        .eq("id", existingSub.id);

      if (subUpdateError) {
        console.error("Failed to update subscription:", subUpdateError);
        return new Response(
          JSON.stringify({ ok: false, code: "DB_ERROR", message: "Failed to update subscription" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Create new subscription
      const { error: subInsertError } = await supabaseService
        .from("subscriptions")
        .insert({
          organization_id: session.organization_id,
          plan_id: newPlanId,
          status: "active",
          current_period_start: now,
          current_period_end: periodEnd,
        });

      if (subInsertError) {
        console.error("Failed to create subscription:", subInsertError);
        return new Response(
          JSON.stringify({ ok: false, code: "DB_ERROR", message: "Failed to create subscription" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Create invoice record
    const invoiceId = crypto.randomUUID();
    const { error: invoiceError } = await supabaseService
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
          plan_id: newPlanId,
        },
      });

    if (invoiceError) {
      console.error("Failed to create invoice:", invoiceError);
      // Non-fatal - continue
    }

    // Ensure billing customer exists
    const { data: existingCustomer } = await supabaseService
      .from("billing_customers")
      .select("id")
      .eq("organization_id", session.organization_id)
      .maybeSingle();

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
    const { error: auditError } = await supabaseService.from("audit_logs").insert([
      {
        organization_id: session.organization_id,
        actor_user_id: userId,
        actor_type: "USER",
        action: "BILLING_CHECKOUT_COMPLETED",
        entity_type: "billing_checkout_session",
        entity_id: session_id,
        metadata: { tier: session.tier, amount_usd: priceUsd, plan_id: newPlanId },
      },
      {
        organization_id: session.organization_id,
        actor_user_id: userId,
        actor_type: "USER",
        action: "BILLING_TIER_CHANGED",
        entity_type: "subscription",
        entity_id: existingSub?.id || null,
        metadata: { 
          new_tier: session.tier, 
          new_plan_id: newPlanId,
          old_plan_id: oldPlanId,
          source: "checkout" 
        },
      },
      {
        organization_id: session.organization_id,
        actor_user_id: userId,
        actor_type: "USER",
        action: "BILLING_INVOICE_CREATED",
        entity_type: "billing_invoice",
        entity_id: invoiceId,
        metadata: { amount_usd: priceUsd, status: "PAID", tier: session.tier },
      },
    ]);

    if (auditError) {
      console.warn("Audit log insert failed:", auditError);
      // Non-fatal
    }

    console.log(`[billing-complete-checkout] Completed session ${session_id}, tier ${session.tier} -> plan ${planName}, org ${session.organization_id}`);

    return new Response(
      JSON.stringify({ ok: true, plan_id: newPlanId, tier: session.tier }),
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
