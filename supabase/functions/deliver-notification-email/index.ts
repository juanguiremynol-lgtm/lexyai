/**
 * deliver-notification-email — Sends generated notification documents
 * (Notificación Personal / por Aviso) as PDF-style HTML attachments
 * to the lawyer's litigation email via Resend.
 *
 * Body: { document_ids: string[] }
 * Requires authenticated lawyer.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Branding (same logic as send-signing-email) ─────────

function resolveBranding(
  supabaseUrl: string,
  org: { custom_branding_enabled?: boolean; custom_logo_path?: string; custom_firm_name?: string; name?: string } | null,
  profile: { custom_branding_enabled?: boolean; custom_logo_path?: string; custom_firm_name?: string; full_name?: string } | null
): { logo_url: string | null; firm_name: string } {
  if (org?.custom_branding_enabled && org?.custom_logo_path) {
    return {
      logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${org.custom_logo_path}`,
      firm_name: org.custom_firm_name || org.name || "Andromeda Legal",
    };
  }
  if (profile?.custom_branding_enabled && profile?.custom_logo_path) {
    return {
      logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${profile.custom_logo_path}`,
      firm_name: profile.custom_firm_name || profile.full_name || "Andromeda Legal",
    };
  }
  return { logo_url: null, firm_name: "Andromeda Legal" };
}

function buildLogoHeader(branding: { logo_url: string | null; firm_name: string }): string {
  if (branding.logo_url) {
    return `<div style="text-align:center;padding:24px 0;border-bottom:2px solid #1a1a2e;">
      <img src="${branding.logo_url}" alt="${branding.firm_name}" style="max-height:50px;max-width:200px;" />
      <p style="color:#666;margin:8px 0 0;font-size:13px;">${branding.firm_name}</p>
    </div>`;
  }
  return `<div style="text-align:center;padding:24px 0;border-bottom:2px solid #1a1a2e;">
    <h1 style="color:#1a1a2e;font-size:24px;margin:0;">${branding.firm_name.toUpperCase()}</h1>
    <p style="color:#666;margin:4px 0 0;">Plataforma de Gestión Legal</p>
  </div>`;
}

// ─── HTML-to-text (simple) ───────────────────────────────

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Build PDF-like HTML attachment ──────────────────────

function buildPdfHtml(contentHtml: string, branding: { logo_url: string | null; firm_name: string }, docId: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = now.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Documento Legal</title></head>
<body style="font-family:Georgia,serif;font-size:12pt;line-height:1.6;color:#000;margin:0;padding:40px 60px;">
  ${branding.logo_url ? `<div style="text-align:center;margin-bottom:24px;"><img src="${branding.logo_url}" alt="${branding.firm_name}" style="max-height:60px;max-width:200px;"/></div>` : ""}
  ${contentHtml}
  <hr style="border:none;border-top:1px solid #ccc;margin:48px 0 12px;"/>
  <p style="font-size:10pt;color:#666;text-align:center;">
    Generado a través de ${branding.firm_name !== "Andromeda Legal" ? `${branding.firm_name} / ` : ""}Andromeda Legal<br/>
    Fecha de generación: ${dateStr} ${timeStr} COT<br/>
    ID: ${docId}
  </p>
</body>
</html>`;
}

// ─── Main handler ────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "RESEND_API_KEY not configured" }, 500);

    // Authenticate
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const documentIds: string[] = body.document_ids;
    if (!documentIds?.length) return json({ error: "document_ids is required" }, 400);

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Fetch documents
    const { data: docs, error: docsErr } = await adminClient
      .from("generated_documents")
      .select("id, title, document_type, content_html, variables, status, work_item_id, organization_id, created_by")
      .in("id", documentIds);

    if (docsErr || !docs?.length) return json({ error: "Documents not found" }, 404);

    // Validate all are notifications created by this user
    const NOTIFICATION_TYPES = ["notificacion_personal", "notificacion_por_aviso"];
    for (const doc of docs) {
      if (!NOTIFICATION_TYPES.includes(doc.document_type)) {
        return json({ error: `Document ${doc.id} is not a notification type` }, 400);
      }
      if (doc.created_by !== user.id) {
        return json({ error: "Unauthorized: not the document creator" }, 403);
      }
    }

    // Fetch lawyer profile + org for branding
    const { data: lawyerProfile } = await adminClient
      .from("profiles")
      .select("full_name, email, litigation_email, cedula, tarjeta_profesional, custom_branding_enabled, custom_logo_path, custom_firm_name, organization_id")
      .eq("id", user.id)
      .single();

    if (!lawyerProfile?.litigation_email && !lawyerProfile?.email) {
      return json({ error: "No email configured for delivery" }, 400);
    }

    const recipientEmail = lawyerProfile.litigation_email || lawyerProfile.email;

    const orgId = docs[0].organization_id;
    const { data: orgData } = await adminClient
      .from("organizations")
      .select("name, custom_branding_enabled, custom_logo_path, custom_firm_name")
      .eq("id", orgId)
      .single();

    const branding = resolveBranding(supabaseUrl, orgData, lawyerProfile);
    const lawyerName = lawyerProfile.full_name || "Abogado(a)";

    // Build attachments — each document becomes an HTML "PDF" attachment
    const attachments = docs.map(doc => {
      const pdfHtml = buildPdfHtml(doc.content_html, branding, doc.id);
      // Resend accepts base64-encoded attachments
      const content = btoa(unescape(encodeURIComponent(pdfHtml)));
      const vars = doc.variables as Record<string, string> | null;
      const defendantShort = (vars?.defendant_name || "demandado")
        .replace(/\n.*/, "")
        .replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ0-9 ]/g, "")
        .substring(0, 30)
        .trim()
        .replace(/\s+/g, "_");
      const radicado = vars?.radicado || "sin_radicado";
      const typeLabel = doc.document_type === "notificacion_personal" ? "Notificacion_Personal" : "Notificacion_por_Aviso";
      return {
        filename: `${typeLabel}_${radicado}_${defendantShort}.html`,
        content,
      };
    });

    // Build summary list for the email body
    const docSummaryHtml = docs.map(doc => {
      const vars = doc.variables as Record<string, string> | null;
      const defendantName = vars?.defendant_name?.replace(/\n/g, " — ") || "Demandado";
      const typeLabel = doc.document_type === "notificacion_personal" ? "Notificación Personal" : "Notificación por Aviso";
      return `<li><strong>${typeLabel}</strong> — ${defendantName}</li>`;
    }).join("\n");

    const vars0 = docs[0].variables as Record<string, string> | null;
    const radicado = vars0?.radicado || "";
    const courtName = vars0?.court_name_full || "";

    // Plain-text version of the first document for easy copy-paste
    const firstDocPlainText = htmlToPlainText(docs[0].content_html);

    const typeLabel = docs[0].document_type === "notificacion_personal" ? "Notificación Personal" : "Notificación por Aviso";
    const subject = `${typeLabel} generada — Radicado ${radicado}`;

    const emailHtml = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
  ${buildLogoHeader(branding)}
  <div style="padding:24px 0;">
    <p>${lawyerName},</p>
    <p>Se ha${docs.length > 1 ? "n" : ""} generado exitosamente ${docs.length > 1 ? `${docs.length} notificaciones` : "la notificación"} para el expediente <strong>${radicado}</strong>.</p>
    
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Radicado</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">${radicado}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Juzgado</td><td style="padding:8px;border-bottom:1px solid #eee;">${courtName}</td></tr>
    </table>

    <p><strong>Documentos generados:</strong></p>
    <ul style="margin:8px 0 16px;">${docSummaryHtml}</ul>

    <div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-weight:bold;">📋 Instrucciones</p>
      <p style="margin:0;font-size:14px;">Para completar el trámite de notificación, debe:</p>
      <ol style="font-size:14px;margin:8px 0;">
        <li><strong>REENVIAR</strong> este documento desde su correo profesional (<strong>${recipientEmail}</strong>) al email del demandado.</li>
        <li>O bien, <strong>DESCARGAR</strong> el archivo adjunto e imprimirlo para envío físico a través de servicio postal autorizado.</li>
        <li>O bien, enviarlo a través de un proveedor de correo electrónico certificado.</li>
      </ol>
      <p style="margin:8px 0 0;font-size:13px;color:#856404;background:#fff3cd;padding:8px;border-radius:4px;">
        <strong>IMPORTANTE:</strong> Conserve la constancia de envío (screenshot del correo enviado, guía del servicio postal, o certificación) para aportarla al expediente judicial como prueba de la notificación.
      </p>
    </div>

    ${docs.length === 1 ? `
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;">
      <p style="font-weight:bold;font-size:14px;">Texto del documento (para copiar y pegar en un email):</p>
      <div style="background:#fafafa;border:1px solid #eee;border-radius:4px;padding:16px;font-family:Georgia,serif;font-size:13px;white-space:pre-wrap;line-height:1.6;">${firstDocPlainText}</div>
    </div>` : ""}
  </div>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
  <p style="color:#999;font-size:12px;text-align:center;">
    ${branding.firm_name}<br/>
    Documento generado por ${lawyerName} a través de Andromeda Legal (andromeda.legal)
  </p>
