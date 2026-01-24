import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OrgToCheck {
  id: string;
  name: string;
  estados_staleness_alerts_enabled: boolean;
  estados_staleness_email_enabled: boolean;
  estados_staleness_threshold_days: number;
  last_ingestion_at: string | null;
  admin_email: string | null;
  admin_name: string | null;
}

/**
 * Check if a date is a business day (Mon-Fri)
 */
function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Calculate business days between two dates
 */
function businessDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  current.setDate(current.getDate() + 1);
  
  while (current <= end) {
    if (isBusinessDay(current)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}

/**
 * Generate staleness alert email HTML
 */
function generateAlertEmailHtml(orgName: string, daysSinceIngestion: number, adminName?: string): string {
  const greeting = adminName ? `Estimado(a) ${adminName},` : "Estimado(a) usuario,";
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 20px; background-color: #f3f4f6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%); color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">⚖️ ATENIA</h1>
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Sistema de Gestión Legal</p>
        </div>
        
        <div style="padding: 24px; color: #374151;">
          <div style="display: inline-block; background-color: #fef3c7; color: #92400e; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 16px;">
            ⚠️ ACTUALIZACIÓN PENDIENTE
          </div>
          
          <p style="margin: 0 0 16px; font-size: 15px;">${greeting}</p>
          
          <div style="background-color: #fef9c3; border-left: 4px solid #eab308; padding: 16px; margin: 16px 0; border-radius: 0 8px 8px 0;">
            <h2 style="margin: 0 0 8px; color: #854d0e; font-size: 18px;">Estados sin actualizar</h2>
            <p style="margin: 4px 0; font-size: 14px; color: #a16207;">
              Han pasado <strong>${daysSinceIngestion} días hábiles</strong> sin una importación de Estados de ICARUS.
            </p>
          </div>
          
          <p style="margin: 16px 0; font-size: 14px; line-height: 1.6;">
            Los términos judiciales y las actuaciones pueden estar desactualizados. 
            Le recomendamos subir el archivo de Estados de ICARUS lo antes posible para mantener 
            el seguimiento de sus procesos al día.
          </p>
          
          <div style="text-align: center; margin: 24px 0;">
            <a href="https://docket-ace-pro.lovable.app/settings?tab=estados" 
               style="display: inline-block; background-color: #1e3a5f; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
              Subir Estados de ICARUS
            </a>
          </div>
          
          <p style="margin: 16px 0 0; font-size: 14px; color: #6b7280;">
            Este es un recordatorio automático. Puede desactivar estas notificaciones en Configuración → Recordatorios.
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
}

const handler = async (req: Request): Promise<Response> => {
  console.log("check-estados-staleness function invoked");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    let orgsChecked = 0;
    let alertsCreated = 0;
    let emailsSent = 0;
    let alertsResolved = 0;

    // Get all organizations with their staleness settings and last ingestion
    const { data: organizations, error: orgError } = await supabase
      .from("organizations")
      .select(`
        id,
        name,
        estados_staleness_alerts_enabled,
        estados_staleness_email_enabled,
        estados_staleness_threshold_days
      `)
      .eq("estados_staleness_alerts_enabled", true);

    if (orgError) {
      throw new Error(`Error fetching organizations: ${orgError.message}`);
    }

    console.log(`Found ${organizations?.length || 0} organizations with staleness alerts enabled`);

    for (const org of organizations || []) {
      orgsChecked++;
      const thresholdDays = org.estados_staleness_threshold_days || 3;

      // Get last successful ingestion for this org
      const { data: lastIngestion } = await supabase
        .from("ingestion_runs")
        .select("created_at")
        .eq("organization_id", org.id)
        .eq("status", "SUCCESS")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastIngestionAt = lastIngestion?.created_at ? new Date(lastIngestion.created_at) : null;
      const daysSinceIngestion = lastIngestionAt 
        ? businessDaysBetween(lastIngestionAt, now) 
        : 999; // Very high if never ingested

      const isStale = daysSinceIngestion >= thresholdDays;

      // Get existing alert for this org
      const { data: existingAlert } = await supabase
        .from("estados_staleness_alerts")
        .select("*")
        .eq("organization_id", org.id)
        .maybeSingle();

      if (isStale) {
        // Create or update alert
        if (!existingAlert || existingAlert.status !== "ACTIVE") {
          // Create new alert
          const { error: insertError } = await supabase
            .from("estados_staleness_alerts")
            .upsert({
              organization_id: org.id,
              status: "ACTIVE",
              last_ingestion_at: lastIngestionAt?.toISOString() || null,
              alert_created_at: now.toISOString(),
              emails_sent_count: 0,
            }, {
              onConflict: "organization_id",
            });

          if (insertError) {
            console.error(`Error creating alert for org ${org.id}:`, insertError);
          } else {
            alertsCreated++;
            console.log(`Created staleness alert for org ${org.id}`);
          }
        }

        // Check if we should send email (once per day max)
        if (org.estados_staleness_email_enabled && RESEND_API_KEY) {
          const lastEmailSent = existingAlert?.last_email_sent_at 
            ? new Date(existingAlert.last_email_sent_at) 
            : null;
          
          const shouldSendEmail = !lastEmailSent || 
            (now.getTime() - lastEmailSent.getTime()) > 24 * 60 * 60 * 1000; // 24 hours

          if (shouldSendEmail) {
            // Get admin user email for this org
            const { data: adminProfile } = await supabase
              .from("profiles")
              .select("id, full_name, reminder_email")
              .eq("organization_id", org.id)
              .not("reminder_email", "is", null)
              .limit(1)
              .maybeSingle();

            if (adminProfile?.reminder_email) {
              try {
                const emailHtml = generateAlertEmailHtml(
                  org.name || "su organización",
                  daysSinceIngestion,
                  adminProfile.full_name || undefined
                );

                const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "ATENIA <onboarding@resend.dev>";

                const resendResponse = await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${RESEND_API_KEY}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    from: fromEmail,
                    to: [adminProfile.reminder_email],
                    subject: `[ATENIA] ⚠️ Estados sin actualizar - ${daysSinceIngestion} días hábiles`,
                    html: emailHtml,
                  }),
                });

                if (resendResponse.ok) {
                  emailsSent++;
                  console.log(`Sent staleness email to ${adminProfile.reminder_email}`);

                  // Update last email sent
                  await supabase
                    .from("estados_staleness_alerts")
                    .update({
                      last_email_sent_at: now.toISOString(),
                      emails_sent_count: (existingAlert?.emails_sent_count || 0) + 1,
                    })
                    .eq("organization_id", org.id);
                } else {
                  const errorText = await resendResponse.text();
                  console.error(`Failed to send email: ${errorText}`);
                }
              } catch (emailError) {
                console.error(`Error sending email:`, emailError);
              }
            }
          }
        }
      } else {
        // Not stale - resolve any active alert
        if (existingAlert && existingAlert.status === "ACTIVE") {
          const { error: resolveError } = await supabase
            .from("estados_staleness_alerts")
            .update({
              status: "RESOLVED",
              resolved_at: now.toISOString(),
            })
            .eq("id", existingAlert.id);

          if (resolveError) {
            console.error(`Error resolving alert for org ${org.id}:`, resolveError);
          } else {
            alertsResolved++;
            console.log(`Resolved staleness alert for org ${org.id}`);
          }
        }
      }
    }

    // Log audit trail
    const { error: auditError } = await supabase
      .from("crawler_runs")
      .insert({
        run_type: "STALENESS_CHECK",
        status: "COMPLETED",
        started_at: now.toISOString(),
        completed_at: new Date().toISOString(),
        metadata: {
          orgs_checked: orgsChecked,
          alerts_created: alertsCreated,
          alerts_resolved: alertsResolved,
          emails_sent: emailsSent,
        },
      });

    if (auditError) {
      console.warn("Failed to create audit trail:", auditError);
    }

    const result = {
      success: true,
      timestamp: now.toISOString(),
      orgsChecked,
      alertsCreated,
      alertsResolved,
      emailsSent,
    };

    console.log("Staleness check completed:", result);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in check-estados-staleness:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
