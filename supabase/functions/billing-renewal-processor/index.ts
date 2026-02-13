/**
 * Billing: Renewal Processor
 * 
 * Processes subscription renewals using RENEWALS scope for price resolution.
 * Creates invoices with the correct price version for the renewal date.
 * 
 * POST /billing-renewal-processor
 * Body: {
 *   organization_ids?: string[]; // if omitted, process all
 *   limit?: number; // default 100
 * }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  resolveCurrentPricePoint,
  buildAmountBreakdown,
  PriceScope,
} from "../_shared/pricing-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RenewalProcessorBody {
  organization_ids?: string[];
  limit?: number;
}

async function processRenewals(
  supabase: any,
  body: RenewalProcessorBody
): Promise<Response> {
  const limit = body.limit || 100;
  const now = new Date();

  // Find subscriptions due for renewal
  let query = supabase
    .from("billing_subscription_state")
    .select("*, organizations(id, name)")
    .lt("current_period_end", now.toISOString())
    .eq("is_active", true);

  if (body.organization_ids && body.organization_ids.length > 0) {
    query = query.in("organization_id", body.organization_ids);
  }

  const { data: dueRenewals, error: renewalError } = await query.limit(limit);

  if (renewalError) {
    console.error("Renewal query failed:", renewalError);
    return new Response(
      JSON.stringify({
        ok: false,
        error: renewalError.message,
        code: "DB_ERROR",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fetch price points for resolution
  const { data: pricePoints, error: ppError } = await supabase
    .from("billing_price_points")
    .select("*");

  if (ppError) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: ppError.message,
        code: "DB_ERROR",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const renewalResults = [];
  const renewalDate = now; // Use current time for scope resolution

  for (const subscription of dueRenewals || []) {
    try {
      // Resolve price using RENEWALS scope
      const pricePoint = resolveCurrentPricePoint(pricePoints || [], {
        planId: subscription.plan_id,
        billingCycleMonths: subscription.billing_cycle_months,
        priceType: subscription.price_type || "REGULAR",
        atTime: renewalDate,
        scope: "RENEWALS" as PriceScope,
      });

      if (!pricePoint) {
        renewalResults.push({
          organization_id: subscription.organization_id,
          status: "FAILED",
          reason: "No price point found for renewal",
        });
        continue;
      }

      // Check for discount if previously applied
      let discount = null;
      if (subscription.last_discount_code_id) {
        const { data: discData } = await supabase
          .from("billing_discount_codes")
          .select("*")
          .eq("id", subscription.last_discount_code_id)
          .single();
        discount = discData;
      }

      // Build amount breakdown
      const breakdown = buildAmountBreakdown(pricePoint, discount || undefined);

      // Calculate new period end
      const nextPeriodStart = new Date(subscription.current_period_end);
      const nextPeriodEnd = new Date(nextPeriodStart);
      nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + subscription.billing_cycle_months);

      // Create invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from("billing_invoices")
        .insert({
          organization_id: subscription.organization_id,
          provider: subscription.provider || "mock",
          status: "OPEN",
          amount_cop_incl_iva: breakdown.final_payable_cop,
          currency: "COP",
          period_start: nextPeriodStart.toISOString(),
          period_end: nextPeriodEnd.toISOString(),
          price_point_id: pricePoint.id,
          discount_code_id: discount?.id || null,
          discount_amount_cop: breakdown.discount_amount_cop,
          metadata: {
            source: "RENEWAL",
            renewal_from: subscription.current_period_end,
            renewal_to: nextPeriodEnd.toISOString(),
            amount_breakdown: breakdown,
          },
        })
        .select()
        .single();

      if (invoiceError) {
        throw invoiceError;
      }

      // Update subscription state with new period
      const { error: updateError } = await supabase
        .from("billing_subscription_state")
        .update({
          current_period_start: nextPeriodStart.toISOString(),
          current_period_end: nextPeriodEnd.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("organization_id", subscription.organization_id);

      if (updateError) {
        throw updateError;
      }

      // Create subscription event
      await supabase.from("subscription_events").insert({
        organization_id: subscription.organization_id,
        event_type: "RENEWAL_INVOICE_CREATED",
        actor_type: "SYSTEM",
        actor_user_id: null,
        metadata: {
          invoice_id: invoice.id,
          price_point_id: pricePoint.id,
          price_point_version: pricePoint.version_number,
          amount_cop: breakdown.final_payable_cop,
          renewal_from: subscription.current_period_end,
          renewal_to: nextPeriodEnd.toISOString(),
        },
      });

      renewalResults.push({
        organization_id: subscription.organization_id,
        status: "SUCCESS",
        invoice_id: invoice.id,
        amount: breakdown.final_payable_cop,
      });
    } catch (err) {
      console.error("Renewal processing error:", err);
      renewalResults.push({
        organization_id: subscription.organization_id,
        status: "FAILED",
        reason: String(err),
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: renewalResults.length,
      results: renewalResults,
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
        JSON.stringify({
          ok: false,
          error: "Unauthorized",
          code: "UNAUTHORIZED",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify platform admin
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Invalid token",
          code: "UNAUTHORIZED",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check platform admin
    const { data: platformAdmin } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!platformAdmin) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Platform admin access required",
          code: "FORBIDDEN",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (req.method === "POST") {
      const body = await req.json() as RenewalProcessorBody;
      return processRenewals(supabase, body);
    } else {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Method not allowed",
          code: "METHOD_NOT_ALLOWED",
        }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("billing-renewal-processor error:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: String(error),
        code: "INTERNAL_ERROR",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
