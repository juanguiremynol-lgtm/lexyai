/**
 * Dispatch Update Emails — Enqueues "new/modified movements" notifications into email_outbox.
 * 
 * Runs on a 5-minute cron schedule. Finds unsent alert_instances of types
 * ACTUACION_NEW, ACTUACION_MODIFIED, PUBLICACION_NEW, PUBLICACION_MODIFIED,
 * groups by recipient → work item, builds a structured digest email with
 * tables grouped per work item, and inserts into email_outbox.
 * 
 * Does NOT send directly — uses queue-first architecture via process-email-outbox.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_BASE_URL = "https://lexyai.lovable.app";

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

const TYPE_ICONS: Record<string, string> = {
  ACTUACION_NEW: "🆕",
  ACTUACION_MODIFIED: "✏️",
  PUBLICACION_NEW: "📋",
  PUBLICACION_MODIFIED: "✏️",
};

interface WorkItemInfo {
  id: string;
  title: string | null;
  radicado: string | null;
  court_name: string | null;
  client_name: string | null;
  workflow_type: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const result = { processed: 0, emailsEnqueued: 0, errors: [] as string[] };

  try {
    // Fetch unsent alert instances from last 48h (extended window for reliability)
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: alerts, error: alertErr } = await supabase
      .from("alert_instances")
      .select(`
        id, owner_id, entity_id, entity_type, alert_type,
        title, message, severity, payload, fired_at,
        is_notified_email, organization_id
      `)
      .in("alert_type", ALERT_TYPES)
      .eq("is_notified_email", false)
      .gte("fired_at", cutoff)
      .order("fired_at", { ascending: false })
      .limit(500);

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

    // Collect unique work item IDs and fetch their details
    const workItemIds = [...new Set(alerts.map(a => a.entity_id).filter(Boolean))];
    const workItemMap = new Map<string, WorkItemInfo>();

    if (workItemIds.length > 0) {
      const { data: workItems } = await supabase
        .from("work_items")
        .select("id, title, radicado, court_name, workflow_type, client_id")
        .in("id", workItemIds);

      if (workItems) {
        // Fetch client names
        const clientIds = [...new Set(workItems.map(wi => wi.client_id).filter(Boolean))];
        const clientMap = new Map<string, string>();
        if (clientIds.length > 0) {
          const { data: clients } = await supabase
            .from("clients")
            .select("id, name")
            .in("id", clientIds);
          for (const c of clients || []) {
            clientMap.set(c.id, c.name);
          }
        }

        for (const wi of workItems) {
          workItemMap.set(wi.id, {
            id: wi.id,
            title: wi.title,
            radicado: wi.radicado,
            court_name: wi.court_name,
            client_name: wi.client_id ? (clientMap.get(wi.client_id) || null) : null,
            workflow_type: wi.workflow_type,
          });
        }
      }
    }

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
        // Get user email — prefer alert_email from profile, fallback to auth email
        const [{ data: profile }, { data: userData }] = await Promise.all([
          supabase.from("profiles").select("alert_email, email, full_name").eq("id", ownerId).maybeSingle(),
          supabase.auth.admin.getUserById(ownerId),
        ]);

        const email = profile?.alert_email || profile?.email || userData?.user?.email;
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
          // Still mark as notified to avoid re-checking
          const alertIds = ownerAlerts.map(a => a.id);
          await supabase
            .from("alert_instances")
            .update({ is_notified_email: true, notified_email_at: new Date().toISOString() })
            .in("id", alertIds);
          continue;
        }

        // Get org ID
        const orgId = ownerAlerts[0]?.organization_id || null;

        // Count by type
        const actCount = ownerAlerts.filter(a => a.alert_type?.startsWith("ACTUACION")).length;
        const estCount = ownerAlerts.filter(a => a.alert_type?.startsWith("PUBLICACION")).length;

        // Build subject
        const parts: string[] = [];
        if (estCount > 0) parts.push(`${estCount} estado${estCount > 1 ? 's' : ''}`);
        if (actCount > 0) parts.push(`${actCount} actuaci${actCount > 1 ? 'ones' : 'ón'}`);
        const subject = `⚖️ ${parts.join(' y ')} nueva${ownerAlerts.length > 1 ? 's' : ''} detectada${ownerAlerts.length > 1 ? 's' : ''}`;

        const html = buildDigestHtml(ownerAlerts, workItemMap, profile?.full_name || null);

        // Enqueue to email_outbox
        const { error: insertErr } = await supabase.from("email_outbox").insert({
          organization_id: orgId || "00000000-0000-0000-0000-000000000000",
          to_email: email,
          subject,
          html,
          status: "PENDING",
          next_attempt_at: new Date().toISOString(),
          trigger_reason: "MOVEMENT_UPDATE_DIGEST",
          trigger_event: "dispatch-update-emails",
          dedupe_key: `digest-${ownerId}-${new Date().toISOString().split('T')[0]}`,
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
        console.log(`[dispatch-update-emails] Enqueued digest for ${email}: ${ownerAlerts.length} alerts`);
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

// ─── HTML builder (grouped by work item) ──────────────────

function buildDigestHtml(
  alerts: any[],
  workItemMap: Map<string, WorkItemInfo>,
  userName: string | null,
): string {
  // Group alerts by work item
  const byWorkItem = new Map<string, any[]>();
  for (const alert of alerts) {
    const wiId = alert.entity_id || "unknown";
    const list = byWorkItem.get(wiId) || [];
    list.push(alert);
    byWorkItem.set(wiId, list);
  }

  // Count totals
  const totalEstados = alerts.filter(a => a.alert_type?.startsWith("PUBLICACION")).length;
  const totalActuaciones = alerts.filter(a => a.alert_type?.startsWith("ACTUACION")).length;

  let workItemSections = "";
  for (const [wiId, wiAlerts] of byWorkItem) {
    const wi = workItemMap.get(wiId);
    const radicado = wi?.radicado || "Sin radicado";
    const caseTitle = wi?.title || "Proceso judicial";
    const courtName = wi?.court_name || "";
    const clientName = wi?.client_name || "";
    const viewUrl = `${APP_BASE_URL}/app/work-item/${wiId}`;

    // Sort: newest first
    wiAlerts.sort((a: any, b: any) => new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime());

    // Separate estados and actuaciones
    const estados = wiAlerts.filter((a: any) => a.alert_type?.startsWith("PUBLICACION"));
    const actuaciones = wiAlerts.filter((a: any) => a.alert_type?.startsWith("ACTUACION"));

    const renderAlertRows = (items: any[]) => items.map((a: any) => {
      const typeLabel = TYPE_LABELS[a.alert_type] || a.alert_type;
      const icon = TYPE_ICONS[a.alert_type] || "📌";
      const isModified = a.alert_type?.includes("MODIFIED");
      const payload = a.payload as Record<string, unknown> | null;
      const courtDate = (payload?.act_date || payload?.fecha_fijacion || "") as string;
      const description = (payload?.description || payload?.title || a.message || "") as string;
      const annotation = (payload?.annotation || "") as string;
      const source = (payload?.source || payload?.adapter_name || "") as string;

      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:${isModified ? '#d97706' : '#059669'};font-weight:600;white-space:nowrap;vertical-align:top;">
            ${icon} ${typeLabel}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">
            ${courtDate || '—'}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;vertical-align:top;">
            <div style="font-size:13px;color:#1f2937;margin-bottom:2px;">${escapeHtml(description.substring(0, 200))}</div>
            ${annotation ? `<div style="font-size:11px;color:#9ca3af;font-style:italic;">${escapeHtml(annotation.substring(0, 120))}</div>` : ''}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:11px;color:#9ca3af;white-space:nowrap;vertical-align:top;">
            ${source || '—'}
          </td>
        </tr>
      `;
    }).join('');

    const tableHeader = `
      <tr style="background:#f9fafb;">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Tipo</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Fecha</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Descripción</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Fuente</th>
      </tr>
    `;

    let sectionBody = "";

    if (estados.length > 0) {
      sectionBody += `
        <div style="margin-bottom:8px;">
          <div style="font-size:13px;font-weight:600;color:#1e40af;padding:8px 12px;background:#eff6ff;border-radius:4px;">
            📋 Estados (${estados.length})
          </div>
          <table style="width:100%;border-collapse:collapse;margin-top:4px;">
            ${tableHeader}
            ${renderAlertRows(estados)}
          </table>
        </div>
      `;
    }

    if (actuaciones.length > 0) {
      sectionBody += `
        <div style="margin-bottom:8px;">
          <div style="font-size:13px;font-weight:600;color:#065f46;padding:8px 12px;background:#ecfdf5;border-radius:4px;">
            ⚖️ Actuaciones (${actuaciones.length})
          </div>
          <table style="width:100%;border-collapse:collapse;margin-top:4px;">
            ${tableHeader}
            ${renderAlertRows(actuaciones)}
          </table>
        </div>
      `;
    }

    workItemSections += `
      <div style="margin-bottom:24px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="background:#f8fafc;padding:14px 16px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:15px;font-weight:600;color:#0f172a;margin-bottom:4px;">
            ${escapeHtml(caseTitle)}
          </div>
          <div style="font-size:13px;color:#64748b;">
            ${radicado !== 'Sin radicado' ? `<strong>Radicado:</strong> ${escapeHtml(radicado)} · ` : ''}
            ${courtName ? `<strong>Juzgado:</strong> ${escapeHtml(courtName)} · ` : ''}
            ${clientName ? `<strong>Cliente:</strong> ${escapeHtml(clientName)}` : ''}
          </div>
        </div>
        <div style="padding:12px 16px;">
          ${sectionBody}
          <div style="text-align:right;margin-top:8px;">
            <a href="${viewUrl}" style="display:inline-block;background:#1e293b;color:#f8fafc;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500;">
              Ver en Andromeda →
            </a>
          </div>
        </div>
      </div>
    `;
  }

  const greeting = userName ? `Hola ${escapeHtml(userName)},` : "Hola,";
  const summaryParts: string[] = [];
  if (totalEstados > 0) summaryParts.push(`<strong>${totalEstados}</strong> estado${totalEstados > 1 ? 's' : ''}`);
  if (totalActuaciones > 0) summaryParts.push(`<strong>${totalActuaciones}</strong> actuaci${totalActuaciones > 1 ? 'ones' : 'ón'}`);
  const summaryLine = summaryParts.join(' y ');
  const workItemCount = byWorkItem.size;

  return `
    <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
      <div style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%);padding:28px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:#f8fafc;font-size:22px;margin:0;">⚖️ Novedades Judiciales</h1>
        <p style="color:#94a3b8;font-size:14px;margin:8px 0 0;">
          ${summaryLine} en ${workItemCount} proceso${workItemCount > 1 ? 's' : ''}
        </p>
      </div>
      
      <div style="padding:24px;">
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">
          ${greeting} Atenia ha detectado nuevas novedades en los procesos que monitoreas:
        </p>

        ${workItemSections}

        <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin-top:16px;">
          <p style="font-size:12px;color:#64748b;margin:0;text-align:center;">
            📊 Resumen: ${summaryLine} · Detectadas ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' })} COT
          </p>
        </div>
      </div>

      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;text-align:center;">
        <p style="font-size:11px;color:#9ca3af;margin:0;">
          Resumen automático generado por Atenia · <a href="${APP_BASE_URL}" style="color:#6366f1;text-decoration:none;">Andromeda Legal</a><br/>
          Para ajustar las notificaciones, visita Configuración → Alertas en la plataforma.
        </p>
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
