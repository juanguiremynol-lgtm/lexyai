/**
 * Peticion Reminders Edge Function
 * 
 * Scans for peticiones with approaching deadlines and enqueues reminder emails.
 * Does NOT send directly - uses queue-first architecture via process-email-outbox.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { PETICION_ALERT_TYPE } from "../_shared/peticionAlertTypeConstants.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Peticion {
  id: string;
  entity_name: string;
  subject: string;
  radicado: string | null;
  filed_at: string | null;
  deadline_at: string | null;
  prorogation_requested: boolean | null;
  prorogation_deadline_at: string | null;
  phase: string;
  owner_id: string;
  organization_id: string | null;
}

interface Profile {
  id: string;
  full_name: string | null;
  reminder_email: string | null;
  email_reminders_enabled: boolean | null;
}

const generatePeticionReminderHtml = (
  peticion: Peticion,
  profile: Profile,
  daysUntil: number,
  isProrogation: boolean
): string => {
  const baseStyles = `
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    max-width: 600px;
    margin: 0 auto;
    background-color: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
  `;

  let urgencyBadge = "";
  let urgencyColor = "#3b82f6";

  if (daysUntil <= 0) {
    urgencyBadge = "🔴 VENCIDA";
    urgencyColor = "#dc2626";
  } else if (daysUntil <= 3) {
    urgencyBadge = `🟠 ${daysUntil} DÍAS`;
    urgencyColor = "#f97316";
  } else if (daysUntil <= 7) {
    urgencyBadge = `🟡 ${daysUntil} DÍAS`;
    urgencyColor = "#f59e0b";
  } else {
    urgencyBadge = `🟢 ${daysUntil} DÍAS`;
    urgencyColor = "#10b981";
  }

  const greeting = profile.full_name
    ? `Estimado(a) ${profile.full_name},`
    : "Estimado(a) usuario,";

  const deadlineType = isProrogation ? "prórroga" : "respuesta";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 20px; background-color: #f3f4f6;">
      <div style="${baseStyles}">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%); color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">⚖️ ATENIA</h1>
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Recordatorio de Petición</p>
        </div>
        
        <div style="padding: 24px; color: #374151;">
          <div style="display: inline-block; background-color: ${urgencyColor}15; color: ${urgencyColor}; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 16px;">
            ${urgencyBadge}
          </div>
          
          <p style="margin: 0 0 16px; font-size: 15px;">${greeting}</p>
          
          <p style="margin: 0 0 16px; font-size: 15px;">
            ${daysUntil <= 0 
              ? `La fecha límite de ${deadlineType} para la siguiente petición ha vencido:`
              : `Quedan ${daysUntil} día${daysUntil !== 1 ? "s" : ""} para que venza la ${deadlineType} de la siguiente petición:`
            }
          </p>
          
          <div style="background-color: #f8fafc; border-left: 4px solid ${urgencyColor}; padding: 16px; margin: 16px 0; border-radius: 0 8px 8px 0;">
            <h2 style="margin: 0 0 12px; color: #1e3a5f; font-size: 18px;">📋 ${peticion.subject}</h2>
            <p style="margin: 4px 0; font-size: 14px;"><strong>Entidad:</strong> ${peticion.entity_name}</p>
            ${peticion.radicado ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Radicado:</strong> <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px;">${peticion.radicado}</code></p>` : ""}
            ${isProrogation ? `<p style="margin: 4px 0; font-size: 14px; color: #f59e0b;"><strong>⚠️ Prórroga concedida</strong></p>` : ""}
          </div>
          
          ${daysUntil <= 0 ? `
            <div style="background-color: #fef2f2; border: 1px solid #fecaca; padding: 12px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0; font-size: 14px; color: #dc2626;">
                <strong>⚠️ Importante:</strong> La entidad no ha respondido en el plazo legal. Puede considerar interponer una acción de tutela por vulneración al Derecho de Petición.
              </p>
            </div>
          ` : ""}
          
          <p style="margin: 16px 0 0; font-size: 14px; color: #6b7280;">
            Por favor, revise el estado de esta petición y tome las acciones necesarias.
          </p>
        </div>
        
        <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0;">© ${new Date().getFullYear()} ATENIA - Asistente Legal</p>
          <p style="margin: 4px 0 0;">Este correo fue enviado automáticamente. No responda a este mensaje.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

const handler = async (req: Request): Promise<Response> => {
  console.log("[peticion-reminders] Function invoked");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Fetch peticiones that need reminders (not in RESPUESTA phase)
    const { data: peticiones, error: peticionesError } = await supabase
      .from("peticiones")
      .select("*, organization_id")
      .neq("phase", "RESPUESTA")
      .or(`deadline_at.gte.${today.toISOString()},prorogation_deadline_at.gte.${today.toISOString()}`);

    if (peticionesError) {
      throw peticionesError;
    }

    console.log(`[peticion-reminders] Found ${peticiones?.length || 0} peticiones to check`);

    const emailsQueued: string[] = [];
    const alertsCreated: string[] = [];
    const errors: string[] = [];

    // Define reminder days (7, 5, 3, 1, 0 days before deadline)
    const reminderDays = [7, 5, 3, 1, 0];

    for (const peticion of peticiones || []) {
      const isProrogation = peticion.prorogation_requested && peticion.prorogation_deadline_at;
      const deadlineStr = isProrogation ? peticion.prorogation_deadline_at : peticion.deadline_at;
      
      if (!deadlineStr) continue;

      const deadline = new Date(deadlineStr);
      const daysUntil = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Check if we should send a reminder
      const shouldSendReminder = reminderDays.includes(daysUntil);
      if (!shouldSendReminder) continue;

      // Get organization_id from peticion or profile
      let organizationId = peticion.organization_id;
      
      if (!organizationId) {
        // Try to get org from owner's profile
        const { data: ownerProfile } = await supabase
          .from("profiles")
          .select("organization_id")
          .eq("id", peticion.owner_id)
          .single();
        organizationId = ownerProfile?.organization_id;
      }

      if (!organizationId) {
        console.error(`[peticion-reminders] No organization_id for peticion ${peticion.id}, skipping`);
        continue;
      }

      // Generate dedupe key for this specific day
      const dedupeKey = `peticion:${peticion.id}:${daysUntil}:${isProrogation ? 'proro' : 'deadline'}`;

      // Check if we already sent/queued for this day
      const { data: existing } = await supabase
        .from("email_outbox")
        .select("id")
        .eq("dedupe_key", dedupeKey)
        .in("status", ["PENDING", "SENDING", "SENT"])
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`[peticion-reminders] Reminder already queued/sent for peticion ${peticion.id}, days=${daysUntil}`);
        continue;
      }

      // Also check peticion_alerts table for legacy deduplication
      const { data: existingAlerts } = await supabase
        .from("peticion_alerts")
        .select("id")
        .eq("peticion_id", peticion.id)
        .gte("created_at", today.toISOString())
        .limit(1);

      if (existingAlerts && existingAlerts.length > 0) {
        continue; // Already processed today via legacy system
      }

      console.log(`[peticion-reminders] Processing peticion ${peticion.id} - ${peticion.subject}, ${daysUntil} days until deadline`);

      // Get the owner's profile
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, reminder_email, email_reminders_enabled")
        .eq("id", peticion.owner_id)
        .single();

      if (profileError || !profile) {
        console.error(`[peticion-reminders] Could not find profile for owner ${peticion.owner_id}`);
        continue;
      }

      // Determine severity for in-app alert
      let severity: "INFO" | "WARN" | "CRITICAL" = "INFO";
      let alertType: string = PETICION_ALERT_TYPE.DEADLINE_WARNING;
      
      if (daysUntil <= 0) {
        severity = "CRITICAL";
        alertType = PETICION_ALERT_TYPE.DEADLINE_CRITICAL;
      } else if (daysUntil <= 3) {
        severity = "WARN";
      }

      // Create in-app alert
      const { error: alertError } = await supabase.from("peticion_alerts").insert({
        owner_id: peticion.owner_id,
        peticion_id: peticion.id,
        alert_type: isProrogation
          ? PETICION_ALERT_TYPE.PROROGATION_DEADLINE
          : alertType,
        severity,
        message: daysUntil <= 0
          ? `Petición VENCIDA: ${peticion.subject} - ${peticion.entity_name}`
          : `Petición vence en ${daysUntil} día${daysUntil !== 1 ? "s" : ""}: ${peticion.subject}`,
      });

      if (!alertError) {
        alertsCreated.push(peticion.id);
      }

      // Check if email reminders are enabled
      if (profile.email_reminders_enabled === false) {
        console.log(`[peticion-reminders] Email reminders disabled for user ${profile.id}`);
        continue;
      }

      // Get the user's email
      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(peticion.owner_id);
      
      if (authError || !authUser.user?.email) {
        console.error(`[peticion-reminders] Could not find email for user ${peticion.owner_id}`);
        continue;
      }

      const recipientEmail = profile.reminder_email || authUser.user.email;

      // Generate email HTML
      const html = generatePeticionReminderHtml(peticion, profile, daysUntil, isProrogation);
      const subject = daysUntil <= 0
        ? `[URGENTE] Petición VENCIDA: ${peticion.subject}`
        : `[ATENIA] Petición vence en ${daysUntil} día${daysUntil !== 1 ? "s" : ""}: ${peticion.subject}`;

      try {
        // Enqueue email into email_outbox (do NOT send directly)
        const { data: outboxRow, error: insertError } = await supabase
          .from("email_outbox")
          .insert({
            organization_id: organizationId,
            to_email: recipientEmail,
            subject: subject,
            html: html,
            status: "PENDING",
            next_attempt_at: new Date().toISOString(),
            attempts: 0,
            trigger_event: isProrogation ? "PETICION_PROROGATION_REMINDER" : "PETICION_DEADLINE_REMINDER",
            trigger_reason: daysUntil <= 0
              ? `Petición vencida: ${peticion.subject}`
              : `Petición vence en ${daysUntil} día(s): ${peticion.subject}`,
            dedupe_key: dedupeKey,
            metadata: {
              peticion_id: peticion.id,
              days_until: daysUntil,
              is_prorogation: isProrogation,
              entity_name: peticion.entity_name,
            },
          })
          .select("id")
          .single();

        if (insertError) {
          // Handle duplicate constraint
          if (insertError.code === "23505") {
            console.log(`[peticion-reminders] Duplicate insert for peticion ${peticion.id}`);
            continue;
          }
          throw insertError;
        }

        console.log(`[peticion-reminders] Email queued for peticion ${peticion.id}: ${outboxRow.id}`);
        emailsQueued.push(peticion.id);

        // Update peticion_alert sent_at
        await supabase
          .from("peticion_alerts")
          .update({ sent_at: new Date().toISOString() })
          .eq("peticion_id", peticion.id)
          .is("sent_at", null);

      } catch (emailError) {
        const errorMsg = emailError instanceof Error ? emailError.message : "Unknown error";
        console.error(`[peticion-reminders] Failed to queue email for peticion ${peticion.id}:`, errorMsg);
        errors.push(`${peticion.id}: ${errorMsg}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        alertsCreated: alertsCreated.length,
        emailsQueued: emailsQueued.length,
        peticionIds: emailsQueued,
        errors: errors.length > 0 ? errors : undefined,
        message: "Emails enqueued for batch processing via process-email-outbox",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[peticion-reminders] Error:", errorMessage);
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
