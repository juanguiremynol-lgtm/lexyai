/**
 * Billing Admin: Subscription Overrides & Lifecycle Management
 * 
 * GET    /billing-admin-subscriptions?org_id=... → view subscription state + events
 * POST   /billing-admin-subscriptions → admin action (force re-verify, extend trial, schedule cancel, etc.)
 * PATCH  /billing-admin-subscriptions → update subscription metadata
 * 
 * Super Admin only. All changes → atenia_ai_actions + subscription_events audit trail.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AdminActionBody {
  organization_id: string;
  action: "FORCE_RE_VERIFY" | "EXTEND_TRIAL" | "SCHEDULE_CANCELLATION" | "REVERSE_CANCELLATION" | "GRANT_COMP";
  duration_days?: number; // for EXTEND_TRIAL, SCHEDULE_CANCELLATION
  reason: string; // required justification
  notes?: string;
}

async function verifyPlatformAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

async function getSubscriptionState(
  supabase: any,
  organizationId: string
): Promise<Response> {
  // Get current state
  const { data: state, error: stateError } = await supabase
    .from("billing_subscription_state")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (stateError || !state) {
    return new Response(
      JSON.stringify({ ok: false, error: "Subscription state not found", code: "NOT_FOUND" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get immutable events
  const { data: events } = await supabase
    .from("subscription_events")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  // Get organization details
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .single();

  // Get recent invoices
  const { data: invoices } = await supabase
    .from("billing_invoices")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(10);

  return new Response(
    JSON.stringify({
      ok: true,
      state,
      events: events || [],
      organization: org,
      recent_invoices: invoices || [],
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function performAdminAction(
  supabase: any,
  body: AdminActionBody,
  userId: string
): Promise<Response> {
  const { organization_id, action, duration_days, reason, notes } = body;

  if (!reason || reason.length < 10) {
    return new Response(
      JSON.stringify({ ok: false, error: "Reason must be at least 10 characters", code: "INVALID_REASON" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get current subscription state
  const { data: state } = await supabase
    .from("billing_subscription_state")
    .select("*")
    .eq("organization_id", organization_id)
    .maybeSingle();

  if (!state) {
    return new Response(
      JSON.stringify({ ok: false, error: "Subscription not found", code: "NOT_FOUND" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let eventDescription = "";
  let updatedState: any = null;

  // Execute action
  switch (action) {
    case "FORCE_RE_VERIFY":
      // Log action, reset verification status (allow Atenia AI to re-check payment)
      eventDescription = "Administrador forzó reverificación de pago";
      updatedState = { ...state, verification_status: "PENDING" };
      break;

    case "EXTEND_TRIAL":
      if (!duration_days || duration_days <= 0) {
        return new Response(
          JSON.stringify({ ok: false, error: "duration_days required and must be > 0", code: "INVALID_DURATION" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const newTrialEnd = new Date();
      newTrialEnd.setDate(newTrialEnd.getDate() + duration_days);
      eventDescription = `Administrador extendió período de prueba por ${duration_days} días`;
      updatedState = { ...state, trial_end_at: newTrialEnd.toISOString() };
      break;

    case "SCHEDULE_CANCELLATION":
      if (!duration_days || duration_days < 0) {
        return new Response(
          JSON.stringify({ ok: false, error: "duration_days required (≥0)", code: "INVALID_DURATION" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const cancelDate = new Date();
      cancelDate.setDate(cancelDate.getDate() + duration_days);
      eventDescription = `Administrador programó cancelación para ${cancelDate.toLocaleDateString("es-CO")}`;
      updatedState = { ...state, cancellation_scheduled_at: cancelDate.toISOString() };
      break;

    case "REVERSE_CANCELLATION":
      if (!state.cancellation_scheduled_at) {
        return new Response(
          JSON.stringify({ ok: false, error: "No scheduled cancellation to reverse", code: "NO_SCHEDULED_CANCELLATION" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      eventDescription = "Administrador revirtió cancelación programada";
      updatedState = { ...state, cancellation_scheduled_at: null };
      break;

    case "GRANT_COMP":
      if (!duration_days || duration_days <= 0) {
        return new Response(
          JSON.stringify({ ok: false, error: "duration_days required for comp", code: "INVALID_DURATION" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const compEnd = new Date();
      compEnd.setDate(compEnd.getDate() + duration_days);
      eventDescription = `Administrador otorgó ${duration_days} días de acceso gratuito`;
      updatedState = { ...state, comped_until_at: compEnd.toISOString(), comped_reason: `ADMIN_COMP: ${reason}` };
      break;

    default:
      return new Response(
        JSON.stringify({ ok: false, error: "Unknown action", code: "INVALID_ACTION" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
  }

  // Update subscription state (immutably)
  if (updatedState) {
    const { error: updateError } = await supabase
      .from("billing_subscription_state")
      .update(updatedState)
      .eq("organization_id", organization_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ ok: false, error: updateError.message, code: "DB_ERROR" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Record in atenia_ai_actions ledger (admin override)
  const { error: actionError } = await supabase
    .from("atenia_ai_actions")
    .insert({
      organization_id,
      action_type: `ADMIN_${action}`,
      autonomy_tier: "ADMIN_OVERRIDE",
      actor_user_id: userId,
      reasoning: `${reason}. ${notes || ""}`,
      status: "COMPLETED",
      actor: "PLATFORM_ADMIN",
      created_at: new Date().toISOString(),
    });

  if (actionError) {
    console.error("Failed to log atenia_ai_action:", actionError);
  }

  // Record immutable event in subscription_events
  const { error: eventError } = await supabase
    .from("subscription_events")
    .insert({
      organization_id,
      event_type: `ADMIN_${action}`,
      description: eventDescription,
      actor_user_id: userId,
      actor_type: "ADMIN",
      metadata: {
        reason,
        notes,
        previous_state: state,
        new_state: updatedState,
      },
    });

  if (eventError) {
    console.error("Failed to create subscription_event:", eventError);
  }

  // Audit log
  await supabase.from("audit_logs").insert({
    organization_id,
    actor_user_id: userId,
    actor_type: "ADMIN",
    action: `BILLING_ADMIN_${action}`,
    entity_type: "billing_subscription_state",
    entity_id: organization_id,
    metadata: {
      reason,
      duration_days,
      notes,
    },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      message: eventDescription,
      updated_state: updatedState,
    }),
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
    if (req.method === "GET") {
      const url = new URL(req.url);
      const orgId = url.searchParams.get("org_id");
      if (!orgId) {
        return new Response(
          JSON.stringify({ ok: false, error: "org_id query parameter required", code: "INVALID_REQUEST" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return getSubscriptionState(supabase, orgId);
    } else if (req.method === "POST") {
      const body = await req.json() as AdminActionBody;
      return performAdminAction(supabase, body, user.id);
    } else {
      return new Response(
        JSON.stringify({ ok: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("billing-admin-subscriptions error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error), code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
