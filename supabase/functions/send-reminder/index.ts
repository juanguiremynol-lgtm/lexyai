import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

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
  radicado?: string;
  dueDate?: string;
  daysRemaining?: number;
  message?: string;
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
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">⚖️ Lex Docket</h1>
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
            Este es un recordatorio automático generado por Lex Docket. Por favor, tome las acciones necesarias.
          </p>
        </div>
        
        <div style="${footerStyles}">
          <p style="margin: 0;">© ${new Date().getFullYear()} Lex Docket - Asistente Legal</p>
          <p style="margin: 4px 0 0;">Este correo fue enviado automáticamente. No responda a este mensaje.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

const handler = async (req: Request): Promise<Response> => {
  console.log("send-reminder function invoked");

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const data: ReminderRequest = await req.json();
    console.log("Reminder request:", JSON.stringify(data));

    if (!data.recipientEmail) {
      throw new Error("recipientEmail is required");
    }

    if (!data.subject) {
      throw new Error("subject is required");
    }

    const html = generateEmailHtml(data);

    // Use onboarding@resend.dev for testing, or configure your domain
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Lex Docket <onboarding@resend.dev>";

    // Use fetch to call Resend API directly
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [data.recipientEmail],
        subject: `[Lex Docket] ${data.subject}`,
        html,
      }),
    });

    const emailResponse = await resendResponse.json();

    if (!resendResponse.ok) {
      throw new Error(emailResponse.message || "Failed to send email");
    }

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, emailResponse }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in send-reminder function:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
