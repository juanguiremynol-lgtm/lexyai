import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Trial duration: 3 months from signup
const TRIAL_DURATION_MONTHS = 3;

interface RequestBody {
  organization_id: string;
  account_type: "INDIVIDUAL" | "FIRM";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ ok: false, code: "UNAUTHORIZED", message: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;
    const body: RequestBody = await req.json();
    const { organization_id, account_type } = body;

    if (!organization_id) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Missing organization_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validAccountTypes = ["INDIVIDUAL", "FIRM"];
    if (!validAccountTypes.includes(account_type)) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Invalid account_type" }),
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

    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Update organization metadata with account_type and auth_provider
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

    const existingMetadata = (org.metadata as Record<string, unknown>) || {};
    const authProvider = user.app_metadata?.provider || "GOOGLE";
    
    await supabaseService
      .from("organizations")
      .update({
        metadata: { ...existingMetadata, account_type, auth_provider: authProvider },
      })
      .eq("id", organization_id);

    // Compute trial end date: 3 months from now
    const now = new Date();
    const trialEndDate = new Date(now);
    trialEndDate.setMonth(trialEndDate.getMonth() + TRIAL_DURATION_MONTHS);
    const trialEndAt = trialEndDate.toISOString();
    const nowIso = now.toISOString();

    // Get trial plan
    const { data: trialPlan } = await supabaseService
      .from("subscription_plans")
      .select("id")
      .eq("name", "trial")
      .single();

    if (!trialPlan) {
      return new Response(
        JSON.stringify({ ok: false, code: "PLAN_NOT_FOUND", message: "Trial plan not found" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check existing subscription
    const { data: existingSub } = await supabaseService
      .from("subscriptions")
      .select("id, status")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (existingSub) {
      await supabaseService
        .from("subscriptions")
        .update({
          plan_id: trialPlan.id,
          status: "trialing",
          trial_started_at: nowIso,
          trial_ends_at: trialEndAt,
          updated_at: nowIso,
        })
        .eq("id", existingSub.id);
    } else {
      await supabaseService
        .from("subscriptions")
        .insert({
          organization_id,
          plan_id: trialPlan.id,
          status: "trialing",
          trial_started_at: nowIso,
          trial_ends_at: trialEndAt,
        });
    }

    // Upsert billing_subscription_state with TRIAL status
    await supabaseService
      .from("billing_subscription_state")
      .upsert({
        organization_id,
        plan_code: "BASIC",
        billing_cycle_months: 1,
        currency: "COP",
        current_price_cop_incl_iva: 0,
        intro_offer_applied: false,
        status: "TRIAL",
        trial_end_at: trialEndAt,
        current_period_end: null, // No billing period during trial
        updated_at: nowIso,
      }, { onConflict: "organization_id" });

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
        auth_provider: authProvider,
        trial_end_at: trialEndAt,
        trial_duration_months: TRIAL_DURATION_MONTHS,
        source: "beta_trial_enroll",
      },
    });

    // Log to subscription_events
    await supabaseService.from("subscription_events").insert({
      organization_id,
      event_type: "TRIAL_STARTED",
      description: `Prueba beta gratuita de ${TRIAL_DURATION_MONTHS} meses activada. Finaliza: ${trialEndDate.toLocaleDateString("es-CO")}.`,
      payload: {
        trial_end_at: trialEndAt,
        trial_duration_months: TRIAL_DURATION_MONTHS,
        account_type,
        auth_provider: authProvider,
      },
      triggered_by: "USER",
    });

    console.log(`[billing-grace-enroll] Beta trial enrolled org ${organization_id}, trial_end=${trialEndAt}, auth=${authProvider}`);

    return new Response(
      JSON.stringify({
        ok: true,
        trial_end_at: trialEndAt,
        trial_duration_months: TRIAL_DURATION_MONTHS,
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
