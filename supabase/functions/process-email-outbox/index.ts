/**
 * Email Outbox Worker Edge Function
 * 
 * Processes pending emails with retry/backoff logic and bounce suppression.
 * Designed to be called on a schedule (cron) or manually.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
}

interface ProcessResult {
  ok: boolean;
  processed: number;
  sent: number;
  failed: number;
  suppressed: number;
  errors: Array<{ id: string; error: string }>;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!resendApiKey) {
    console.error("[process-email-outbox] RESEND_API_KEY not configured");
    return new Response(
      JSON.stringify({ ok: false, code: "MISSING_SECRET", message: "Email provider not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const resend = new Resend(resendApiKey);

  const result: ProcessResult = {
    ok: true,
    processed: 0,
    sent: 0,
    failed: 0,
    suppressed: 0,
    errors: [],
  };

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
            metadata: { reason: suppressReason, to_email: email.to_email },
          });

          result.suppressed++;
          continue;
        }

        // Mark as sending
        await supabase
          .from("email_outbox")
          .update({ status: "SENDING" })
          .eq("id", email.id);

        // Send via Resend
        const { data: sendResult, error: sendError } = await resend.emails.send({
          from: "ATENIA <noreply@atenia.app>",
          to: [email.to_email],
          subject: email.subject,
          html: email.html,
        });

        if (sendError) {
          throw sendError;
        }

        // Success!
        console.log(`[process-email-outbox] Email ${email.id} sent successfully`);

        await supabase
          .from("email_outbox")
          .update({
            status: "SENT",
            sent_at: now,
            last_attempt_at: now,
            provider_message_id: sendResult?.id || null,
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
            to_email: email.to_email,
            subject: email.subject,
            provider_message_id: sendResult?.id,
          },
        });

        result.sent++;
      } catch (sendErr) {
        const errorMessage = sendErr instanceof Error ? sendErr.message : String(sendErr);
        console.error(`[process-email-outbox] Email ${email.id} failed:`, errorMessage);

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
              to_email: email.to_email,
              subject: email.subject,
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
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
