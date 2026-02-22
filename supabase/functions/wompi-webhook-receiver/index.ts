/**
 * Wompi Webhook Receiver — Real payment gateway integration
 * 
 * Receives webhook events from Wompi (payment confirmations, failures, etc.)
 * Verifies HMAC-SHA256 signature, idempotent by gateway_transaction_id
 * Does NOT activate subscriptions directly—marks for Atenia AI verification
 * 
 * Webhook format:
 * - X-Signature: HMAC-SHA256 of JSON body
 * - data.id: gateway transaction ID (unique per payment)
 * - data.status: APPROVED, DECLINED, ERROR, PENDING
 * - data.amount_in_cents: amount in COP (NOTE: Wompi may use different format)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function verifyWompiSignature(body: string, signature: string, secret: string): boolean {
  // HMAC-SHA256 signature verification
  // Wompi computes: HMAC-SHA256(body, secret)
  // We verify it matches the X-Signature header
  try {
    const encoder = new TextEncoder();
    const key = encoder.encode(secret);
    const data = encoder.encode(body);

    // Use WebCrypto API available in Deno
    return crypto.subtle
      .sign("HMAC", new Uint8Array(Buffer.from(secret, "utf-8")), data)
      .then((signature) => { // lint-allow-then: WebCrypto API chaining in HMAC verification
        const computed = Array.from(new Uint8Array(signature))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return computed === signature;
      })
      .catch(() => false);
  } catch {
    return false;
  }
}

async function handleWompiWebhook(
  supabase: any,
  body: any,
  signature: string,
  rawBody: string
): Promise<Response> {
  const wompiSecret = Deno.env.get("WOMPI_WEBHOOK_SECRET");
  if (!wompiSecret) {
    console.error("WOMPI_WEBHOOK_SECRET not configured");
    return new Response(
      JSON.stringify({ ok: false, error: "Webhook not configured", code: "CONFIGURATION_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Verify signature
  const isValid = await verifyWompiSignature(rawBody, signature, wompiSecret);
  if (!isValid) {
    console.warn("[wompi-webhook] Invalid signature. Rejecting.");
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid signature", code: "INVALID_SIGNATURE" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const event = body.event || "unknown";
  const data = body.data || {};
  const transactionId = data.id; // Wompi transaction ID (gateway-unique)

  // Idempotency check: verify this transaction hasn't been processed
  if (transactionId) {
    const { data: existing } = await supabase
      .from("billing_webhook_receipts")
      .select("id")
      .eq("gateway_transaction_id", transactionId)
      .maybeSingle();

    if (existing) {
      console.log(`[wompi-webhook] Idempotent: already processed ${transactionId}`);
      return new Response(
        JSON.stringify({ ok: true, message: "Already processed (idempotent)", transaction_id: transactionId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Redact secrets from body before logging
  const redactedBody = JSON.parse(JSON.stringify(data));
  if (redactedBody.customer) {
    delete redactedBody.customer.email;
  }

  // Log webhook receipt
  const { error: insertError } = await supabase
    .from("billing_webhook_receipts")
    .insert({
      event_type: event,
      gateway: "wompi",
      gateway_transaction_id: transactionId,
      gateway_event_id: data.reference_id || null,
      signature_valid: true,
      payload_redacted: redactedBody,
      raw_event: null, // Don't store raw to save space; we have redacted version
      received_at: new Date().toISOString(),
    });

  if (insertError) {
    console.error("Failed to log webhook receipt:", insertError);
  }

  // Route by event type
  let checkoutSessionId = null;
  let organizationId = null;
  let paymentStatus = "UNKNOWN";
  let amountCopInclIva = 0;

  // Extract metadata from Wompi webhook
  // Wompi sends transaction reference; we need to link to our checkout session
  if (data.reference && typeof data.reference === "string") {
    const match = data.reference.match(/checkout-([a-f0-9-]+)/);
    if (match) {
      checkoutSessionId = match[1];
    }
  }

  // Determine payment status
  if (event === "transaction.confirmed") {
    paymentStatus = "COMPLETED";
  } else if (event === "transaction.failed" || event === "transaction.declined") {
    paymentStatus = "FAILED";
  } else if (event === "transaction.pending") {
    paymentStatus = "PENDING";
  }

  // Extract amount (Wompi may use different field names)
  // Common: data.amount (in cents) or data.amount_in_cents
  if (data.amount) {
    amountCopInclIva = Math.floor(data.amount / 100); // Convert cents to COP units if needed
  } else if (data.amount_in_cents) {
    amountCopInclIva = Math.floor(data.amount_in_cents / 100);
  }

  if (checkoutSessionId) {
    const { data: session } = await supabase
      .from("billing_checkout_sessions")
      .select("organization_id")
      .eq("id", checkoutSessionId)
      .maybeSingle();

    if (session) {
      organizationId = session.organization_id;
    }
  }

  // Queue for Atenia AI verification (do NOT activate subscription here)
  // This allows AI to validate amount, price point version, discount reconciliation, fraud signals
  if (paymentStatus === "COMPLETED" && organizationId && transactionId) {
    const { error: queueError } = await supabase
      .from("atenia_ai_remediation_queue")
      .insert({
        action_type: "VERIFY_PAYMENT",
        organization_id: organizationId,
        payload: {
          gateway_transaction_id: transactionId,
          checkout_session_id: checkoutSessionId,
          wompi_amount_cop: amountCopInclIva,
          wompi_event: event,
        },
        status: "PENDING",
        run_after: new Date().toISOString(), // immediate
        priority: 10, // high
      });

    if (queueError) {
      console.error("Failed to queue payment verification:", queueError);
    }
  }

  // Audit webhook reception
  await supabase.from("audit_logs").insert({
    organization_id: organizationId,
    actor_user_id: null,
    actor_type: "SYSTEM",
    action: "BILLING_WEBHOOK_RECEIVED",
    entity_type: "billing_webhook_receipt",
    entity_id: transactionId,
    metadata: {
      event,
      status: paymentStatus,
      amount_cop: amountCopInclIva,
      signature_valid: true,
    },
  });

  console.log(
    `[wompi-webhook] Received ${event} for transaction ${transactionId}, amount ${amountCopInclIva} COP, queued for verification`
  );

  return new Response(
    JSON.stringify({
      ok: true,
      message: "Webhook received and queued for verification",
      transaction_id: transactionId,
      status: paymentStatus,
    }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ ok: false, error: "Only POST allowed", code: "METHOD_NOT_ALLOWED" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawBody = await req.text();
    const body = JSON.parse(rawBody);
    const signature = req.headers.get("X-Signature") || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    return handleWompiWebhook(supabase, body, signature, rawBody);
  } catch (error) {
    console.error("wompi-webhook error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error), code: "INTERNAL_ERROR" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
