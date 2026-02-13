import { createClient } from "npm:@supabase/supabase-js@2";
import {
  resolveCurrentPricePoint,
  validateDiscountEligibility,
  buildAmountBreakdown,
  redactSecrets,
} from "../_shared/pricing-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMO_END_AT = "2026-07-31T23:59:59-05:00";

interface RequestBody {
  organization_id: string;
  plan_code?: string;
  tier?: string;
  billing_cycle_months?: number;
  discount_code?: string;
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
    const { organization_id, billing_cycle_months = 1, discount_code } = body;
    const planCode = body.plan_code || body.tier;

    if (!organization_id || !planCode) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Missing organization_id or plan_code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validPlanCodes = ["BASIC", "PRO", "ENTERPRISE"];
    if (!validPlanCodes.includes(planCode)) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Invalid plan_code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (![1, 24].includes(billing_cycle_months)) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "billing_cycle_months must be 1 or 24" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check org membership
    const { data: membership, error: membershipError } = await supabaseUser
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", organization_id)
      .eq("user_id", userId)
      .single();

    if (membershipError || !membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return new Response(
        JSON.stringify({ ok: false, code: "FORBIDDEN", message: "Only org admins can create checkout sessions" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Get organization
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

    const accountType = (org.metadata as Record<string, unknown>)?.account_type || "INDIVIDUAL";

    if (planCode === "ENTERPRISE" && accountType !== "FIRM") {
      return new Response(
        JSON.stringify({ ok: false, code: "ENTERPRISE_REQUIRES_FIRM", message: "El plan Enterprise requiere una cuenta tipo Firma", hint: "Actualiza tu tipo de cuenta a Firma." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find billing plan
    const { data: billingPlan, error: planError } = await supabaseService
      .from("billing_plans")
      .select("id, code, display_name")
      .eq("code", planCode)
      .single();

    if (planError || !billingPlan) {
      return new Response(
        JSON.stringify({ ok: false, code: "PLAN_NOT_FOUND", message: `Plan ${planCode} not found` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine price type
    const now = new Date();
    const promoEnd = new Date(PROMO_END_AT);
    let priceType: string;

    if (billing_cycle_months === 24) {
      if (now > promoEnd) {
        return new Response(
          JSON.stringify({ ok: false, code: "PROMO_EXPIRED", message: "El período de promoción ha terminado", hint: "El compromiso de 24 meses con precio de lanzamiento ya no está disponible." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      priceType = "INTRO";
    } else {
      priceType = "REGULAR";
    }

    // Fetch ALL price points for this plan and resolve using shared engine
    const { data: allPricePoints, error: ppError } = await supabaseService
      .from("billing_price_points")
      .select("*")
      .eq("plan_id", billingPlan.id);

    if (ppError) {
      return new Response(
        JSON.stringify({ ok: false, code: "DB_ERROR", message: ppError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pricePoint = resolveCurrentPricePoint(
      allPricePoints || [],
      billingPlan.id,
      billing_cycle_months,
      priceType,
      now
    );

    if (!pricePoint) {
      return new Response(
        JSON.stringify({ ok: false, code: "PRICE_NOT_FOUND", message: "No hay precio disponible para esta configuración", hint: `Plan: ${planCode}, Ciclo: ${billing_cycle_months}, Tipo: ${priceType}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate & resolve discount
    const provider = Deno.env.get("BILLING_PROVIDER") || "mock";
    let discountData = null;

    if (discount_code) {
      const { data: discCode, error: discError } = await supabaseService
        .from("billing_discount_codes")
        .select("*")
        .eq("code", discount_code.toUpperCase())
        .maybeSingle();

      if (discError || !discCode) {
        return new Response(
          JSON.stringify({ ok: false, code: "DISCOUNT_NOT_FOUND", message: "Código de descuento no válido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const eligibility = validateDiscountEligibility(
        discCode,
        planCode,
        billing_cycle_months,
        organization_id,
        user.email,
        now
      );

      if (!eligibility.eligible) {
        return new Response(
          JSON.stringify({ ok: false, code: eligibility.error_code, message: eligibility.error_message }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      discountData = discCode;
    }

    // Build canonical amount breakdown using shared engine
    const breakdown = buildAmountBreakdown(pricePoint, discountData);

    // Create checkout session with breakdown
    const sessionId = crypto.randomUUID();
    const checkoutUrl = provider === "mock"
      ? `/billing/checkout/mock?session=${sessionId}`
      : null;

    const { data: session, error: insertError } = await supabaseService
      .from("billing_checkout_sessions")
      .insert({
        id: sessionId,
        organization_id,
        provider,
        tier: planCode,
        status: "PENDING",
        checkout_url: checkoutUrl,
        created_by: userId,
        billing_cycle_months,
        price_point_id: pricePoint.id,
        amount_cop_incl_iva: breakdown.final_payable_cop,
        discount_code_id: breakdown.discount_code_id,
        discount_amount_cop: breakdown.discount_amount_cop,
        amount_breakdown: redactSecrets(breakdown as unknown as Record<string, unknown>),
        metadata: {
          created_via: "edge_function",
          plan_code: planCode,
          price_type: priceType,
          account_type: accountType,
          price_point_version: pricePoint.version_number,
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

    // Record discount redemption if applicable
    if (discountData && breakdown.discount_amount_cop > 0) {
      // Get IP hash for abuse analysis
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const ipHashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientIp));
      const ipHash = Array.from(new Uint8Array(ipHashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

      await supabaseService.from("billing_discount_redemptions").insert({
        discount_code_id: discountData.id,
        organization_id,
        checkout_session_id: sessionId,
        user_id: userId,
        plan_code: planCode,
        billing_cycle_months,
        original_amount_cop: breakdown.base_price_cop,
        discount_amount_cop: breakdown.discount_amount_cop,
        final_amount_cop: breakdown.final_payable_cop,
        ip_hash: ipHash,
      });

      // Increment redemption count
      await supabaseService.from("billing_discount_codes").update({
        current_redemptions: discountData.current_redemptions + 1,
      }).eq("id", discountData.id);
    }

    // Ensure billing customer exists
    const { data: existingCustomer } = await supabaseService
      .from("billing_customers")
      .select("id")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (!existingCustomer) {
      await supabaseService.from("billing_customers").insert({
        organization_id,
        provider,
        provider_customer_id: `${provider}_cus_${organization_id}`,
      });
    }

    // Audit log
    await supabaseService.from("audit_logs").insert({
      organization_id,
      actor_user_id: userId,
      actor_type: "USER",
      action: "BILLING_CHECKOUT_STARTED",
      entity_type: "billing_checkout_session",
      entity_id: sessionId,
      metadata: {
        plan_code: planCode,
        billing_cycle_months,
        price_type: priceType,
        amount_cop: breakdown.final_payable_cop,
        base_price_cop: breakdown.base_price_cop,
        discount_amount_cop: breakdown.discount_amount_cop,
        price_point_version: pricePoint.version_number,
        provider,
      },
    });

    console.log(`[billing-create-checkout-session] Created session ${sessionId} for org ${organization_id}, plan ${planCode}, cycle ${billing_cycle_months}m, base ${breakdown.base_price_cop} - discount ${breakdown.discount_amount_cop} = final ${breakdown.final_payable_cop} COP`);

    return new Response(
      JSON.stringify({
        ok: true,
        session_id: session.id,
        checkout_url: session.checkout_url,
        amount_cop_incl_iva: breakdown.final_payable_cop,
        original_amount_cop: breakdown.base_price_cop,
        discount_amount_cop: breakdown.discount_amount_cop,
        price_type: priceType,
        price_point_version: pricePoint.version_number,
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
