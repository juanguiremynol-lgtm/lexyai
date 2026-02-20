/**
 * Dispatch Update Emails — Enqueues "new/modified movements" notifications into email_outbox.
 * 
 * Runs on a 5-minute schedule. Finds unsent alert_instances of types
 * ACTUACION_NEW, ACTUACION_MODIFIED, PUBLICACION_NEW, PUBLICACION_MODIFIED,
 * groups by recipient, builds a compact digest email, and inserts into email_outbox.
 * 
 * Does NOT send directly — uses queue-first architecture via process-email-outbox.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALERT_TYPES = [
  "ACTUACION_NEW", "ACTUACION_MODIFIED",
  "PUBLICACION_NEW", "PUBLICACION_MODIFIED",
];

const TYPE_LABELS: Record<string, string> = {
  ACTUACION_NEW: "Nueva actuación",
  ACTUACION_MODIFIED: "Actuación modificada",
  PUBLICACION_NEW: "Nuevo estado",
  PUBLICACION_MODIFIED: "Estado modificado",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const result = { processed: 0, emailsEnqueued: 0, errors: [] as string[] };

  try {
    // Fetch unsent alert instances from last 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: alerts, error: alertErr } = await supabase
      .from("alert_instances")
      .select(`
        id, owner_id, entity_id, entity_type, alert_type,
        title, message, severity, payload, fired_at,
        is_notified_email
      `)
      .in("alert_type", ALERT_TYPES)
      .eq("is_notified_email", false)
      .gte("fired_at", cutoff)
      .order("fired_at", { ascending: false })
      .limit(200);

    if (alertErr) {
      console.error("[dispatch-update-emails] Alert fetch error:", alertErr);
      throw alertErr;
    }

    if (!alerts || alerts.length === 0) {
      console.log("[dispatch-update-emails] No unsent alerts found");
      return new Response(
        JSON.stringify({ ...result, message: "No alerts to dispatch" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[dispatch-update-emails] Found ${alerts.length} unsent alerts`);

    // Group alerts by owner_id (recipient)
    const byOwner = new Map<string, typeof alerts>();
    for (const alert of alerts) {
      const list = byOwner.get(alert.owner_id) || [];
      list.push(alert);
      byOwner.set(alert.owner_id, list);
    }

    // For each owner, get their email and enqueue a digest
    for (const [ownerId, ownerAlerts] of byOwner) {
      try {
        // Get user email from auth
        const { data: userData } = await supabase.auth.admin.getUserById(ownerId);
        const email = userData?.user?.email;
        if (!email) {
          console.warn(`[dispatch-update-emails] No email for user ${ownerId}`);
          continue;
        }

        // Check email preferences
        const { data: prefs } = await supabase
          .from("alert_preferences")
          .select("preferences")
          .eq("user_id", ownerId)
          .maybeSingle();

        const prefsObj = prefs?.preferences as Record<string, unknown> | null;
        if (prefsObj?.email_enabled === false) {
          console.log(`[dispatch-update-emails] Email disabled for user ${ownerId}`);
          continue;
        }

        // Get org ID from first alert's work item
        const firstEntityId = ownerAlerts[0]?.entity_id;
        let orgId: string | null = null;
        if (firstEntityId) {
          const { data: wi } = await supabase
            .from("work_items")
            .select("organization_id")
            .eq("id", firstEntityId)
            .maybeSingle();
          orgId = wi?.organization_id || null;
        }

        // Build email content
        const subject = ownerAlerts.length === 1
          ? `${TYPE_LABELS[ownerAlerts[0].alert_type || ""] || "Novedad"}: ${ownerAlerts[0].title}`
          : `${ownerAlerts.length} novedades judiciales detectadas`;

        const html = buildDigestHtml(ownerAlerts);

        // Enqueue to email_outbox
        const { error: insertErr } = await supabase.from("email_outbox").insert({
          organization_id: orgId || "00000000-0000-0000-0000-000000000000",
          to_email: email,
          subject,
          html,
          status: "PENDING",
          next_attempt_at: new Date().toISOString(),
          trigger_reason: "MOVEMENT_UPDATE_DIGEST",
          triggered_by: "dispatch-update-emails",
        });

        if (insertErr) {
          console.error(`[dispatch-update-emails] Insert error for ${ownerId}:`, insertErr);
          result.errors.push(`Insert failed for ${ownerId}: ${insertErr.message}`);
          continue;
        }

        // Mark alerts as notified
        const alertIds = ownerAlerts.map((a) => a.id);
        await supabase
          .from("alert_instances")
          .update({
            is_notified_email: true,
            notified_email_at: new Date().toISOString(),
          })
          .in("id", alertIds);

        result.emailsEnqueued++;
        result.processed += ownerAlerts.length;
      } catch (ownerErr) {
        console.error(`[dispatch-update-emails] Error for owner ${ownerId}:`, ownerErr);
        result.errors.push(`Owner ${ownerId}: ${String(ownerErr)}`);
      }
    }

    // Trigger process-email-outbox to send immediately
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/process-email-outbox`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ triggered_by: "dispatch-update-emails" }),
      });
    } catch (triggerErr) {
      console.warn("[dispatch-update-emails] Could not trigger process-email-outbox:", triggerErr);
    }

    console.log(`[dispatch-update-emails] Done: ${result.emailsEnqueued} emails enqueued, ${result.processed} alerts processed`);
    return new Response(
      JSON.stringify({ ok: true, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[dispatch-update-emails] Unhandled error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── HTML builder ───────────────────────────────────────────

function buildDigestHtml(alerts: any[]): string {
  const rows = alerts.map((a) => {
    const typeLabel = TYPE_LABELS[a.alert_type] || a.alert_type;
    const isModified = a.alert_type?.includes("MODIFIED");
    const payload = a.payload as Record<string, unknown> | null;
    const courtDate = (payload?.act_date || payload?.fecha_fijacion || "") as string;
    const description = (payload?.description || payload?.title || a.message || "") as string;
    const annotation = (payload?.annotation || "") as string;

    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 8px; vertical-align: top;">
          <div style="font-size: 12px; color: ${isModified ? '#d97706' : '#059669'}; font-weight: 600; margin-bottom: 4px;">
            ${isModified ? '✏️' : '🆕'} ${typeLabel}
          </div>
          <div style="font-size: 14px; font-weight: 500; color: #1f2937; margin-bottom: 4px;">
            ${escapeHtml(a.title || '')}
          </div>
          <div style="font-size: 13px; color: #4b5563; margin-bottom: 4px;">
            ${escapeHtml(description.substring(0, 200))}
          </div>
          ${annotation ? `<div style="font-size: 12px; color: #6b7280; font-style: italic;">${escapeHtml(annotation.substring(0, 150))}</div>` : ''}
          <div style="font-size: 11px; color: #9ca3af; margin-top: 6px;">
            ${courtDate ? `📅 Fecha juzgado: ${courtDate}` : ''}
            · Detectada: ${new Date(a.fired_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #f8fafc; font-size: 20px; margin: 0;">⚖️ Novedades Judiciales</h1>
        <p style="color: #94a3b8; font-size: 14px; margin: 8px 0 0;">
          ${alerts.length} novedad${alerts.length > 1 ? 'es' : ''} detectada${alerts.length > 1 ? 's' : ''} por Atenia
        </p>
      </div>
      <div style="background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse;">
          ${rows}
        </table>
        <div style="padding: 16px; text-align: center;">
          <p style="font-size: 12px; color: #9ca3af; margin: 0;">
            Este es un resumen automático generado por Atenia · Andromeda Legal
          </p>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
