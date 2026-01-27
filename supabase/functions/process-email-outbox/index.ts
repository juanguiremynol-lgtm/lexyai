/**
 * Email Outbox Worker Edge Function
 * 
 * Processes pending emails with retry/backoff logic and bounce suppression.
 * Sends via Cloud Run Email Gateway (Option B architecture).
 * Designed to be called on a schedule (external scheduler) or manually.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Email Gateway configuration (Cloud Run Option B)
const EMAIL_GATEWAY_BASE_URL = Deno.env.get("EMAIL_GATEWAY_BASE_URL");
const EMAIL_GATEWAY_API_KEY = Deno.env.get("EMAIL_GATEWAY_API_KEY");
const EMAIL_FROM_ADDRESS = Deno.env.get("EMAIL_FROM_ADDRESS") || "ATENIA <noreply@placeholder.com>";

// Retry backoff intervals in minutes
const BACKOFF_INTERVALS = [1, 5, 15, 60, 360, 1440, 2880, 4320]; // 1m, 5m, 15m, 1h, 6h, 24h, 48h, 72h
const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 10;

interface EmailOutboxRow {
  id: string;
  organization_id: string;
  to_email: string;
  subject: string;
  html: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
  metadata: Record<string, unknown> | null;
  work_item_id?: string | null;
  trigger_event?: string | null;
  alert_instance_id?: string | null;
}

interface ProcessResult {
  ok: boolean;
  processed: number;
  sent: number;
  failed: number;
  suppressed: number;
  errors: Array<{ id: string; error: string }>;
  gateway_configured: boolean;
}

interface GatewaySuccessResponse {
  id: string;
}

interface GatewayErrorResponse {
  error: string;
  error_code?: string;
}

// Helper to mask email for safe logging (no PII leak)
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  const maskedLocal = local.length > 2 ? local[0] + "***" : "***";
  return `${maskedLocal}@${domain}`;
}

// Check if error is transient (should retry) or permanent (should not retry)
function isPermanentError(errorCode: string | undefined, statusCode: number): boolean {
  // 4xx errors (except 429) are usually permanent
  if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
    return true;
  }
  // Specific permanent error codes
  const permanentCodes = ["invalid_recipient", "blocked", "unsubscribed", "complained", "invalid_email"];
  return permanentCodes.includes(errorCode || "");
}

// Send email via Cloud Run Email Gateway
async function sendViaGateway(
  email: EmailOutboxRow
): Promise<{ success: boolean; provider_message_id?: string; error?: string; error_code?: string; statusCode?: number }> {
  if (!EMAIL_GATEWAY_BASE_URL || !EMAIL_GATEWAY_API_KEY) {
    return {
      success: false,
      error: "Email gateway not configured (missing EMAIL_GATEWAY_BASE_URL or EMAIL_GATEWAY_API_KEY)",
      error_code: "GATEWAY_NOT_CONFIGURED",
    };
  }

  const gatewayUrl = `${EMAIL_GATEWAY_BASE_URL}/send`;

  const payload = {
    organization_id: email.organization_id,
    to: email.to_email,
    subject: email.subject,
    html: email.html,
    from: EMAIL_FROM_ADDRESS,
    metadata: {
      email_outbox_id: email.id,
      work_item_id: email.work_item_id || null,
      trigger_event: email.trigger_event || null,
      alert_instance_id: email.alert_instance_id || null,
      ...(email.metadata || {}),
    },
  };

  try {
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${EMAIL_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const statusCode = response.status;

    if (response.ok) {
      const result = (await response.json()) as GatewaySuccessResponse;
      return {
        success: true,
        provider_message_id: result.id,
        statusCode,
      };
    } else {
      const errorResult = (await response.json()) as GatewayErrorResponse;
      return {
        success: false,
        error: errorResult.error || `Gateway error: ${statusCode}`,
        error_code: errorResult.error_code,
        statusCode,
      };
    }
  } catch (err) {
    // Network/fetch errors are transient
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gateway connection failed",
      error_code: "NETWORK_ERROR",
    };
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const result: ProcessResult = {
    ok: true,
    processed: 0,
    sent: 0,
    failed: 0,
    suppressed: 0,
    errors: [],
    gateway_configured: !!(EMAIL_GATEWAY_BASE_URL && EMAIL_GATEWAY_API_KEY),
  };

  // Early check for gateway configuration
  if (!result.gateway_configured) {
    console.warn("[process-email-outbox] Email gateway not configured. Emails will fail to send.");
  }

  try {
    // Fetch emails ready to be processed
    const now = new Date().toISOString();
    const { data: emails, error: fetchError } = await supabase
      .from("email_outbox")
      .select("*")
      .in("status", ["PENDING", "FAILED"])
      .lte("next_attempt_at", now)
      .lt("attempts", MAX_ATTEMPTS)
      .order("next_attempt_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("[process-email-outbox] Fetch error:", fetchError);
      throw fetchError;
    }

    if (!emails || emails.length === 0) {
      console.log("[process-email-outbox] No emails to process");
      return new Response(
        JSON.stringify({ ...result, message: "No emails to process" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[process-email-outbox] Processing ${emails.length} emails`);

    // Fetch all suppressions for the organizations involved
    const orgIds = [...new Set(emails.map((e: EmailOutboxRow) => e.organization_id))];
    const { data: suppressions } = await supabase
      .from("email_suppressions")
      .select("email, organization_id, reason")
      .in("organization_id", orgIds);

    const suppressionMap = new Map<string, string>();
    (suppressions || []).forEach((s) => {
      suppressionMap.set(`${s.organization_id}:${s.email.toLowerCase()}`, s.reason);
    });

    // Process each email
    for (const email of emails as EmailOutboxRow[]) {
      result.processed++;

      // Log with masked email for privacy
      console.log(`[process-email-outbox] Processing email ${email.id} to ${maskEmail(email.to_email)}`);

      try {
        // Check for suppression
        const suppressKey = `${email.organization_id}:${email.to_email.toLowerCase()}`;
        const suppressReason = suppressionMap.get(suppressKey);

        if (suppressReason) {
          console.log(`[process-email-outbox] Email ${email.id} suppressed: ${suppressReason}`);
          
          await supabase
            .from("email_outbox")
            .update({
              status: "SUPPRESSED",
              suppressed_reason: suppressReason,
              last_attempt_at: now,
            })
            .eq("id", email.id);

          // Log audit event
          await supabase.from("audit_logs").insert({
            organization_id: email.organization_id,
            actor_type: "SYSTEM",
            action: "EMAIL_SUPPRESSED",
            entity_type: "email_outbox",
            entity_id: email.id,
            metadata: { reason: suppressReason, to_domain: email.to_email.split("@")[1] },
          });

          result.suppressed++;
          continue;
        }

        // Mark as sending
        await supabase
          .from("email_outbox")
          .update({ status: "SENDING" })
          .eq("id", email.id);

        // Send via Cloud Run Email Gateway
        const sendResult = await sendViaGateway(email);

        if (sendResult.success) {
          // Success!
          console.log(`[process-email-outbox] Email ${email.id} sent successfully`);

          await supabase
            .from("email_outbox")
            .update({
              status: "SENT",
              sent_at: now,
              last_attempt_at: now,
              provider_message_id: sendResult.provider_message_id || null,
              error: null,
            })
            .eq("id", email.id);

          // Log audit event
          await supabase.from("audit_logs").insert({
            organization_id: email.organization_id,
            actor_type: "SYSTEM",
            action: "EMAIL_SENT",
            entity_type: "email_outbox",
            entity_id: email.id,
            metadata: {
              to_domain: email.to_email.split("@")[1],
              subject_preview: email.subject.substring(0, 50),
              provider_message_id: sendResult.provider_message_id,
            },
          });

          result.sent++;
        } else {
          // Failed - determine if permanent or transient
          const errorMessage = sendResult.error || "Unknown error";
          console.error(`[process-email-outbox] Email ${email.id} failed: ${errorMessage}`);

          const newAttempts = email.attempts + 1;
          const isPermanent = isPermanentError(sendResult.error_code, sendResult.statusCode || 500);
          const isMaxed = newAttempts >= MAX_ATTEMPTS || isPermanent;

          // Calculate next attempt time with backoff (only if not permanent/maxed)
          let nextAttemptAt: string | null = null;
          if (!isMaxed) {
            const backoffIndex = Math.min(newAttempts - 1, BACKOFF_INTERVALS.length - 1);
            const backoffMinutes = BACKOFF_INTERVALS[backoffIndex];
            const nextDate = new Date();
            nextDate.setMinutes(nextDate.getMinutes() + backoffMinutes);
            nextAttemptAt = nextDate.toISOString();
          }

          await supabase
            .from("email_outbox")
            .update({
              status: "FAILED",
              attempts: newAttempts,
              last_attempt_at: now,
              next_attempt_at: nextAttemptAt,
              error: errorMessage,
              failed_permanent: isPermanent || newAttempts >= MAX_ATTEMPTS,
              failure_type: sendResult.error_code || null,
            })
            .eq("id", email.id);

          // Log audit event for final failure
          if (isMaxed) {
            await supabase.from("audit_logs").insert({
              organization_id: email.organization_id,
              actor_type: "SYSTEM",
              action: "EMAIL_FAILED",
              entity_type: "email_outbox",
              entity_id: email.id,
              metadata: {
                to_domain: email.to_email.split("@")[1],
                subject_preview: email.subject.substring(0, 50),
                error: errorMessage,
                attempts: newAttempts,
                final_failure: true,
                permanent: isPermanent,
              },
            });
          }

          result.failed++;
          result.errors.push({ id: email.id, error: errorMessage });
        }
      } catch (sendErr) {
        const errorMessage = sendErr instanceof Error ? sendErr.message : String(sendErr);
        console.error(`[process-email-outbox] Email ${email.id} exception:`, errorMessage);

        const newAttempts = email.attempts + 1;
        const isMaxed = newAttempts >= MAX_ATTEMPTS;

        // Calculate next attempt time with backoff
        let nextAttemptAt: string | null = null;
        if (!isMaxed) {
          const backoffIndex = Math.min(newAttempts - 1, BACKOFF_INTERVALS.length - 1);
          const backoffMinutes = BACKOFF_INTERVALS[backoffIndex];
          const nextDate = new Date();
          nextDate.setMinutes(nextDate.getMinutes() + backoffMinutes);
          nextAttemptAt = nextDate.toISOString();
        }

        await supabase
          .from("email_outbox")
          .update({
            status: "FAILED",
            attempts: newAttempts,
            last_attempt_at: now,
            next_attempt_at: nextAttemptAt,
            error: errorMessage,
            failed_permanent: isMaxed,
          })
          .eq("id", email.id);

        // Log audit event for final failure
        if (isMaxed) {
          await supabase.from("audit_logs").insert({
            organization_id: email.organization_id,
            actor_type: "SYSTEM",
            action: "EMAIL_FAILED",
            entity_type: "email_outbox",
            entity_id: email.id,
            metadata: {
              to_domain: email.to_email.split("@")[1],
              error: errorMessage,
              attempts: newAttempts,
              final_failure: true,
            },
          });
        }

        result.failed++;
        result.errors.push({ id: email.id, error: errorMessage });
      }
    }

    console.log(`[process-email-outbox] Complete: sent=${result.sent}, failed=${result.failed}, suppressed=${result.suppressed}`);

    result.ok = result.errors.length === 0;

    return new Response(
      JSON.stringify(result),
      { 
        status: result.ok ? 200 : 207,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (err) {
    console.error("[process-email-outbox] Unhandled error:", err);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: String(err), gateway_configured: result.gateway_configured }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
