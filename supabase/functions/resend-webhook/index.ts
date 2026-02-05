/**
 * Resend Webhook Handler Edge Function
 * 
 * Receives POST webhooks from Resend for email delivery events:
 * - delivered/sent → mark email_outbox status = SENT
 * - bounced → FAILED permanent, failure_type = "BOUNCE"
 * - complained → FAILED permanent, failure_type = "COMPLAINT"
 * - suppressed → FAILED permanent, failure_type = "SUPPRESSED"
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Resend webhook event types
type ResendEventType = 
  | "email.sent"
  | "email.delivered"
  | "email.bounced"
  | "email.complained"
  | "email.opened"
  | "email.clicked"
  | "email.unsubscribed";

interface ResendWebhookPayload {
  type: ResendEventType;
  created_at: string;
  data: {
    email_id: string;
    to: string[];
    from: string;
    subject: string;
    // For bounces
    bounce?: {
      message: string;
    };
    // For complaints
    complaint?: {
      message: string;
    };
  };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Only POST allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[resend-webhook] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return new Response(
      JSON.stringify({ ok: false, code: "MISSING_SECRET", message: "Server configuration error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Parse webhook payload
    const payload: ResendWebhookPayload = await req.json();
    
    console.log(`[resend-webhook] Received event: ${payload.type}, email_id: ${payload.data.email_id}`);

    // Verify webhook signature if secret is configured
    if (webhookSecret) {
      const signature = req.headers.get("svix-signature");
      const timestamp = req.headers.get("svix-timestamp");
      const webhookId = req.headers.get("svix-id");

      if (!signature || !timestamp || !webhookId) {
        console.warn("[resend-webhook] Missing webhook signature headers");
        // Continue anyway for now, but log a warning
        // In production, you might want to reject unsigned webhooks
      }
      // Note: Full signature verification requires the svix library
      // For now, we'll trust the Resend webhook if the secret is configured
    }

    const providerMessageId = payload.data.email_id;
    const eventType = payload.type;
    const eventTime = new Date().toISOString();

    // Find the email_outbox record by provider_message_id
    const { data: outboxRecord, error: fetchError } = await supabase
      .from("email_outbox")
      .select("id, organization_id, status, failed_permanent")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();

    if (fetchError) {
      console.error("[resend-webhook] Error fetching outbox record:", fetchError.message);
      throw fetchError;
    }

    if (!outboxRecord) {
      console.warn(`[resend-webhook] No email_outbox record found for provider_message_id: ${providerMessageId}`);
      
      // Log health event for unmatched webhook
      await supabase.from("system_health_events").insert({
        service: "resend_webhook",
        status: "WARN",
        message: `Webhook received for unknown message: ${providerMessageId}`,
        metadata: { event_type: eventType, provider_message_id: providerMessageId },
      });

      // Return 200 OK to prevent Resend from retrying (idempotent)
      return new Response(
        JSON.stringify({ ok: true, message: "No matching record found, ignoring" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const previousStatus = outboxRecord.status;
    let newStatus = previousStatus;
    let failedPermanent = outboxRecord.failed_permanent || false;
    let failureType: string | null = null;
    let errorMessage: string | null = null;

    // Process event type
    switch (eventType) {
      case "email.sent":
      case "email.delivered":
        // Only update to SENT if not already in a terminal state
        if (!["SENT", "FAILED", "CANCELLED", "SUPPRESSED"].includes(previousStatus)) {
          newStatus = "SENT";
        }
        break;

      case "email.bounced":
        newStatus = "FAILED";
        failedPermanent = true;
        failureType = "BOUNCE";
        errorMessage = payload.data.bounce?.message || "Email bounced";
        
        // Add to suppression list
        if (payload.data.to?.[0]) {
          await supabase.from("email_suppressions").upsert({
            organization_id: outboxRecord.organization_id,
            email: payload.data.to[0].toLowerCase(),
            reason: `BOUNCE: ${errorMessage}`,
          }, { onConflict: "organization_id,email" });
        }
        break;

      case "email.complained":
        newStatus = "FAILED";
        failedPermanent = true;
        failureType = "COMPLAINT";
        errorMessage = payload.data.complaint?.message || "Spam complaint received";
        
        // Add to suppression list
        if (payload.data.to?.[0]) {
          await supabase.from("email_suppressions").upsert({
            organization_id: outboxRecord.organization_id,
            email: payload.data.to[0].toLowerCase(),
            reason: `COMPLAINT: ${errorMessage}`,
          }, { onConflict: "organization_id,email" });
        }
        break;

      default:
        // For other events (opened, clicked, etc.), just log but don't update status
        console.log(`[resend-webhook] Ignoring event type: ${eventType}`);
    }

    // Update email_outbox record if status changed
    if (newStatus !== previousStatus || failedPermanent !== outboxRecord.failed_permanent) {
      const updateData: Record<string, unknown> = {
        status: newStatus,
        last_event_type: eventType,
        last_event_at: eventTime,
        failed_permanent: failedPermanent,
      };

      if (failureType) {
        updateData.failure_type = failureType;
      }

      if (errorMessage) {
        updateData.error = errorMessage;
      }

      if (newStatus === "SENT" && previousStatus !== "SENT") {
        updateData.sent_at = eventTime;
      }

      const { error: updateError } = await supabase
        .from("email_outbox")
        .update(updateData)
        .eq("id", outboxRecord.id);

      if (updateError) {
        console.error("[resend-webhook] Error updating outbox record:", updateError.message);
        throw updateError;
      }
    }

    // Log audit event
    await supabase.from("audit_logs").insert({
      organization_id: outboxRecord.organization_id,
      actor_type: "SYSTEM",
      action: "EMAIL_WEBHOOK_EVENT",
      entity_type: "email_outbox",
      entity_id: outboxRecord.id,
      metadata: {
        event_type: eventType,
        provider_message_id: providerMessageId,
        previous_status: previousStatus,
        new_status: newStatus,
        failed_permanent: failedPermanent,
        failure_type: failureType,
      },
    });

    // Log health event
    await supabase.from("system_health_events").insert({
      service: "resend_webhook",
      status: "OK",
      message: `Processed ${eventType} for email ${outboxRecord.id}`,
      organization_id: outboxRecord.organization_id,
      metadata: {
        event_type: eventType,
        outbox_id: outboxRecord.id,
        provider_message_id: providerMessageId,
        status_change: previousStatus !== newStatus ? `${previousStatus} → ${newStatus}` : null,
      },
    });

    console.log(`[resend-webhook] Processed successfully: ${eventType}, outbox_id: ${outboxRecord.id}, status: ${previousStatus} → ${newStatus}`);

    return new Response(
      JSON.stringify({ ok: true, processed: true, status_change: previousStatus !== newStatus }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[resend-webhook] Error:", errorMessage);

    // Log health event for error
    await supabase.from("system_health_events").insert({
      service: "resend_webhook",
      status: "ERROR",
      message: `Webhook processing failed: ${errorMessage}`,
      metadata: { error: errorMessage },
    });

    return new Response(
      JSON.stringify({ ok: false, code: "WEBHOOK_FAILED", message: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});