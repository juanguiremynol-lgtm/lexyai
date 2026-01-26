/**
 * Billing Webhook Handler
 * 
 * Placeholder for future payment gateway webhook events.
 * Currently returns success without processing in mock mode.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature, x-webhook-signature",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const provider = Deno.env.get("BILLING_PROVIDER") || "mock";

    // In mock mode, just acknowledge the webhook
    if (provider === "mock") {
      console.log("[billing-webhook] Received webhook in mock mode, ignoring");
      return new Response(
        JSON.stringify({ ok: true, ignored: true, reason: "mock_mode" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Future: Validate webhook signature based on provider
    // Future: Parse and process webhook events

    const body = await req.text();
    console.log("[billing-webhook] Received webhook payload:", body.substring(0, 200));

    // Placeholder for future processing
    // const event = parseWebhookEvent(provider, body, req.headers);
    // await processWebhookEvent(event);

    return new Response(
      JSON.stringify({ ok: true, processed: false, reason: "provider_not_configured" }),
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
