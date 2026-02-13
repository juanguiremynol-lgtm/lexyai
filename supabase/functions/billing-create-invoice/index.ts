/**
 * Billing: Create Invoice
 * 
 * Creates an immutable invoice record with historical price point versioning.
 * Used by renewal processes and admin operations.
 * 
 * POST /billing-create-invoice
 * Body: {
 *   organization_id: string;
 *   price_point_id: string;
 *   discount_code_id?: string;
 *   amount_breakdown: AmountBreakdown;
 *   period_start: string; // ISO
 *   period_end: string;   // ISO
 *   invoice_reason: "RENEWAL" | "MANUAL" | "ONE_TIME";
 * }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  resolveCurrentPricePoint,
  buildAmountBreakdown,
  redactSecrets,
} from "../_shared/pricing-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateInvoiceBody {
  organization_id: string;
  price_point_id: string;
  discount_code_id?: string;
  amount_breakdown: {
    base_price_cop: number;
    discount_amount_cop: number;
    final_payable_cop: number;
    discount_code?: string;
    plan_id: string;
    billing_cycle_months: number;
  };
  period_start: string;
  period_end: string;
  invoice_reason: "RENEWAL" | "MANUAL" | "ONE_TIME";
}

async function verifyOrgAdminOrPlatformAdmin(
  supabase: any,
  userId: string,
  organizationId: string
): Promise<boolean> {
  // Check platform admin
  const { data: platformAdmin } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (platformAdmin) return true;

  // Check org admin
  const { data: orgMember } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  return orgMember && ["OWNER", "ADMIN"].includes(orgMember.role);
}

async function createInvoice(
  supabase: any,
  body: CreateInvoiceBody,
  userId: string
): Promise<Response> {
  const {
    organization_id,
    price_point_id,
    discount_code_id,
    amount_breakdown,
    period_start,
    period_end,
    invoice_reason,
  } = body;

  // Verify authorization
  const isAuthorized = await verifyOrgAdminOrPlatformAdmin(
    supabase,
    userId,
    organization_id
  );

  if (!isAuthorized) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Not authorized to create invoice for this org",
        code: "FORBIDDEN",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate org exists
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", organization_id)
    .single();

  if (orgError || !org) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Organization not found",
        code: "NOT_FOUND",
      }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate price point exists and is historical
  const { data: pricePoint, error: ppError } = await supabase
    .from("billing_price_points")
    .select("*")
    .eq("id", price_point_id)
    .single();

  if (ppError || !pricePoint) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Price point not found",
        code: "INVALID_PRICE_POINT",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Create invoice (immutable record)
  const { data: invoice, error: invoiceError } = await supabase
    .from("billing_invoices")
    .insert({
      organization_id,
      provider: "mock", // Will be overridden by payment gateway
      status: "DRAFT",
      amount_cop_incl_iva: amount_breakdown.final_payable_cop,
      currency: "COP",
      period_start: new Date(period_start).toISOString(),
      period_end: new Date(period_end).toISOString(),
      price_point_id,
      discount_code_id: discount_code_id || null,
      discount_amount_cop: amount_breakdown.discount_amount_cop,
      metadata: {
        source: invoice_reason,
        amount_breakdown,
        created_by: userId,
      },
    })
    .select()
    .single();

  if (invoiceError) {
    console.error("Invoice creation failed:", invoiceError);
    return new Response(
      JSON.stringify({
        ok: false,
        error: invoiceError.message,
        code: "DB_ERROR",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Audit log
  await supabase.from("audit_logs").insert({
    organization_id,
    actor_user_id: userId,
    actor_type: "ADMIN",
    action: "BILLING_INVOICE_CREATED",
    entity_type: "billing_invoice",
    entity_id: invoice.id,
    metadata: {
      reason: invoice_reason,
      period_start,
      period_end,
      amount_cop: amount_breakdown.final_payable_cop,
      discount_code_id: discount_code_id || null,
    },
  });

  // Create subscription_events entry
  await supabase.from("subscription_events").insert({
    organization_id,
    event_type: "INVOICE_CREATED",
    actor_type: "ADMIN",
    actor_user_id: userId,
    metadata: {
      invoice_id: invoice.id,
      reason: invoice_reason,
      amount_cop: amount_breakdown.final_payable_cop,
    },
  });

  return new Response(
    JSON.stringify({
      ok: true,
      invoice,
    }),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    // Verify user
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

    if (req.method === "POST") {
      const body = await req.json() as CreateInvoiceBody;
      return createInvoice(supabase, body, user.id);
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
    console.error("billing-create-invoice error:", error);
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
