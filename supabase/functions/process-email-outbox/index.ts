/**
 * Email Outbox Worker Edge Function
 * 
 * Processes pending emails with retry/backoff logic and bounce suppression.
 * PROVIDER-AGNOSTIC: Resolves the active email provider from email_provider_config
 * and platform_settings at runtime. Supports Resend, SendGrid, Mailgun, AWS SES, SMTP.
 * Falls back to Cloud Run Gateway if configured.
 * 
 * Designed to be called on a schedule (external scheduler) or manually.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Legacy Gateway fallback
const EMAIL_GATEWAY_BASE_URL = Deno.env.get("EMAIL_GATEWAY_BASE_URL");
const EMAIL_GATEWAY_API_KEY = Deno.env.get("EMAIL_GATEWAY_API_KEY");

// Retry backoff intervals in minutes
const BACKOFF_INTERVALS = [1, 5, 15, 60, 360, 1440, 2880, 4320];
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
  provider_used: string;
}

interface SendResult {
  success: boolean;
  provider_message_id?: string;
  error?: string;
  error_code?: string;
  statusCode?: number;
}

// ═══════════════════════════════════════════
// PROVIDER RESOLUTION
// ═══════════════════════════════════════════

interface ResolvedProvider {
  type: string;
  config: Record<string, string>;
  fromAddress: string;
}

async function resolveActiveProvider(supabase: any): Promise<ResolvedProvider | null> {
  // 1. Get active provider type from platform_settings
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("email_provider_type, email_provider_configured")
    .eq("id", "singleton")
    .maybeSingle();

  if (!settings?.email_provider_type || !settings.email_provider_configured) {
    return null;
  }

  const providerType = settings.email_provider_type;

  // 2. Fetch all config values for this provider
  const providerKeyMap: Record<string, string[]> = {
    resend: ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET"],
    sendgrid: ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"],
    aws_ses: ["AWS_SES_ACCESS_KEY_ID", "AWS_SES_SECRET_ACCESS_KEY", "AWS_SES_REGION", "AWS_SES_FROM_EMAIL"],
    mailgun: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_FROM_EMAIL"],
    smtp: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM_EMAIL", "SMTP_TLS"],
  };

  const keys = providerKeyMap[providerType];
  if (!keys) return null;

  const { data: configs } = await supabase
    .from("email_provider_config")
    .select("config_key, config_value")
    .in("config_key", keys);

  const config: Record<string, string> = {};
  for (const c of configs || []) {
    config[c.config_key] = c.config_value;
  }

  // Determine from address
  const fromKey = keys.find(k => k.endsWith("_FROM_EMAIL"));
  const fromAddress = fromKey ? config[fromKey] : "ATENIA <noreply@andromeda.legal>";

  return { type: providerType, config, fromAddress };
}

// ═══════════════════════════════════════════
// SEND IMPLEMENTATIONS PER PROVIDER
// ═══════════════════════════════════════════

async function sendViaResend(email: EmailOutboxRow, config: Record<string, string>, fromAddress: string): Promise<SendResult> {
  const apiKey = config["RESEND_API_KEY"];
  if (!apiKey) return { success: false, error: "RESEND_API_KEY not configured", error_code: "PROVIDER_NOT_CONFIGURED" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [email.to_email],
        subject: email.subject,
        html: email.html,
        tags: [
          { name: "email_outbox_id", value: email.id },
          ...(email.trigger_event ? [{ name: "trigger", value: email.trigger_event }] : []),
        ],
      }),
    });

    if (response.ok) {
      const result = await response.json();
      return { success: true, provider_message_id: result.id, statusCode: response.status };
    } else {
      const errorBody = await response.json().catch(() => ({ message: "Unknown error" }));
      return {
        success: false,
        error: errorBody.message || `Resend error: ${response.status}`,
        error_code: errorBody.name || undefined,
        statusCode: response.status,
      };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Resend connection failed", error_code: "NETWORK_ERROR" };
  }
}

async function sendViaSendGrid(email: EmailOutboxRow, config: Record<string, string>, fromAddress: string): Promise<SendResult> {
  const apiKey = config["SENDGRID_API_KEY"];
  if (!apiKey) return { success: false, error: "SENDGRID_API_KEY not configured", error_code: "PROVIDER_NOT_CONFIGURED" };

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: email.to_email }] }],
        from: { email: fromAddress.includes("<") ? fromAddress.match(/<(.+)>/)?.[1] || fromAddress : fromAddress, name: fromAddress.includes("<") ? fromAddress.split("<")[0].trim() : undefined },
        subject: email.subject,
        content: [{ type: "text/html", value: email.html }],
        custom_args: { email_outbox_id: email.id },
      }),
    });

    if (response.status === 202) {
      const messageId = response.headers.get("x-message-id") || undefined;
      return { success: true, provider_message_id: messageId, statusCode: response.status };
    } else {
      const errorBody = await response.text();
      return { success: false, error: `SendGrid error: ${response.status} - ${errorBody}`, statusCode: response.status };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "SendGrid connection failed", error_code: "NETWORK_ERROR" };
  }
}

async function sendViaMailgun(email: EmailOutboxRow, config: Record<string, string>, fromAddress: string): Promise<SendResult> {
  const apiKey = config["MAILGUN_API_KEY"];
  const domain = config["MAILGUN_DOMAIN"];
  if (!apiKey || !domain) return { success: false, error: "Mailgun credentials not configured", error_code: "PROVIDER_NOT_CONFIGURED" };

  try {
    const formData = new FormData();
    formData.append("from", fromAddress);
    formData.append("to", email.to_email);
    formData.append("subject", email.subject);
    formData.append("html", email.html);
    formData.append("o:tag", email.id);

    const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: "POST",
      headers: { "Authorization": `Basic ${btoa(`api:${apiKey}`)}` },
      body: formData,
    });

    if (response.ok) {
      const result = await response.json();
      return { success: true, provider_message_id: result.id, statusCode: response.status };
    } else {
      const errorBody = await response.text();
      return { success: false, error: `Mailgun error: ${response.status} - ${errorBody}`, statusCode: response.status };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Mailgun connection failed", error_code: "NETWORK_ERROR" };
  }
}

async function sendViaGateway(email: EmailOutboxRow, fromAddress: string): Promise<SendResult> {
  if (!EMAIL_GATEWAY_BASE_URL || !EMAIL_GATEWAY_API_KEY) {
    return { success: false, error: "Email gateway not configured", error_code: "GATEWAY_NOT_CONFIGURED" };
  }

  try {
    const response = await fetch(`${EMAIL_GATEWAY_BASE_URL}/send`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${EMAIL_GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organization_id: email.organization_id,
        to: email.to_email,
        subject: email.subject,
        html: email.html,
        from: fromAddress,
        metadata: {
          email_outbox_id: email.id,
          work_item_id: email.work_item_id || null,
          trigger_event: email.trigger_event || null,
          alert_instance_id: email.alert_instance_id || null,
          ...(email.metadata || {}),
        },
      }),
    });

    if (response.ok) {
      const result = await response.json();
      return { success: true, provider_message_id: result.id, statusCode: response.status };
    } else {
      const errorResult = await response.json();
      return { success: false, error: errorResult.error || `Gateway error: ${response.status}`, error_code: errorResult.error_code, statusCode: response.status };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Gateway connection failed", error_code: "NETWORK_ERROR" };
  }
}

// Route email to the correct provider
async function sendEmail(email: EmailOutboxRow, provider: ResolvedProvider | null): Promise<SendResult> {
  if (!provider) {
    // Fallback to legacy gateway
    return sendViaGateway(email, Deno.env.get("EMAIL_FROM_ADDRESS") || "ATENIA <noreply@placeholder.com>");
  }

  switch (provider.type) {
    case "resend":
      return sendViaResend(email, provider.config, provider.fromAddress);
    case "sendgrid":
      return sendViaSendGrid(email, provider.config, provider.fromAddress);
    case "mailgun":
      return sendViaMailgun(email, provider.config, provider.fromAddress);
    default:
      // Unknown provider — try gateway fallback
      return sendViaGateway(email, provider.fromAddress);
  }
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  return `${local.length > 2 ? local[0] + "***" : "***"}@${domain}`;
}

function isPermanentError(errorCode: string | undefined, statusCode: number): boolean {
  if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) return true;
  const permanentCodes = ["invalid_recipient", "blocked", "unsubscribed", "complained", "invalid_email"];
  return permanentCodes.includes(errorCode || "");
}

// ═══════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════

Deno.serve(async (req) => {
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
    provider_used: "none",
  };

  try {
    // Resolve active provider from DB config (set via Email Provider Wizard)
    const provider = await resolveActiveProvider(supabase);
    result.provider_used = provider?.type || (EMAIL_GATEWAY_BASE_URL ? "gateway_fallback" : "none");

    if (!provider && !EMAIL_GATEWAY_BASE_URL) {
      console.warn("[process-email-outbox] No email provider configured. Run the Email Provider Wizard to activate one.");
    }

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

    console.log(`[process-email-outbox] Processing ${emails.length} emails via ${result.provider_used}`);

    // Fetch all suppressions for the organizations involved
    const orgIds = [...new Set(emails.map((e: EmailOutboxRow) => e.organization_id))];
    const { data: suppressions } = await supabase
      .from("email_suppressions")
      .select("email, organization_id, reason")
      .in("organization_id", orgIds);

    const suppressionMap = new Map<string, string>();
    (suppressions || []).forEach((s: any) => {
      suppressionMap.set(`${s.organization_id}:${s.email.toLowerCase()}`, s.reason);
    });

    // Process each email
    for (const email of emails as EmailOutboxRow[]) {
      result.processed++;

      console.log(`[process-email-outbox] Processing email ${email.id} to ${maskEmail(email.to_email)}`);

      try {
        // Check for suppression
        const suppressKey = `${email.organization_id}:${email.to_email.toLowerCase()}`;
        const suppressReason = suppressionMap.get(suppressKey);

        if (suppressReason) {
          console.log(`[process-email-outbox] Email ${email.id} suppressed: ${suppressReason}`);
          
          await supabase
            .from("email_outbox")
            .update({ status: "SUPPRESSED", suppressed_reason: suppressReason, last_attempt_at: now })
            .eq("id", email.id);

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

        // Send via resolved provider
        const sendResult = await sendEmail(email, provider);

        if (sendResult.success) {
          console.log(`[process-email-outbox] Email ${email.id} sent successfully via ${result.provider_used}`);

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
              provider: result.provider_used,
            },
          });

          result.sent++;
        } else {
          const errorMessage = sendResult.error || "Unknown error";
          console.error(`[process-email-outbox] Email ${email.id} failed: ${errorMessage}`);

          const newAttempts = email.attempts + 1;
          const isPermanent = isPermanentError(sendResult.error_code, sendResult.statusCode || 500);
          const isMaxed = newAttempts >= MAX_ATTEMPTS || isPermanent;

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
                provider: result.provider_used,
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

        if (isMaxed) {
          await supabase.from("audit_logs").insert({
            organization_id: email.organization_id,
            actor_type: "SYSTEM",
            action: "EMAIL_FAILED",
            entity_type: "email_outbox",
            entity_id: email.id,
            metadata: { to_domain: email.to_email.split("@")[1], error: errorMessage, attempts: newAttempts, final_failure: true },
          });
        }

        result.failed++;
        result.errors.push({ id: email.id, error: errorMessage });
      }
    }

    console.log(`[process-email-outbox] Complete: provider=${result.provider_used}, sent=${result.sent}, failed=${result.failed}, suppressed=${result.suppressed}`);

    result.ok = result.errors.length === 0;

    return new Response(
      JSON.stringify(result),
      { status: result.ok ? 200 : 207, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[process-email-outbox] Unhandled error:", err);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: String(err), provider_used: result.provider_used }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
