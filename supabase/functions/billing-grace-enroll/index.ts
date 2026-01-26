import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Pricing window constants (must match src/lib/billing/pricing-windows.ts)
const GRACE_END_AT = "2026-04-30T23:59:59-05:00";

interface RequestBody {
  organization_id: string;
  account_type: "INDIVIDUAL" | "FIRM";
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
    const { organization_id, account_type } = body;

    if (!organization_id) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Missing organization_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate account_type
    const validAccountTypes = ["INDIVIDUAL", "FIRM"];
    if (!validAccountTypes.includes(account_type)) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Invalid account_type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if grace period is still active
    const now = new Date();
    const graceEnd = new Date(GRACE_END_AT);

    if (now > graceEnd) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: "GRACE_PERIOD_EXPIRED", 
          message: "El período de gracia ha terminado",
          hint: "Por favor selecciona un plan de pago para continuar usando ATENIA."
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is org member
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

    // Service client for DB writes
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Update organization metadata with account_type
    const { data: org, error: orgError } = await supabaseService
      .from("organizations")
      .select("id, metadata")
      .eq("id", organization_id)
      .single();

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ ok: false, code: "NOT_FOUND", message: "Organization not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update metadata with account_type
    const existingMetadata = (org.metadata as Record<string, unknown>) || {};
    const { error: updateOrgError } = await supabaseService
      .from("organizations")
      .update({
        metadata: { ...existingMetadata, account_type },
      })
      .eq("id", organization_id);

    if (updateOrgError) {
      console.error("Failed to update organization metadata:", updateOrgError);
    }

    // Get trial plan from subscription_plans
    const { data: trialPlan, error: trialPlanError } = await supabaseService
      .from("subscription_plans")
      .select("id")
      .eq("name", "trial")
      .single();

    if (trialPlanError || !trialPlan) {
      console.error("Trial plan not found:", trialPlanError);
      return new Response(
        JSON.stringify({ ok: false, code: "PLAN_NOT_FOUND", message: "Trial plan not found" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const trialEndAt = GRACE_END_AT;
    const nowIso = now.toISOString();

    // Check if subscription already exists
    const { data: existingSub, error: subQueryError } = await supabaseService
      .from("subscriptions")
      .select("id, status")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (subQueryError && subQueryError.code !== "PGRST116") {
      console.error("Failed to query subscription:", subQueryError);
    }

    if (existingSub) {
      // Update existing subscription to trialing with grace end date
      const { error: subUpdateError } = await supabaseService
        .from("subscriptions")
        .update({
          plan_id: trialPlan.id,
          status: "trialing",
          trial_started_at: nowIso,
          trial_ends_at: trialEndAt,
          updated_at: nowIso,
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
          organization_id,
          plan_id: trialPlan.id,
          status: "trialing",
          trial_started_at: nowIso,
          trial_ends_at: trialEndAt,
        });

      if (subInsertError) {
        console.error("Failed to create subscription:", subInsertError);
        return new Response(
          JSON.stringify({ ok: false, code: "DB_ERROR", message: "Failed to create subscription" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Upsert billing_subscription_state
    const { error: stateError } = await supabaseService
      .from("billing_subscription_state")
      .upsert({
        organization_id,
        plan_code: "BASIC", // Default to BASIC during trial
        billing_cycle_months: 1,
        currency: "COP",
        current_price_cop_incl_iva: 0,
        intro_offer_applied: false,
        price_lock_end_at: null,
        trial_end_at: trialEndAt,
        updated_at: nowIso,
      }, { onConflict: "organization_id" });

    if (stateError) {
      console.error("Failed to upsert billing_subscription_state:", stateError);
      // Non-fatal, continue
    }

    // Audit log
    await supabaseService.from("audit_logs").insert({
      organization_id,
      actor_user_id: userId,
      actor_type: "USER",
      action: "BILLING_TRIAL_GRANTED",
      entity_type: "subscription",
      entity_id: existingSub?.id || null,
      metadata: { 
        account_type,
        trial_end_at: trialEndAt,
        source: "grace_enroll",
      },
    });

    console.log(`[billing-grace-enroll] Enrolled org ${organization_id} in grace period, account_type=${account_type}, trial_end=${trialEndAt}`);

    return new Response(
      JSON.stringify({
        ok: true,
        trial_end_at: trialEndAt,
        account_type,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("billing-grace-enroll error:", error);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
