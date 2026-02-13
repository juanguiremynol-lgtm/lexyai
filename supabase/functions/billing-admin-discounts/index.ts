/**
 * Billing Admin: Discount Code Management
 * 
 * POST   /billing-admin-discounts → create discount code
 * PATCH  /billing-admin-discounts → update (activate/deactivate)
 * GET    /billing-admin-discounts → list codes + redemptions
 * DELETE /billing-admin-discounts → deactivate code
 * 
 * Super Admin only. All changes audited.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateDiscountBody {
  code: string; // e.g., "LAUNCH50"
  discount_type: "PERCENT" | "FIXED_COP";
  discount_value: number; // 50 for 50%, or 50000 for 50k COP
  eligible_plans?: string[]; // ["BASIC", "PRO"] or null for all
  eligible_cycles?: number[]; // [1, 24] or null for all
  max_redemptions?: number | null;
  valid_from?: string; // ISO 8601, default now
  valid_to?: string | null; // ISO 8601 or null for no expiry
  target_org_id?: string | null; // restrict to single org
  target_user_email?: string | null; // restrict to user email
  notes?: string;
}

interface UpdateDiscountBody {
  code_id: string;
  is_active: boolean;
}

async function verifyPlatformAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

async function createDiscount(
  supabase: any,
  body: CreateDiscountBody,
  userId: string
): Promise<Response> {
  const {
    code,
    discount_type,
    discount_value,
    eligible_plans,
    eligible_cycles,
    max_redemptions,
    valid_from,
    valid_to,
    target_org_id,
    target_user_email,
    notes,
  } = body;

  // Validate inputs
  if (!code || code.length < 3) {
    return new Response(
      JSON.stringify({ ok: false, error: "Code must be at least 3 characters", code: "INVALID_CODE" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (discount_type === "PERCENT" && (discount_value <= 0 || discount_value > 100)) {
    return new Response(
      JSON.stringify({ ok: false, error: "Percent discount must be 1–100", code: "INVALID_VALUE" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (discount_type === "FIXED_COP" && (!Number.isInteger(discount_value) || discount_value <= 0)) {
    return new Response(
      JSON.stringify({ ok: false, error: "Fixed amount must be positive integer (COP)", code: "INVALID_VALUE" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check for duplicate code
  const { data: existing } = await supabase
    .from("billing_discount_codes")
    .select("id")
    .eq("code", code.toUpperCase())
    .maybeSingle();

  if (existing) {
    return new Response(
      JSON.stringify({ ok: false, error: "Code already exists", code: "DUPLICATE_CODE" }),
      { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Insert discount code
  const { data: discount, error: insertError } = await supabase
    .from("billing_discount_codes")
    .insert({
      code: code.toUpperCase().trim(),
      discount_type,
      discount_value,
      eligible_plans: eligible_plans || null,
      eligible_cycles: eligible_cycles || null,
      max_redemptions: max_redemptions || null,
      valid_from: valid_from || new Date().toISOString(),
      valid_to: valid_to || null,
      target_org_id: target_org_id || null,
      target_user_email: target_user_email ? target_user_email.toLowerCase() : null,
      is_active: true,
      current_redemptions: 0,
      created_by: userId,
      notes: notes || null,
    })
    .select()
    .single();

  if (insertError) {
    console.error("Discount insert failed:", insertError);
    return new Response(
      JSON.stringify({ ok: false, error: insertError.message, code: "DB_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Audit
  await supabase.from("audit_logs").insert({
    organization_id: null,
    actor_user_id: userId,
    actor_type: "ADMIN",
    action: "BILLING_DISCOUNT_CODE_CREATED",
    entity_type: "billing_discount_code",
    entity_id: discount.id,
    metadata: {
      code: discount.code,
      discount_type,
      discount_value,
      eligible_plans,
      eligible_cycles,
    },
  });

  return new Response(
    JSON.stringify({ ok: true, discount }),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function updateDiscount(
  supabase: any,
  body: UpdateDiscountBody,
  userId: string
): Promise<Response> {
  const { code_id, is_active } = body;

  const { error } = await supabase
    .from("billing_discount_codes")
    .update({ is_active })
    .eq("id", code_id);

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message, code: "DB_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Audit
  await supabase.from("audit_logs").insert({
    organization_id: null,
    actor_user_id: userId,
    actor_type: "ADMIN",
    action: is_active ? "BILLING_DISCOUNT_CODE_ACTIVATED" : "BILLING_DISCOUNT_CODE_DEACTIVATED",
    entity_type: "billing_discount_code",
    entity_id: code_id,
    metadata: { is_active },
  });

  return new Response(
    JSON.stringify({ ok: true, message: `Code ${is_active ? "activated" : "deactivated"}` }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function listDiscounts(supabase: any): Promise<Response> {
  const { data: codes, error: codesError } = await supabase
    .from("billing_discount_codes")
    .select("*")
    .order("created_at", { ascending: false });

  if (codesError) {
    return new Response(
      JSON.stringify({ ok: false, error: codesError.message, code: "DB_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get recent redemptions
  const { data: redemptions } = await supabase
    .from("billing_discount_redemptions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return new Response(
    JSON.stringify({ ok: true, codes: codes || [], redemptions: redemptions || [] }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid token", code: "UNAUTHORIZED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check platform admin
    const isPlatformAdmin = await verifyPlatformAdmin(supabase, user.id);
    if (!isPlatformAdmin) {
      return new Response(
        JSON.stringify({ ok: false, error: "Platform admin access required", code: "FORBIDDEN" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route
    if (req.method === "POST") {
      const body = await req.json() as CreateDiscountBody;
      return createDiscount(supabase, body, user.id);
    } else if (req.method === "PATCH") {
      const body = await req.json() as UpdateDiscountBody;
      return updateDiscount(supabase, body, user.id);
    } else if (req.method === "GET") {
      return listDiscounts(supabase);
    } else {
      return new Response(
        JSON.stringify({ ok: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("billing-admin-discounts error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error), code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
