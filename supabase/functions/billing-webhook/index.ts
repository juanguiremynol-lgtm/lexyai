/**
 * Billing Webhook Handler
 *
 * Receives payment gateway callbacks (Wompi, ePayco, etc.),
 * records payment_transactions, and triggers Atenia AI verification.
 *
 * In mock mode: accepts simulated webhook payloads for testing.
 * In production: validates gateway signature before processing.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-signature, x-gateway-signature",
};

interface NormalizedPaymentEvent {
  gateway_transaction_id: string;
  gateway_reference: string;
  gateway_status: string;
  normalized_status: "APPROVED" | "DECLINED" | "PENDING" | "VOIDED" | "ERROR";
  amount: number;
  currency: string;
  organization_id: string;
  checkout_session_id: string;
  plan_code: string;
  billing_cycle_months: number;
  transaction_type: string;
  user_id?: string;
  raw_response: Record<string, unknown>;
}

/**
 * Redact sensitive fields from gateway response before storage
 */
function redactGatewayResponse(raw: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...raw };
  const sensitiveKeys = [
    "card_number", "cvv", "cvc", "security_code", "pan",
    "token", "secret", "password", "api_key", "private_key",
  ];
  for (const key of Object.keys(redacted)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      redacted[key] = "[REDACTED]";
    }
  }
  return redacted;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check short-circuit
  try {
    const cloned = req.clone();
    const maybeBody = await cloned.json().catch(() => null);
    if (maybeBody?.health_check) {
      return new Response(JSON.stringify({ status: "OK", function: "billing-webhook" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* not JSON, proceed normally */ }

  try {
    const provider = Deno.env.get("BILLING_PROVIDER") || "mock";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();

    // ========================================================================
    // MOCK MODE: Accept simulated webhook for testing
    // ========================================================================
    if (provider === "mock") {
      console.log("[billing-webhook] Processing mock webhook");

      // Mock expects: { organization_id, checkout_session_id, plan_code, amount_cop, billing_cycle_months, status }
      const {
        organization_id,
        checkout_session_id,
        plan_code,
        amount_cop,
        billing_cycle_months = 1,
        status = "APPROVED",
      } = body;

      if (!organization_id || !plan_code || !amount_cop) {
        return new Response(
          JSON.stringify({ ok: false, code: "BAD_REQUEST", message: "Missing required fields for mock webhook" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const transactionId = crypto.randomUUID();
      const normalizedStatus = status === "APPROVED" ? "PROCESSING" : "FAILED";

      // Create payment transaction
      const { error: insertError } = await supabase
        .from("payment_transactions")
        .insert({
          id: transactionId,
          organization_id,
          checkout_session_id: checkout_session_id || null,
          plan_code,
          amount_cop,
          currency: "COP",
          billing_cycle_months,
          transaction_type: "SUBSCRIPTION",
          gateway: "mock",
          gateway_transaction_id: `mock_txn_${Date.now()}`,
          gateway_reference: `mock_ref_${Date.now()}`,
          gateway_response: { mock: true, original_status: status },
          gateway_status: status,
          status: normalizedStatus,
        });

      if (insertError) {
        console.error("[billing-webhook] Failed to insert transaction:", insertError);
        return new Response(
          JSON.stringify({ ok: false, code: "DB_ERROR", message: insertError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Log subscription event
      await supabase.from("subscription_events").insert({
        organization_id,
        event_type: status === "APPROVED" ? "PAYMENT_RECEIVED" : "PAYMENT_FAILED",
        description: status === "APPROVED"
          ? `Pago mock de $${amount_cop.toLocaleString("es-CO")} COP recibido. Pendiente verificación por Atenia AI.`
          : `Pago mock de $${amount_cop.toLocaleString("es-CO")} COP falló.`,
        payload: { transaction_id: transactionId, gateway: "mock", status },
        triggered_by: "GATEWAY_WEBHOOK",
      });

      // If approved, trigger Atenia AI verification
      if (status === "APPROVED") {
        try {
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
          const verifyResult = await verifyResponse.json();
          console.log("[billing-webhook] Verification result:", verifyResult);

          return new Response(
            JSON.stringify({
              ok: true,
              transaction_id: transactionId,
              verification: verifyResult,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (verifyError) {
          console.error("[billing-webhook] Verification call failed:", verifyError);
          // Still return success — verification will be picked up by heartbeat
          return new Response(
            JSON.stringify({
              ok: true,
              transaction_id: transactionId,
              verification_pending: true,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(
        JSON.stringify({ ok: true, transaction_id: transactionId, status: normalizedStatus }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========================================================================
    // WOMPI MODE: Validate signature and process real webhook
    // ========================================================================
    if (provider === "wompi") {
      const signature = req.headers.get("x-webhook-signature") || req.headers.get("x-gateway-signature") || "";
      
      // TODO: Validate Wompi webhook signature
      // const wompiSecret = Deno.env.get("WOMPI_WEBHOOK_SECRET");
      // if (!verifyWompiSignature(body, signature, wompiSecret)) { ... }

      console.log("[billing-webhook] Wompi webhook received (signature validation pending)");
      
      // TODO: Parse Wompi payload into NormalizedPaymentEvent
      // const event = parseWompiWebhook(body);
      
      return new Response(
        JSON.stringify({ ok: true, processed: false, reason: "wompi_integration_pending" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Unknown provider
    console.log(`[billing-webhook] Unknown provider: ${provider}`);
    return new Response(
      JSON.stringify({ ok: true, ignored: true, reason: `unknown_provider_${provider}` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("billing-webhook error:", error);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
