/**
 * Hearing Reminders Edge Function
 * 
 * Scans for upcoming hearings and enqueues reminder emails into email_outbox.
 * Does NOT send directly - uses queue-first architecture via process-email-outbox.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Hearing {
  id: string;
  title: string;
  scheduled_at: string;
  location: string | null;
  is_virtual: boolean | null;
  virtual_link: string | null;
  notes: string | null;
  reminder_sent: boolean | null;
  work_item_id: string | null;
  owner_id: string;
  organization_id: string | null;
}

interface Profile {
  id: string;
  full_name: string | null;
  reminder_email: string | null;
  email_reminders_enabled: boolean | null;
}

interface WorkItem {
  id: string;
  radicado: string | null;
  title: string | null;
  workflow_type: string | null;
  demandantes: string | null;
  demandados: string | null;
  client_id: string | null;
  organization_id: string | null;
  clients: { name: string }[] | null;
}

const generateHearingReminderHtml = (
  hearing: Hearing,
  workItem: WorkItem | null,
  profile: Profile,
  daysUntil: number
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

  if (daysUntil === 0) {
    urgencyBadge = "🔴 HOY";
    urgencyColor = "#dc2626";
  } else if (daysUntil === 1) {
    urgencyBadge = "🟠 MAÑANA";
    urgencyColor = "#f97316";
  } else if (daysUntil <= 3) {
    urgencyBadge = `🟡 EN ${daysUntil} DÍAS`;
    urgencyColor = "#f59e0b";
  } else {
    urgencyBadge = `🟢 EN ${daysUntil} DÍAS`;
    urgencyColor = "#10b981";
  }

  const scheduledDate = new Date(hearing.scheduled_at);
  const formattedDate = scheduledDate.toLocaleDateString("es-CO", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = scheduledDate.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const greeting = profile.full_name
    ? `Estimado(a) ${profile.full_name},`
    : "Estimado(a) usuario,";

  const locationInfo = hearing.is_virtual
    ? hearing.virtual_link
      ? `<p style="margin: 4px 0; font-size: 14px;"><strong>🖥️ Virtual:</strong> <a href="${hearing.virtual_link}" style="color: #2563eb;">${hearing.virtual_link}</a></p>`
      : `<p style="margin: 4px 0; font-size: 14px;"><strong>🖥️ Virtual</strong></p>`
    : hearing.location
    ? `<p style="margin: 4px 0; font-size: 14px;"><strong>📍 Ubicación:</strong> ${hearing.location}</p>`
    : "";

  const clientName = Array.isArray(workItem?.clients) && workItem.clients.length > 0
    ? workItem.clients[0].name
    : null;

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
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Recordatorio de Audiencia</p>
        </div>
        
        <div style="padding: 24px; color: #374151;">
          <div style="display: inline-block; background-color: ${urgencyColor}15; color: ${urgencyColor}; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 16px;">
            ${urgencyBadge}
          </div>
          
          <p style="margin: 0 0 16px; font-size: 15px;">${greeting}</p>
          
          <p style="margin: 0 0 16px; font-size: 15px;">
            Le recordamos que tiene programada la siguiente audiencia:
          </p>
          
          <div style="background-color: #f8fafc; border-left: 4px solid ${urgencyColor}; padding: 16px; margin: 16px 0; border-radius: 0 8px 8px 0;">
            <h2 style="margin: 0 0 12px; color: #1e3a5f; font-size: 18px;">📅 ${hearing.title}</h2>
            <p style="margin: 4px 0; font-size: 14px;"><strong>Fecha:</strong> ${formattedDate}</p>
            <p style="margin: 4px 0; font-size: 14px;"><strong>Hora:</strong> ${formattedTime}</p>
            ${locationInfo}
            ${workItem?.workflow_type ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Tipo:</strong> ${workItem.workflow_type}</p>` : ""}
            ${workItem?.radicado ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Radicado:</strong> <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px;">${workItem.radicado}</code></p>` : ""}
            ${clientName ? `<p style="margin: 4px 0; font-size: 14px;"><strong>Cliente:</strong> ${clientName}</p>` : ""}
          </div>
          
          ${hearing.notes ? `<p style="margin: 16px 0; font-size: 14px; line-height: 1.6;"><strong>Notas:</strong> ${hearing.notes}</p>` : ""}
          
          <p style="margin: 16px 0 0; font-size: 14px; color: #6b7280;">
            Por favor, asegúrese de preparar todos los documentos necesarios y confirmar su asistencia.
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
  console.log("[hearing-reminders] Function invoked");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const reminderDays = [0, 1, 3, 7]; // Same day, 1 day, 3 days, 7 days before

    // Fetch hearings that need reminders
    const { data: hearings, error: hearingsError } = await supabase
      .from("hearings")
      .select(`
        id, title, scheduled_at, location, is_virtual, virtual_link, notes, 
        reminder_sent, work_item_id, owner_id, organization_id
      `)
      .eq("reminder_sent", false)
      .gte("scheduled_at", today.toISOString())
      .order("scheduled_at", { ascending: true });

    if (hearingsError) {
      throw hearingsError;
    }

    console.log(`[hearing-reminders] Found ${hearings?.length || 0} upcoming hearings to check`);

    const emailsQueued: string[] = [];
    const alertsCreated: string[] = [];
    const errors: string[] = [];

    for (const hearing of hearings || []) {
      const hearingDate = new Date(hearing.scheduled_at);
      const daysUntil = Math.ceil((hearingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Check if we should send a reminder for this hearing
      const shouldSendReminder = reminderDays.includes(daysUntil);
      
      if (!shouldSendReminder) {
        continue;
      }

      console.log(`[hearing-reminders] Processing hearing ${hearing.id} - ${hearing.title}, ${daysUntil} days until`);

      // Fetch linked work item if available
      let workItem: WorkItem | null = null;
      let organizationId = hearing.organization_id;
      
      if (hearing.work_item_id) {
        const { data: workItemData, error: workItemError } = await supabase
          .from("work_items")
          .select(`
            id, radicado, title, workflow_type, demandantes, demandados, client_id, organization_id,
            clients(name)
          `)
          .eq("id", hearing.work_item_id)
          .single();
        
        if (!workItemError && workItemData) {
          workItem = workItemData as WorkItem;
          // Prefer organization_id from work_item
          organizationId = workItemData.organization_id || organizationId;
        }
      }

      if (!organizationId) {
        console.error(`[hearing-reminders] No organization_id for hearing ${hearing.id}, skipping`);
        continue;
      }

      // Get the owner's profile
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, reminder_email, email_reminders_enabled")
        .eq("id", hearing.owner_id)
        .single();

      if (profileError || !profile) {
        console.error(`[hearing-reminders] Could not find profile for owner ${hearing.owner_id}`);
        continue;
      }

      // Check if email reminders are enabled
      if (profile.email_reminders_enabled === false) {
        console.log(`[hearing-reminders] Email reminders disabled for user ${profile.id}`);
        continue;
      }

      // Get the user's email
      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(hearing.owner_id);
      
      if (authError || !authUser.user?.email) {
        console.error(`[hearing-reminders] Could not find email for user ${hearing.owner_id}`);
        continue;
      }

      const recipientEmail = profile.reminder_email || authUser.user.email;

      // Generate email HTML
      const html = generateHearingReminderHtml(hearing, workItem, profile, daysUntil);
      const subject = `[ATENIA] Recordatorio: ${hearing.title} - ${daysUntil === 0 ? "HOY" : daysUntil === 1 ? "MAÑANA" : `En ${daysUntil} días`}`;

      // Generate dedupe key for this specific reminder
      const dedupeKey = `hearing:${hearing.id}:${daysUntil}`;

      try {
        // Check for existing pending email with same dedupe key
        const { data: existing } = await supabase
          .from("email_outbox")
          .select("id")
          .eq("dedupe_key", dedupeKey)
          .in("status", ["PENDING", "SENDING", "SENT"])
          .limit(1);

        if (existing && existing.length > 0) {
          console.log(`[hearing-reminders] Reminder already queued/sent for hearing ${hearing.id}, days=${daysUntil}`);
          continue;
        }

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
            trigger_event: "HEARING_REMINDER",
            trigger_reason: `Audiencia en ${daysUntil} día(s): ${hearing.title}`,
            work_item_id: hearing.work_item_id || null,
            dedupe_key: dedupeKey,
            metadata: {
              hearing_id: hearing.id,
              days_until: daysUntil,
              scheduled_at: hearing.scheduled_at,
            },
          })
          .select("id")
          .single();

        if (insertError) {
          // Handle duplicate constraint
          if (insertError.code === "23505") {
            console.log(`[hearing-reminders] Duplicate insert for hearing ${hearing.id}`);
            continue;
          }
          throw insertError;
        }

        console.log(`[hearing-reminders] Email queued for hearing ${hearing.id}: ${outboxRow.id}`);
        emailsQueued.push(hearing.id);

        // Mark reminder as sent only if it's the day of (to allow multiple reminders for future days)
        if (daysUntil === 0) {
          await supabase
            .from("hearings")
            .update({ reminder_sent: true })
            .eq("id", hearing.id);
        }

        // Create an in-app alert for the hearing reminder
        const { error: alertError } = await supabase.from("alerts").insert({
          owner_id: hearing.owner_id,
          organization_id: organizationId,
          severity: daysUntil === 0 ? "CRITICAL" : daysUntil <= 1 ? "WARN" : "INFO",
          message: `Recordatorio: ${hearing.title} ${daysUntil === 0 ? "es HOY" : daysUntil === 1 ? "es MAÑANA" : `en ${daysUntil} días`}${workItem?.radicado ? ` - Radicado: ${workItem.radicado}` : ""}`,
          is_read: false,
        });

        if (!alertError) {
          alertsCreated.push(hearing.id);
        }

      } catch (emailError) {
        const errorMsg = emailError instanceof Error ? emailError.message : "Unknown error";
        console.error(`[hearing-reminders] Failed to queue email for hearing ${hearing.id}:`, errorMsg);
        errors.push(`${hearing.id}: ${errorMsg}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        emailsQueued: emailsQueued.length,
        alertsCreated: alertsCreated.length,
        hearingIds: emailsQueued,
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
    console.error("[hearing-reminders] Error:", errorMessage);
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
