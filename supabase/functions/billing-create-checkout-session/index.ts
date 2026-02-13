import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Pricing window constants (must match src/lib/billing/pricing-windows.ts)
const PROMO_END_AT = "2026-07-31T23:59:59-05:00";

interface RequestBody {
  organization_id: string;
  plan_code?: string; // New: BASIC | PRO | ENTERPRISE
  tier?: string; // Legacy: for backward compatibility
  billing_cycle_months?: number; // 1 or 24
  discount_code?: string; // Optional: discount code to apply
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
    const { organization_id, billing_cycle_months = 1, discount_code } = body;
    
    // Support both plan_code (new) and tier (legacy)
    const planCode = body.plan_code || body.tier;

    if (!organization_id || !planCode) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Missing organization_id or plan_code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate plan_code
    const validPlanCodes = ["BASIC", "PRO", "ENTERPRISE"];
    if (!validPlanCodes.includes(planCode)) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Invalid plan_code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate billing_cycle_months
    if (![1, 24].includes(billing_cycle_months)) {
      return new Response(
        JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "billing_cycle_months must be 1 or 24" }),
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

    // Get organization to check account_type
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

    // ENTERPRISE requires FIRM account_type
    if (planCode === "ENTERPRISE" && accountType !== "FIRM") {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: "ENTERPRISE_REQUIRES_FIRM", 
          message: "El plan Enterprise requiere una cuenta tipo Firma",
          hint: "Actualiza tu tipo de cuenta a Firma para acceder al plan Enterprise."
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find the billing plan
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

    // Determine price type based on cycle and promo window
    const now = new Date();
    const promoEnd = new Date(PROMO_END_AT);
    const isInPromoWindow = now <= promoEnd;

    let priceType: "INTRO" | "REGULAR";
    if (billing_cycle_months === 24) {
      if (!isInPromoWindow) {
        return new Response(
          JSON.stringify({ 
            ok: false, 
            code: "PROMO_EXPIRED", 
            message: "El período de promoción ha terminado",
            hint: "El compromiso de 24 meses con precio de lanzamiento ya no está disponible."
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      priceType = "INTRO";
    } else {
      priceType = "REGULAR";
    }

    // Find the price point
    const { data: pricePoint, error: priceError } = await supabaseService
      .from("billing_price_points")
      .select("*")
      .eq("plan_id", billingPlan.id)
      .eq("billing_cycle_months", billing_cycle_months)
      .eq("price_type", priceType)
      .lte("valid_from", now.toISOString())
      .or(`valid_to.is.null,valid_to.gte.${now.toISOString()}`)
      .single();

    if (priceError || !pricePoint) {
      console.error("Price point not found:", priceError);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          code: "PRICE_NOT_FOUND", 
          message: "No hay precio disponible para esta configuración",
          hint: `Plan: ${planCode}, Ciclo: ${billing_cycle_months}, Tipo: ${priceType}`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get provider (mock for now)
    const provider = Deno.env.get("BILLING_PROVIDER") || "mock";

    // Validate & apply discount code if provided
    let discountCodeId: string | null = null;
    let discountAmountCop = 0;
    let finalAmountCop = pricePoint.price_cop_incl_iva;

    if (discount_code) {
      const now = new Date();
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

      // Validate eligibility
      if (!discCode.is_active) {
        return new Response(
          JSON.stringify({ ok: false, code: "DISCOUNT_INACTIVE", message: "Código de descuento inactivo" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (discCode.valid_to && new Date(discCode.valid_to) < now) {
        return new Response(
          JSON.stringify({ ok: false, code: "DISCOUNT_EXPIRED", message: "Código de descuento expirado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (discCode.max_redemptions && discCode.current_redemptions >= discCode.max_redemptions) {
        return new Response(
          JSON.stringify({ ok: false, code: "DISCOUNT_LIMIT_REACHED", message: "Código de descuento agotado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check plan eligibility
      if (discCode.eligible_plans && !discCode.eligible_plans.includes(planCode)) {
        return new Response(
          JSON.stringify({ ok: false, code: "DISCOUNT_NOT_ELIGIBLE", message: "Este código no aplica a este plan" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check cycle eligibility
      if (discCode.eligible_cycles && !discCode.eligible_cycles.includes(billing_cycle_months)) {
        return new Response(
          JSON.stringify({ ok: false, code: "DISCOUNT_NOT_ELIGIBLE", message: "Este código no aplica a este ciclo de facturación" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Calculate discount amount
      if (discCode.discount_type === "PERCENT") {
        discountAmountCop = Math.floor((pricePoint.price_cop_incl_iva * discCode.discount_value) / 100);
      } else {
        discountAmountCop = Math.min(discCode.discount_value, pricePoint.price_cop_incl_iva);
      }

      finalAmountCop = Math.max(0, pricePoint.price_cop_incl_iva - discountAmountCop);
      discountCodeId = discCode.id;
    }

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
        tier: planCode, // Store as tier for backward compat
        status: "PENDING",
        checkout_url: checkoutUrl,
        created_by: userId,
        billing_cycle_months,
        price_point_id: pricePoint.id,
        amount_cop_incl_iva: finalAmountCop,
        discount_code_id: discountCodeId,
        discount_amount_cop: discountAmountCop,
        metadata: { 
          created_via: "edge_function",
          user_agent: req.headers.get("User-Agent") || "unknown",
          plan_code: planCode,
          price_type: priceType,
          account_type: accountType,
          discount_applied: discountAmountCop > 0,
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

    // Ensure billing customer exists
    const { data: existingCustomer } = await supabaseService
      .from("billing_customers")
      .select("id")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (!existingCustomer) {
      await supabaseService
        .from("billing_customers")
        .insert({
          organization_id,
          provider: "mock",
          provider_customer_id: `mock_cus_${organization_id}`,
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
        amount_cop: pricePoint.price_cop_incl_iva,
        provider 
      },
    });

    console.log(`[billing-create-checkout-session] Created session ${sessionId} for org ${organization_id}, plan ${planCode}, cycle ${billing_cycle_months}m, price ${pricePoint.price_cop_incl_iva} COP`);

    return new Response(
      JSON.stringify({
        ok: true,
        session_id: session.id,
        checkout_url: session.checkout_url,
        amount_cop_incl_iva: finalAmountCop,
        original_amount_cop: pricePoint.price_cop_incl_iva,
        discount_amount_cop: discountAmountCop,
        price_type: priceType,
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
