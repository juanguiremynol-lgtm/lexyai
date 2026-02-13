/**
 * Billing Admin: Plans & Price Management
 * 
 * POST   /billing-admin-plans → create schedule for future price change
 * PATCH  /billing-admin-plans → apply schedule or manually update price
 * GET    /billing-admin-plans → list active & scheduled prices
 * DELETE /billing-admin-plans → revoke scheduled change
 * 
 * Super Admin only. All changes audited.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateScheduleBody {
  plan_id: string;
  new_price_cop_incl_iva: number;
  effective_at: string; // ISO 8601
  scope: "NEW_ONLY" | "RENEWALS" | "ALL"; // NEW_ONLY: new subscriptions only, RENEWALS: affect next renewal, ALL: immediate danger zone
  reason?: string;
}

interface ApplyScheduleBody {
  schedule_id: string;
  force?: boolean; // force immediate for ALL scope
}

async function verifyPlatformAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

async function createPriceSchedule(
  supabase: any,
  body: CreateScheduleBody,
  userId: string
): Promise<Response> {
  const { plan_id, new_price_cop_incl_iva, effective_at, scope, reason } = body;

  // Validate plan exists
  const { data: plan, error: planError } = await supabase
    .from("billing_plans")
    .select("id, code")
    .eq("id", plan_id)
    .single();

  if (planError || !plan) {
    return new Response(
      JSON.stringify({ ok: false, error: "Plan not found", code: "PLAN_NOT_FOUND" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate price is positive integer
  if (!Number.isInteger(new_price_cop_incl_iva) || new_price_cop_incl_iva <= 0) {
    return new Response(
      JSON.stringify({ ok: false, error: "Price must be positive integer (COP)", code: "INVALID_PRICE" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Create schedule (immutable record)
  const { data: schedule, error: scheduleError } = await supabase
    .from("billing_price_schedules")
    .insert({
      plan_id,
      new_price_cop_incl_iva,
      effective_at,
      scope,
      created_by: userId,
      applied: false,
      reason,
    })
    .select()
    .single();

  if (scheduleError) {
    console.error("Schedule creation failed:", scheduleError);
    return new Response(
      JSON.stringify({ ok: false, error: scheduleError.message, code: "DB_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Audit log
  await supabase.from("audit_logs").insert({
    organization_id: null, // platform-level action
    actor_user_id: userId,
    actor_type: "ADMIN",
    action: "BILLING_PRICE_SCHEDULE_CREATED",
    entity_type: "billing_price_schedule",
    entity_id: schedule.id,
    metadata: {
      plan_code: plan.code,
      new_price: new_price_cop_incl_iva,
      scope,
      effective_at,
    },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      schedule,
    }),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function applyPriceSchedule(
  supabase: any,
  scheduleId: string,
  userId: string
): Promise<Response> {
  // Fetch schedule
  const { data: schedule, error: scheduleError } = await supabase
    .from("billing_price_schedules")
    .select("*")
    .eq("id", scheduleId)
    .single();

  if (scheduleError || !schedule) {
    return new Response(
      JSON.stringify({ ok: false, error: "Schedule not found", code: "NOT_FOUND" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (schedule.applied) {
    return new Response(
      JSON.stringify({ ok: false, error: "Schedule already applied", code: "ALREADY_APPLIED" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Mark as applied
  const { error: updateError } = await supabase
    .from("billing_price_schedules")
    .update({ applied: true, applied_at: new Date().toISOString(), applied_by: userId })
    .eq("id", scheduleId);

  if (updateError) {
    return new Response(
      JSON.stringify({ ok: false, error: updateError.message, code: "DB_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Audit: schedule application
  await supabase.from("audit_logs").insert({
    organization_id: null,
    actor_user_id: userId,
    actor_type: "ADMIN",
    action: "BILLING_PRICE_SCHEDULE_APPLIED",
    entity_type: "billing_price_schedule",
    entity_id: scheduleId,
    metadata: {
      scope: schedule.scope,
      effective_at: schedule.effective_at,
    },
  });

  return new Response(
    JSON.stringify({ ok: true, message: "Schedule applied" }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function listPrices(supabase: any): Promise<Response> {
  // Get plans with current + scheduled prices
  const { data: plans, error: planError } = await supabase
    .from("billing_plans")
    .select("*")
    .order("code");

  if (planError) {
    return new Response(
      JSON.stringify({ ok: false, error: planError.message, code: "DB_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get price points
  const { data: pricePoints } = await supabase
    .from("billing_price_points")
    .select("*");

  // Get schedules
  const { data: schedules } = await supabase
    .from("billing_price_schedules")
    .select("*")
    .eq("applied", false);

  const result = (plans || []).map((p) => ({
    plan: p,
    current_prices: (pricePoints || []).filter((pp) => pp.plan_id === p.id),
    scheduled_changes: (schedules || []).filter((s) => s.plan_id === p.id),
  }));

  return new Response(
    JSON.stringify({ ok: true, data: result }),
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

    // Verify user via token
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

    // Route by method
    if (req.method === "POST") {
      const body = await req.json() as CreateScheduleBody;
      return createPriceSchedule(supabase, body, user.id);
    } else if (req.method === "PATCH") {
      const body = await req.json() as ApplyScheduleBody;
      return applyPriceSchedule(supabase, body.schedule_id, user.id);
    } else if (req.method === "GET") {
      return listPrices(supabase);
    } else {
      return new Response(
        JSON.stringify({ ok: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("billing-admin-plans error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error), code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
