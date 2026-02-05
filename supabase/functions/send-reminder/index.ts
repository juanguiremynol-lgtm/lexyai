/**
 * Send Reminder Edge Function
 * 
 * Enqueues a reminder email into email_outbox for batch processing.
 * Does NOT send directly - uses queue-first architecture via process-email-outbox.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ReminderRequest {
  type: "sla_warning" | "deadline" | "process_update" | "test";
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  filingId?: string;
  processId?: string;
  workItemId?: string;
  radicado?: string;
  dueDate?: string;
  daysRemaining?: number;
  message?: string;
  organizationId?: string;
}

const generateEmailHtml = (data: ReminderRequest): string => {
  const baseStyles = `
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    max-width: 600px;
    margin: 0 auto;
    background-color: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  `;

  const headerStyles = `
    background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%);
    color: white;
    padding: 24px;
    text-align: center;
  `;

  const contentStyles = `
    padding: 24px;
    color: #374151;
  `;

  const footerStyles = `
    background-color: #f9fafb;
    padding: 16px 24px;
    text-align: center;
    font-size: 12px;
    color: #6b7280;
    border-top: 1px solid #e5e7eb;
  `;

  let urgencyBadge = "";
  let urgencyColor = "#3b82f6"; // blue default

  if (data.daysRemaining !== undefined) {
    if (data.daysRemaining <= 1) {
      urgencyBadge = "🔴 URGENTE";
      urgencyColor = "#dc2626";
    } else if (data.daysRemaining <= 3) {
      urgencyBadge = "🟡 PRÓXIMO";
      urgencyColor = "#f59e0b";
    } else {
      urgencyBadge = "🟢 RECORDATORIO";
      urgencyColor = "#10b981";
    }
  }

  const greeting = data.recipientName 
    ? `Estimado(a) ${data.recipientName},` 
    : "Estimado(a) usuario,";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
      <div style="${baseStyles}">
        <div style="${headerStyles}">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">⚖️ ATENIA</h1>
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Sistema de Gestión Legal</p>
        </div>
        
        <div style="${contentStyles}">
          ${urgencyBadge ? `
            <div style="display: inline-block; background-color: ${urgencyColor}15; color: ${urgencyColor}; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 16px;">
              ${urgencyBadge}
            </div>
          ` : ""}
          
          <p style="margin: 0 0 16px; font-size: 15px;">${greeting}</p>
          
          <div style="background-color: #f8fafc; border-left: 4px solid ${urgencyColor}; padding: 16px; margin: 16px 0; border-radius: 0 8px 8px 0;">
            <h2 style="margin: 0 0 8px; color: #1e3a5f; font-size: 18px;">${data.subject}</h2>
            ${data.radicado ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Radicado:</strong> <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px;">${data.radicado}</code></p>` : ""}
            ${data.dueDate ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Fecha límite:</strong> ${data.dueDate}</p>` : ""}
            ${data.daysRemaining !== undefined ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Días restantes:</strong> ${data.daysRemaining} día(s) hábil(es)</p>` : ""}
          </div>
          
          ${data.message ? `<p style="margin: 16px 0; font-size: 14px; line-height: 1.6;">${data.message}</p>` : ""}
          
          <p style="margin: 16px 0 0; font-size: 14px; color: #6b7280;">
            Este es un recordatorio automático generado por ATENIA. Por favor, tome las acciones necesarias.
          </p>
        </div>
        
        <div style="${footerStyles}">
          <p style="margin: 0;">© ${new Date().getFullYear()} ATENIA - Asistente Legal</p>
          <p style="margin: 4px 0 0;">Este correo fue enviado automáticamente. No responda a este mensaje.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

const handler = async (req: Request): Promise<Response> => {
  console.log("[send-reminder] Function invoked");

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const data: ReminderRequest = await req.json();
    console.log("[send-reminder] Request type:", data.type);

    if (!data.recipientEmail) {
      throw new Error("recipientEmail is required");
    }

    if (!data.subject) {
      throw new Error("subject is required");
    }

    // Determine organization_id
    let organizationId = data.organizationId;

    // If not provided, try to resolve from work item
    if (!organizationId && data.workItemId) {
      const { data: workItem } = await supabase
        .from("work_items")
        .select("organization_id")
        .eq("id", data.workItemId)
        .single();
      organizationId = workItem?.organization_id;
    }

    // If still not found, try from filing or process (legacy)
    if (!organizationId && data.filingId) {
      const { data: filing } = await supabase
        .from("filings")
        .select("organization_id")
        .eq("id", data.filingId)
        .single();
      organizationId = filing?.organization_id;
    }

    if (!organizationId) {
      throw new Error("Could not determine organization_id for email");
    }

    const html = generateEmailHtml(data);
    const fullSubject = `[ATENIA] ${data.subject}`;

    // Generate dedupe key to prevent duplicate emails for same event
    const dedupeKey = data.workItemId 
      ? `reminder:${data.type}:${data.workItemId}:${data.dueDate || "nodate"}`
      : `reminder:${data.type}:${data.recipientEmail}:${data.subject}`;

    // Check for existing pending email with same dedupe key
    const { data: existing } = await supabase
      .from("email_outbox")
      .select("id")
      .eq("dedupe_key", dedupeKey)
      .in("status", ["PENDING", "SENDING"])
      .limit(1);

    if (existing && existing.length > 0) {
      console.log("[send-reminder] Duplicate detected, skipping:", dedupeKey);
      return new Response(
        JSON.stringify({ 
          success: true, 
          queued: false, 
          reason: "duplicate", 
          existing_id: existing[0].id 
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Enqueue email into email_outbox (do NOT send directly)
    const { data: outboxRow, error: insertError } = await supabase
      .from("email_outbox")
      .insert({
        organization_id: organizationId,
        to_email: data.recipientEmail,
        subject: fullSubject,
        html: html,
        status: "PENDING",
        next_attempt_at: new Date().toISOString(),
        attempts: 0,
        trigger_event: `REMINDER_${data.type.toUpperCase()}`,
        trigger_reason: data.message || `${data.type} reminder`,
        work_item_id: data.workItemId || null,
        dedupe_key: dedupeKey,
        metadata: {
          reminder_type: data.type,
          radicado: data.radicado,
          due_date: data.dueDate,
          days_remaining: data.daysRemaining,
          filing_id: data.filingId,
          process_id: data.processId,
        },
      })
      .select("id")
      .single();

    if (insertError) {
      // Check for unique constraint violation (23505)
      if (insertError.code === "23505") {
        console.log("[send-reminder] Duplicate insert detected via constraint:", dedupeKey);
        return new Response(
          JSON.stringify({ success: true, queued: false, reason: "duplicate" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }
      throw insertError;
    }

    console.log("[send-reminder] Email queued successfully:", outboxRow.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        queued: true, 
        email_outbox_id: outboxRow.id,
        message: "Email queued for delivery via batch processor"
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[send-reminder] Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

Deno.serve(handler);