</div>`;

    // Send via Resend with attachments
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${branding.firm_name} <info@andromeda.legal>`,
        to: [recipientEmail],
        subject,
        html: emailHtml,
        attachments,
      }),
    });

    const emailData = await emailRes.json();

    if (!emailRes.ok) {
      console.error("[deliver-notification-email] Resend error:", emailData);
      return json({ error: "Failed to send email", details: emailData }, 502);
    }

    // Update all documents to delivered_to_lawyer
    for (const doc of docs) {
      await adminClient
        .from("generated_documents")
        .update({ status: "delivered_to_lawyer" } as any)
        .eq("id", doc.id);
    }

    // Log audit event
    await adminClient.from("audit_logs").insert({
      organization_id: orgId,
      actor_type: "USER",
      actor_user_id: user.id,
      action: "NOTIFICATION_DELIVERED_TO_LAWYER",
      entity_type: "generated_documents",
      entity_id: docs[0].id,
      metadata: {
        document_ids: docs.map(d => d.id),
        recipient: recipientEmail,
        document_count: docs.length,
        resend_id: emailData.id,
      },
    });

    console.log(`[deliver-notification-email] Sent ${docs.length} doc(s) to ${recipientEmail}, resend_id=${emailData.id}`);

    return json({
      ok: true,
      email_sent: true,
      recipient: recipientEmail,
      document_count: docs.length,
      resend_id: emailData.id,
    });
  } catch (err) {
    console.error("[deliver-notification-email] Error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
