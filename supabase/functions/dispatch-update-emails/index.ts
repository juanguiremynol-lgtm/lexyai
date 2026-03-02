/**
 * Dispatch Update Emails — Enqueues "new/modified movements" notifications into email_outbox.
 * 
 * Runs on a 5-minute cron schedule. Finds unsent alert_instances of types
 * ACTUACION_NEW, ACTUACION_MODIFIED, PUBLICACION_NEW, PUBLICACION_MODIFIED,
 * groups by recipient → work item, builds a structured digest email with
 * Icarus-style tables grouped per work item, and inserts into email_outbox.
 * 
 * Does NOT send directly — uses queue-first architecture via process-email-outbox.
 * 
 * EMAIL TABLE LAYOUT (v2 — structured like Icarus):
 * Each alert row now shows explicit labeled columns:
 *   Detectado el | Despacho | Radicado (linked) | Partes | Fecha | Actuación | Anotación | Fuente
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { createTraceContext, writeTraceRecord } from "../_shared/traceContext.ts";

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
  authority_name: string | null;
  demandantes: string | null;
  demandados: string | null;
  client_name: string | null;
  workflow_type: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const body = await req.json().catch(() => ({}));
  const triggerSource = body?.source || "cron";

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const startedAt = new Date();
  const runMode = body?.run_mode || "CRON";
  const trace = createTraceContext("dispatch-update-emails", runMode, {
    cron_run_id: body?.cron_run_id,
  });
  const result = { processed: 0, emailsEnqueued: 0, errors: [] as string[], recipientsCount: 0, workItemsCount: 0 };

  // Create run log entry
  const { data: runRow } = await supabase
    .from("notification_dispatch_runs")
    .insert({ trigger_source: triggerSource, started_at: startedAt.toISOString() })
    .select("id")
    .single();
  const runId = runRow?.id;

  async function finalizeRun(status: string, alertsFound: number) {
    if (!runId) return;
    const finishedAt = new Date();
    await supabase.from("notification_dispatch_runs").update({
      finished_at: finishedAt.toISOString(),
      status,
      alerts_found: alertsFound,
      alerts_processed: result.processed,
      emails_enqueued: result.emailsEnqueued,
      recipients_count: result.recipientsCount,
      work_items_count: result.workItemsCount,
      errors: result.errors,
      error_summary: result.errors.length > 0 ? result.errors.join('; ') : null,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    }).eq("id", runId);
  }

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
      await finalizeRun("NO_ALERTS", 0);
      return new Response(
        JSON.stringify({ ...result, message: "No alerts to dispatch", run_id: runId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[dispatch-update-emails] Found ${alerts.length} unsent alerts`);

    // Collect unique work item IDs and fetch their details (including parties)
    const workItemIds = [...new Set(alerts.map(a => a.entity_id).filter(Boolean))];
    result.workItemsCount = workItemIds.length;
    const workItemMap = new Map<string, WorkItemInfo>();

    if (workItemIds.length > 0) {
      const { data: workItems } = await supabase
        .from("work_items")
        .select("id, title, radicado, court_name, authority_name, demandantes, demandados, workflow_type, client_id")
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
            authority_name: wi.authority_name || null,
            demandantes: wi.demandantes || null,
            demandados: wi.demandados || null,
            client_name: wi.client_id ? (clientMap.get(wi.client_id) || null) : null,
            workflow_type: wi.workflow_type,
          });
        }
      }
    }

    // ── Enrich alert payloads with full actuación/estado details from DB ──
    const actIds = alerts
      .filter(a => a.alert_type?.startsWith("ACTUACION") && (a.payload as any)?.act_id)
      .map(a => (a.payload as any).act_id);
    const pubIds = alerts
      .filter(a => a.alert_type?.startsWith("PUBLICACION") && (a.payload as any)?.pub_id)
      .map(a => (a.payload as any).pub_id);

    const actDetailMap = new Map<string, any>();
    const pubDetailMap = new Map<string, any>();

    if (actIds.length > 0) {
      const { data: actDetails } = await supabase
        .from("work_item_acts")
        .select("id, act_date, act_type, description, annotation, source, despacho, fecha_registro, inicia_termino, medio")
        .in("id", actIds);
      for (const act of actDetails || []) {
        actDetailMap.set(act.id, act);
      }
    }

    if (pubIds.length > 0) {
      const { data: pubDetails } = await supabase
        .from("work_item_publicaciones")
        .select("id, title, published_at, source, pdf_url, fecha_fijacion, observacion, instancia")
        .in("id", pubIds);
      for (const pub of pubDetails || []) {
        pubDetailMap.set(pub.id, pub);
      }
    }

    // Merge enriched data back into alert payloads
    for (const alert of alerts) {
      const payload = alert.payload as Record<string, unknown> | null;
      if (!payload) continue;

      if (alert.alert_type?.startsWith("ACTUACION") && payload.act_id) {
        const detail = actDetailMap.get(payload.act_id as string);
        if (detail) {
          payload.description = payload.description || detail.description || detail.act_type || "";
          payload.annotation = payload.annotation || detail.annotation || "";
          payload.source = payload.source || detail.source || "";
          payload.act_date = payload.act_date || detail.act_date || detail.fecha_registro || "";
          payload.despacho = payload.despacho || detail.despacho || "";
          payload.inicia_termino = detail.inicia_termino || "";
          payload.medio = detail.medio || "";
        }
      }

      if (alert.alert_type?.startsWith("PUBLICACION") && payload.pub_id) {
        const detail = pubDetailMap.get(payload.pub_id as string);
        if (detail) {
          payload.title = payload.title || detail.title || "";
          payload.description = payload.description || detail.title || "";
          payload.fecha_fijacion = payload.fecha_fijacion || detail.fecha_fijacion || detail.published_at || "";
          payload.observacion = payload.observacion || detail.observacion || "";
          payload.source = payload.source || detail.source || "";
          payload.pdf_url = detail.pdf_url || "";
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
          result.processed += ownerAlerts.length;
          continue;
        }

        // Get org ID
        const orgId = ownerAlerts[0]?.organization_id || null;

        // Count by type
        const actCount = ownerAlerts.filter(a => a.alert_type?.startsWith("ACTUACION")).length;
        const estCount = ownerAlerts.filter(a => a.alert_type?.startsWith("PUBLICACION")).length;

        // Build subject — contextually specific
        const parts: string[] = [];
        if (estCount > 0) parts.push(`${estCount} estado${estCount > 1 ? 's' : ''}`);
        if (actCount > 0) parts.push(`${actCount} actuaci${actCount > 1 ? 'ones' : 'ón'}`);
        
        // If single work item, include radicado in subject
        const uniqueWiIds = [...new Set(ownerAlerts.map(a => a.entity_id))];
        let subject: string;
        if (uniqueWiIds.length === 1) {
          const wi = workItemMap.get(uniqueWiIds[0]);
          const rad = wi?.radicado ? ` en ${wi.radicado}` : '';
          const firstAlert = ownerAlerts[0];
          const firstPayload = firstAlert?.payload as Record<string, unknown> | null;
          const actType = (firstPayload?.description || firstPayload?.title || firstAlert?.message || '').toString().substring(0, 60);
          subject = `⚖️ ${parts.join(' y ')}${rad}${actType ? `: ${actType}` : ''}`;
        } else {
          subject = `⚖️ ${parts.join(' y ')} nueva${ownerAlerts.length > 1 ? 's' : ''} en ${uniqueWiIds.length} procesos`;
        }

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
          dedupe_key: `digest-${ownerId}-${new Date().toISOString().split('T')[0]}-${runId || 'norun'}`,
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
        result.recipientsCount++;
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

    const status = result.errors.length > 0 ? "FAILED" : "SUCCESS";
    await finalizeRun(status, alerts.length);

    const traceStatus = result.errors.length > 0 ? "PARTIAL" : "OK";
    await writeTraceRecord(supabase, trace, traceStatus, {
      work_items_scanned: result.workItemsCount,
      email_stats: {
        pending_alerts: alerts.length,
        emails_sent: result.emailsEnqueued,
        emails_failed: result.errors.length,
      },
      errors: result.errors.length > 0
        ? [{ code: "DISPATCH_ERR", message: result.errors.slice(0, 5).join("; "), count: result.errors.length }]
        : undefined,
    }, startedAt);

    console.log(`[dispatch-update-emails] Done: ${result.emailsEnqueued} emails enqueued, ${result.processed} alerts processed`);
    return new Response(
      JSON.stringify({ ok: true, ...result, run_id: runId, cron_run_id: trace.cron_run_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[dispatch-update-emails] Unhandled error:", err);
    await finalizeRun("FAILED", 0);
    await writeTraceRecord(supabase, trace, "ERROR", {
      errors: [{ code: "FATAL", message: String(err), count: 1 }],
    }, startedAt);
    return new Response(
      JSON.stringify({ ok: false, error: String(err), run_id: runId, cron_run_id: trace.cron_run_id }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── HTML builder (grouped by work item, Icarus-style tables) ──────────────────

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
    const courtName = wi?.authority_name || wi?.court_name || "";
    const demandantes = wi?.demandantes || "";
    const demandados = wi?.demandados || "";
    const partesStr = buildPartesString(demandantes, demandados);
    const viewUrl = `${APP_BASE_URL}/app/work-item/${wiId}`;

    // Sort: newest first
    wiAlerts.sort((a: any, b: any) => new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime());

    // Separate estados and actuaciones
    const estados = wiAlerts.filter((a: any) => a.alert_type?.startsWith("PUBLICACION"));
    const actuaciones = wiAlerts.filter((a: any) => a.alert_type?.startsWith("ACTUACION"));

    let sectionBody = "";

    if (actuaciones.length > 0) {
      sectionBody += buildActuacionesTable(actuaciones, wi, viewUrl);
    }

    if (estados.length > 0) {
      sectionBody += buildEstadosTable(estados, wi, viewUrl);
    }

    // Work item card wrapper
    workItemSections += `
      <div style="margin-bottom:24px;border:1px solid #334155;border-radius:8px;overflow:hidden;">
        <div style="background:#1e293b;padding:14px 16px;border-bottom:1px solid #334155;">
          <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:4px;">
            Proceso judicial
          </div>
          <div style="font-size:13px;color:#94a3b8;">
            ${radicado !== 'Sin radicado'
              ? `<strong style="color:#e2e8f0;">Radicado:</strong> <a href="${viewUrl}" style="color:#60a5fa;text-decoration:underline;">${esc(radicado)}</a> · `
              : ''}
            ${courtName ? `<strong style="color:#e2e8f0;">Despacho:</strong> ${esc(courtName)}` : ''}
            ${partesStr ? `<br/><strong style="color:#e2e8f0;">Partes:</strong> ${esc(partesStr)}` : ''}
          </div>
        </div>
        <div style="padding:12px 0;">
          ${sectionBody}
          <div style="text-align:right;padding:8px 16px 4px;">
            <a href="${viewUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500;">
              Ver en Andromeda →
            </a>
          </div>
        </div>
      </div>
    `;
  }

  const greeting = userName ? `Hola ${esc(userName)},` : "Hola,";
  const summaryParts: string[] = [];
  if (totalEstados > 0) summaryParts.push(`<strong>${totalEstados}</strong> estado${totalEstados > 1 ? 's' : ''}`);
  if (totalActuaciones > 0) summaryParts.push(`<strong>${totalActuaciones}</strong> actuaci${totalActuaciones > 1 ? 'ones' : 'ón'}`);
  const summaryLine = summaryParts.join(' y ');
  const workItemCount = byWorkItem.size;

  return `
    <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:700px;margin:0 auto;background:#ffffff;">
      <div style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%);padding:28px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:#f8fafc;font-size:22px;margin:0;">⚖️ Novedades Judiciales</h1>
        <p style="color:#94a3b8;font-size:14px;margin:8px 0 0;">
          ${summaryLine} en ${workItemCount} proceso${workItemCount > 1 ? 's' : ''}
        </p>
      </div>
      
      <div style="padding:24px;background:#0f172a;">
        <p style="font-size:14px;color:#cbd5e1;margin:0 0 20px;">
          ${greeting} Atenia ha detectado nuevas novedades en los procesos que monitoreas:
        </p>

        ${workItemSections}

        <div style="background:#1e293b;border-radius:8px;padding:16px;margin-top:16px;border:1px solid #334155;">
          <p style="font-size:12px;color:#94a3b8;margin:0;text-align:center;">
            📊 Resumen: ${summaryLine} · Detectadas ${formatCOT(new Date())}
          </p>
        </div>
      </div>

      <div style="padding:16px 24px;border-top:1px solid #334155;text-align:center;background:#0f172a;">
        <p style="font-size:11px;color:#64748b;margin:0;">
          Resumen automático generado por Atenia · <a href="${APP_BASE_URL}" style="color:#6366f1;text-decoration:none;">Andromeda Legal</a><br/>
          Para ajustar las notificaciones, visita Configuración → Alertas en la plataforma.
        </p>
      </div>
    </div>
  `;
}

// ─── Actuaciones table (Icarus-style) ──────────────────

function buildActuacionesTable(items: any[], wi: WorkItemInfo | undefined, viewUrl: string): string {
  const rows = items.map((a: any) => {
    const isModified = a.alert_type?.includes("MODIFIED");
    const payload = a.payload as Record<string, unknown> | null;
    const courtDate = (payload?.act_date || "") as string;
    const description = (payload?.description || payload?.title || a.message || "") as string;
    const annotation = (payload?.annotation || "") as string;
    const source = (payload?.source || payload?.adapter_name || "") as string;
    const detectedAt = a.fired_at ? formatCOT(new Date(a.fired_at)) : "—";
    const typeLabel = isModified ? "Modificada" : "Nueva";
    const typeBg = isModified ? "#92400e" : "#065f46";
    const typeColor = isModified ? "#fbbf24" : "#34d399";

    return `
      <tr>
        <td style="${cellStyle}font-size:11px;color:#94a3b8;white-space:nowrap;">${detectedAt}</td>
        <td style="${cellStyle}font-size:12px;color:#e2e8f0;">${esc(wi?.authority_name || wi?.court_name || "—")}</td>
        <td style="${cellStyle}font-size:12px;">
          <a href="${viewUrl}" style="color:#60a5fa;text-decoration:underline;">${esc(wi?.radicado || "—")}</a>
        </td>
        <td style="${cellStyle}font-size:11px;color:#cbd5e1;max-width:160px;word-wrap:break-word;">${esc(buildPartesString(wi?.demandantes || "", wi?.demandados || "") || "—")}</td>
        <td style="${cellStyle}font-size:12px;color:#e2e8f0;white-space:nowrap;">${courtDate || "—"}</td>
        <td style="${cellStyle}">
          <span style="display:inline-block;background:${typeBg};color:${typeColor};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">${typeLabel}</span>
          <div style="font-size:12px;color:#f1f5f9;margin-top:2px;">${esc(description.substring(0, 150))}</div>
        </td>
        <td style="${cellStyle}font-size:11px;color:#94a3b8;font-style:italic;">${annotation ? esc(annotation.substring(0, 100)) : "—"}</td>
        <td style="${cellStyle}font-size:10px;color:#64748b;white-space:nowrap;">${source || "—"}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="margin:0 0 12px;">
      <div style="font-size:13px;font-weight:600;color:#34d399;padding:8px 16px;background:#064e3b;border-bottom:1px solid #065f46;">
        ⚖️ Actuaciones (${items.length})
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:600px;">
          <tr style="background:#1e293b;">
            <th style="${thStyle}">Detectado el</th>
            <th style="${thStyle}">Despacho</th>
            <th style="${thStyle}">Radicado</th>
            <th style="${thStyle}">Partes</th>
            <th style="${thStyle}">Fecha actuación</th>
            <th style="${thStyle}">Actuación</th>
            <th style="${thStyle}">Anotación</th>
            <th style="${thStyle}">Fuente</th>
          </tr>
          ${rows}
        </table>
      </div>
    </div>
  `;
}

// ─── Estados table (Icarus-style) ──────────────────

function buildEstadosTable(items: any[], wi: WorkItemInfo | undefined, viewUrl: string): string {
  const rows = items.map((a: any) => {
    const isModified = a.alert_type?.includes("MODIFIED");
    const payload = a.payload as Record<string, unknown> | null;
    const courtDate = (payload?.fecha_fijacion || payload?.act_date || "") as string;
    const description = (payload?.description || payload?.title || a.message || "") as string;
    const annotation = (payload?.annotation || payload?.observacion || "") as string;
    const source = (payload?.source || payload?.adapter_name || "") as string;
    const detectedAt = a.fired_at ? formatCOT(new Date(a.fired_at)) : "—";
    const typeLabel = isModified ? "Modificado" : "Nuevo";
    const typeBg = isModified ? "#92400e" : "#1e3a5f";
    const typeColor = isModified ? "#fbbf24" : "#60a5fa";

    return `
      <tr>
        <td style="${cellStyle}font-size:11px;color:#94a3b8;white-space:nowrap;">${detectedAt}</td>
        <td style="${cellStyle}font-size:12px;color:#e2e8f0;">${esc(wi?.authority_name || wi?.court_name || "—")}</td>
        <td style="${cellStyle}font-size:12px;">
          <a href="${viewUrl}" style="color:#60a5fa;text-decoration:underline;">${esc(wi?.radicado || "—")}</a>
        </td>
        <td style="${cellStyle}font-size:11px;color:#cbd5e1;max-width:160px;word-wrap:break-word;">${esc(buildPartesString(wi?.demandantes || "", wi?.demandados || "") || "—")}</td>
        <td style="${cellStyle}font-size:12px;color:#e2e8f0;white-space:nowrap;">${courtDate || "—"}</td>
        <td style="${cellStyle}">
          <span style="display:inline-block;background:${typeBg};color:${typeColor};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">${typeLabel}</span>
          <div style="font-size:12px;color:#f1f5f9;margin-top:2px;">${esc(description.substring(0, 150))}</div>
        </td>
        <td style="${cellStyle}font-size:11px;color:#94a3b8;font-style:italic;">${annotation ? esc(annotation.substring(0, 100)) : "—"}</td>
        <td style="${cellStyle}font-size:10px;color:#64748b;white-space:nowrap;">${source || "—"}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="margin:0 0 12px;">
      <div style="font-size:13px;font-weight:600;color:#60a5fa;padding:8px 16px;background:#172554;border-bottom:1px solid #1e3a5f;">
        📋 Estados (${items.length})
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:600px;">
          <tr style="background:#1e293b;">
            <th style="${thStyle}">Detectado el</th>
            <th style="${thStyle}">Despacho</th>
            <th style="${thStyle}">Radicado</th>
            <th style="${thStyle}">Partes</th>
            <th style="${thStyle}">Fecha estado</th>
            <th style="${thStyle}">Estado</th>
            <th style="${thStyle}">Observación</th>
            <th style="${thStyle}">Fuente</th>
          </tr>
          ${rows}
        </table>
      </div>
    </div>
  `;
}

// ─── Shared styles (inline for email safety) ──────────────────

const thStyle = `padding:8px 10px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #334155;white-space:nowrap;`;
const cellStyle = `padding:8px 10px;border-bottom:1px solid #1e293b;vertical-align:top;`;

// ─── Helpers ──────────────────

function buildPartesString(demandantes: string, demandados: string): string {
  const parts: string[] = [];
  if (demandantes) parts.push(demandantes);
  if (demandados) parts.push(demandados);
  if (parts.length === 2) return `${parts[0]} contra ${parts[1]}`;
  return parts.join('');
}

function formatCOT(date: Date): string {
  try {
    return date.toLocaleString('es-CO', { 
      timeZone: 'America/Bogota', 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true
    }) + ' COT';
  } catch {
    return date.toISOString();
  }
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
