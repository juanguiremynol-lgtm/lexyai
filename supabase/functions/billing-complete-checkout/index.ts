import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  session_id: string;
}

// Map plan_code to subscription_plans.name for backward compatibility
const PLAN_CODE_TO_PLAN_NAME: Record<string, string> = {
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
    const billingCycleMonths = session.billing_cycle_months || 1;
    
    // Calculate period end based on cycle
    const periodEndDate = new Date();
    if (billingCycleMonths === 24) {
      periodEndDate.setMonth(periodEndDate.getMonth() + 24);
    } else {
      periodEndDate.setDate(periodEndDate.getDate() + 30); // Monthly mock
    }
    const periodEnd = periodEndDate.toISOString();

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

    // Get price point details if available
    let priceType = "REGULAR";
    let priceLockMonths = 0;
    
    if (session.price_point_id) {
      const { data: pricePoint } = await supabaseService
        .from("billing_price_points")
        .select("price_type, price_lock_months")
        .eq("id", session.price_point_id)
        .single();
      
      if (pricePoint) {
        priceType = pricePoint.price_type;
        priceLockMonths = pricePoint.price_lock_months || 0;
      }
    }

    const isIntroOffer = priceType === "INTRO";
    const priceLockEndAt = isIntroOffer && priceLockMonths > 0
      ? new Date(Date.now() + priceLockMonths * 30 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Extract plan_code from session (stored in tier field for backward compat)
    const planCode = session.tier;

    // =========================================================================
    // Create payment_transaction and trigger Atenia AI verification
    // =========================================================================
    const transactionId = crypto.randomUUID();
    const { error: txnError } = await supabaseService
      .from("payment_transactions")
      .insert({
        id: transactionId,
        organization_id: session.organization_id,
        checkout_session_id: session_id,
        plan_code: planCode,
        amount_cop: session.amount_cop_incl_iva || 0,
        currency: "COP",
        billing_cycle_months: billingCycleMonths,
        transaction_type: "SUBSCRIPTION",
        gateway: session.provider || "mock",
        gateway_transaction_id: `mock_txn_${Date.now()}`,
        gateway_reference: `checkout_${session_id}`,
        gateway_response: { checkout_session_id: session_id, provider: session.provider },
        gateway_status: "APPROVED",
        status: "PROCESSING",
        initiated_by_user_id: userId,
      });

    if (txnError) {
      console.error("Failed to create payment transaction:", txnError);
      // Non-fatal, proceed with legacy flow
    }

    // Log checkout completed event
    await supabaseService.from("subscription_events").insert({
      organization_id: session.organization_id,
      event_type: "CHECKOUT_COMPLETED",
      description: `Checkout completado. Plan: ${planCode}, Monto: $${(session.amount_cop_incl_iva || 0).toLocaleString("es-CO")} COP, Ciclo: ${billingCycleMonths}m.`,
      payload: {
        checkout_session_id: session_id,
        plan_code: planCode,
        amount_cop: session.amount_cop_incl_iva,
        billing_cycle_months: billingCycleMonths,
        transaction_id: transactionId,
      },
      triggered_by: "USER",
      triggered_by_user_id: userId,
    });

    // Trigger Atenia AI verification (which handles activation)
    let verificationResult: Record<string, unknown> | null = null;
    if (!txnError) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const verifyResponse = await fetch(
          `${supabaseUrl}/functions/v1/atenia-ai-verify-payment`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({ transaction_id: transactionId }),
          }
        );
        verificationResult = await verifyResponse.json();
        console.log("[billing-complete-checkout] Verification result:", verificationResult);
      } catch (verifyErr) {
        console.error("[billing-complete-checkout] Verification call failed:", verifyErr);
      }
    }

    // =========================================================================
    // Legacy fallback: If verification didn't activate, do it directly
    // (ensures backward compatibility during transition)
    // =========================================================================
    const activated = verificationResult && (verificationResult as Record<string, unknown>).activated === true;

    if (!activated) {
      // Upsert billing_subscription_state
      const { error: stateError } = await supabaseService
        .from("billing_subscription_state")
        .upsert({
          organization_id: session.organization_id,
          plan_code: planCode,
          billing_cycle_months: billingCycleMonths,
          currency: "COP",
          current_price_cop_incl_iva: session.amount_cop_incl_iva || 0,
          intro_offer_applied: isIntroOffer,
          price_lock_end_at: priceLockEndAt,
          trial_end_at: null,
          status: "ACTIVE",
          current_period_start: now,
          current_period_end: periodEnd,
          next_billing_at: periodEnd,
          last_payment_id: transactionId,
          consecutive_payment_failures: 0,
          updated_at: now,
        }, { onConflict: "organization_id" });

      if (stateError) {
        console.error("Failed to upsert billing_subscription_state:", stateError);
      }

      // Map plan_code to subscription_plans.name for core subscriptions table
      const planName = PLAN_CODE_TO_PLAN_NAME[planCode] || "basic";

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
      const { data: existingSub } = await supabaseService
        .from("subscriptions")
        .select("id, plan_id")
        .eq("organization_id", session.organization_id)
        .maybeSingle();

      if (existingSub) {
        await supabaseService
          .from("subscriptions")
          .update({
            plan_id: newPlanId,
            status: "active",
            current_period_start: now,
            current_period_end: periodEnd,
            trial_ends_at: null,
            updated_at: now,
          })
          .eq("id", existingSub.id);
      } else {
        await supabaseService
          .from("subscriptions")
          .insert({
            organization_id: session.organization_id,
            plan_id: newPlanId,
            status: "active",
            current_period_start: now,
            current_period_end: periodEnd,
          });
      }

      // Log activation event
      await supabaseService.from("subscription_events").insert({
        organization_id: session.organization_id,
        event_type: "PLAN_ACTIVATED",
        description: `Plan ${planCode} activado (fallback directo). Período hasta ${periodEndDate.toLocaleDateString("es-CO")}.`,
        payload: {
          plan_code: planCode,
          period_end: periodEnd,
          amount_cop: session.amount_cop_incl_iva,
          source: "legacy_fallback",
        },
        triggered_by: "SYSTEM",
        triggered_by_user_id: userId,
      });
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

    // Create invoice record
    const invoiceId = crypto.randomUUID();
    await supabaseService
      .from("billing_invoices")
      .insert({
        id: invoiceId,
        organization_id: session.organization_id,
        provider: "mock",
        provider_invoice_id: `mock_inv_${Date.now()}`,
        amount_cop_incl_iva: session.amount_cop_incl_iva,
        currency: "COP",
        status: "PAID",
        period_start: now,
        period_end: periodEnd,
        metadata: {
          checkout_session_id: session_id,
          plan_code: planCode,
          billing_cycle_months: billingCycleMonths,
          price_type: priceType,
          transaction_id: transactionId,
        },
      });

    // Audit logs
    await supabaseService.from("audit_logs").insert([
      {
        organization_id: session.organization_id,
        actor_user_id: userId,
        actor_type: "USER",
        action: "BILLING_CHECKOUT_COMPLETED",
        entity_type: "billing_checkout_session",
        entity_id: session_id,
        metadata: {
          plan_code: planCode,
          amount_cop: session.amount_cop_incl_iva,
          billing_cycle_months: billingCycleMonths,
          transaction_id: transactionId,
          verified_by_ai: !!activated,
        },
      },
    ]);

    console.log(`[billing-complete-checkout] Completed session ${session_id}, plan ${planCode}, cycle ${billingCycleMonths}m, org ${session.organization_id}, verified_by_ai=${!!activated}`);

    return new Response(
      JSON.stringify({
        ok: true,
        plan_code: planCode,
        intro_offer_applied: isIntroOffer,
        price_lock_end_at: priceLockEndAt,
        transaction_id: transactionId,
        verified_by_ai: !!activated,
      }),
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
