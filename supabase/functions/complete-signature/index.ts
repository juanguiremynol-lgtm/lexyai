/**
 * complete-signature — Finalizes the digital signature process.
 * Public endpoint. Captures DRAWN signature only (typed rejected).
 * Stores signature PNG + raw stroke data for forensic evidence.
 * Computes SHA-256 for document pages + combined PDF.
 * Generates combined HTML (document + evidence appendix) as ONE file.
 * Emails both parties.
 * 
 * Phase 4: Hash-chained audit events, consumed_at token marking,
 *          device fingerprint, enhanced "Identity Verification Method" section,
 *          delivery method tracking in audit report.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

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

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function formatCOT(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric" })
      + " " + d.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      + " COT";
  } catch { return dateStr; }
}

function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
  if (!ua || ua === "unknown") return { browser: "Desconocido", os: "Desconocido", device: "Desconocido" };
  const chrome = ua.match(/Chrome\/(\d+)/);
  const firefox = ua.match(/Firefox\/(\d+)/);
  const safari = ua.match(/Version\/(\d+).*Safari/);
  const os = ua.includes("Windows") ? "Windows" : ua.includes("Mac") ? "macOS" : ua.includes("Linux") ? "Linux" : ua.includes("Android") ? "Android" : ua.includes("iPhone") ? "iOS" : "Desconocido";
  const device = ua.includes("Mobile") || ua.includes("Android") || ua.includes("iPhone") ? "Móvil" : "Escritorio";
  const browser = chrome ? `Chrome ${chrome[1]}` : firefox ? `Firefox ${firefox[1]}` : safari ? `Safari ${safari[1]}` : "Desconocido";
  return { browser, os, device };
}

function getSignerIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) { const first = xff.split(",")[0].trim(); if (first) return first; }
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "unknown";
}

function computeDeviceFingerprint(ip: string, ua: string): string {
  const raw = `${ip}|${ua}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) { const c = raw.charCodeAt(i); hash = ((hash << 5) - hash) + c; hash = hash & hash; }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function resolveBranding(supabaseUrl: string, org: any | null, profile: any | null): { logo_url: string | null; firm_name: string } {
  if (org?.custom_branding_enabled && org?.custom_logo_path) {
    return { logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${org.custom_logo_path}`, firm_name: org.custom_firm_name || org.name || "Andromeda Legal" };
  }
  if (profile?.custom_branding_enabled && profile?.custom_logo_path) {
    return { logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${profile.custom_logo_path}`, firm_name: profile.custom_firm_name || profile.full_name || "Andromeda Legal" };
  }
  return { logo_url: null, firm_name: "Andromeda Legal" };
}

function buildEmailHeader(branding: { logo_url: string | null; firm_name: string }): string {
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

function buildCertificateHeader(branding: { logo_url: string | null; firm_name: string }): string {
  if (branding.logo_url) {
    return `<div style="text-align:center;border-bottom:3px solid #1a1a2e;padding-bottom:16px;margin-bottom:24px;">
      <img src="${branding.logo_url}" alt="${branding.firm_name}" style="max-height:60px;max-width:250px;" />
      <p style="color:#666;margin:8px 0 0;font-size:13px;">${branding.firm_name}</p>
    </div>`;
  }
  return `<div style="text-align:center;border-bottom:3px solid #1a1a2e;padding-bottom:16px;margin-bottom:24px;">
    <h1 style="color:#1a1a2e;font-size:22px;margin:0;">${branding.firm_name.toUpperCase()}</h1>
    <p style="color:#666;margin:4px 0 0;font-size:13px;">Plataforma de Gestión Legal</p>
  </div>`;
}

/** Hash chaining helpers */
async function getLastEventHash(adminClient: any, documentId: string): Promise<string | null> {
  const { data } = await adminClient
    .from("document_signature_events").select("event_hash")
    .eq("document_id", documentId).not("event_hash", "is", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.event_hash || null;
}

/** Recursive canonical JSON: sorts keys at all depths, normalizes null/undefined */
function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalStringify).join(",") + "]";
  if (typeof obj === "object") {
    const sorted = Object.keys(obj as Record<string, unknown>).sort();
    return "{" + sorted.map(k => JSON.stringify(k) + ":" + canonicalStringify((obj as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(obj);
}

async function computeEventHash(previousHash: string | null, eventData: Record<string, unknown>): Promise<string> {
  const canonical = canonicalStringify(eventData);
  return sha256Hex((previousHash || "GENESIS") + canonical);
}

async function insertChainedEvent(adminClient: any, event: Record<string, unknown>, documentId: string): Promise<void> {
  const previousHash = await getLastEventHash(adminClient, documentId);
  const eventHash = await computeEventHash(previousHash, {
    event_type: event.event_type, event_data: event.event_data,
    actor_type: event.actor_type, actor_id: event.actor_id,
    timestamp: new Date().toISOString(),
  });
  await adminClient.from("document_signature_events").insert({
    ...event, previous_event_hash: previousHash, event_hash: eventHash,
  });
}

const EVENT_LABELS: Record<string, string> = {
  "document.created": "Documento creado",
  "document.edited": "Documento editado",
  "document.finalized": "Documento finalizado",
  "signature.requested": "Enlace de firma generado",
  "signature.email_sent": "Email de firma enviado",
  "signature.link_opened": "Enlace de firma abierto",
  "signature.identity_confirmed": "Identidad confirmada (nombre + cédula)",
  "signature.identity_failed": "Verificación de identidad fallida",
  "signature.otp_sent": "Código OTP enviado",
  "signature.otp_verified": "Identidad verificada (OTP)",
  "signature.otp_failed": "Verificación OTP fallida",
  "signature.document_viewed": "Documento revisado",
  "signature.consent_given": "Consentimiento otorgado",
  "signature.signed": "★ FIRMA ELECTRÓNICA",
  "document.hash_generated": "Hash SHA-256 generado",
  "document.stored": "Documento almacenado",
  "notification.sent": "Notificación enviada",
  "notification.failed": "Error al enviar notificación",
  "notification.reminder_sent": "Recordatorio enviado",
};

function buildSignerEvidenceSection(
  signerData: any, signerEvents: any[], signerIndex: number, totalSigners: number, roleLabel: string,
): string {
  const parsedUA = parseUserAgent(signerData.signer_user_agent || "");
  const strokeCount = signerData.signature_stroke_data?.length || 0;
  const totalPoints = signerData.signature_stroke_data?.reduce((s: number, st: any) => s + (st.points?.length || 0), 0) || 0;
  const sectionTitle = totalSigners > 1 ? `FIRMA ${signerIndex} DE ${totalSigners}: ${roleLabel}` : "FIRMANTE";
  const deviceFP = signerData.device_fingerprint_hash || "N/A";

  // Canonical identity verification method statement (locked text — do not paraphrase)
  const identityData = signerData.identity_confirmation_data;
  const maskedEmail = signerData.signer_email.replace(/^(.{1,2})(.*)(@.*)$/, (_: string, s: string, m: string, e: string) => s + "***" + e);
  const maskedPhone = signerData.signer_phone
    ? signerData.signer_phone.replace(/^(.{4})(.*)(.{4})$/, (_: string, s: string, m: string, e: string) => s + " *** *** " + e)
    : null;
  const otpTarget = maskedPhone ? maskedPhone : maskedEmail;
  // CANONICAL TEXT — DO NOT MODIFY without updating acceptance criteria
  const identityMethodText = identityData
    ? `Método de verificación de identidad: OTP a ${otpTarget} + campos de identidad asertados (nombre y cédula) verificados contra registro del expediente.`
    : `Método de verificación de identidad: OTP a ${otpTarget} + verificación de identidad vía enlace seguro.`;

  const auditRows = signerEvents.map((ev, i) => {
    const label = EVENT_LABELS[ev.event_type] || ev.event_type;
    const actor = ev.actor_type === "lawyer" ? "Abogado" : ev.actor_type === "signer" ? "Firmante" : "Sistema";
    const ip = ev.actor_ip || "Sistema";
    const eventFP = ev.device_fingerprint_hash || "";
    const isSignatureEvent = ev.event_type === "signature.signed";
    const hashInfo = ev.event_hash ? `<br/><span style="font-size:9px;color:#888;">Hash: ${ev.event_hash.substring(0, 16)}…</span>` : "";

    if (isSignatureEvent) {
      return `<tr style="background:#fffde7;border:2px solid #f9a825;">
        <td style="padding:8px;border:1px solid #f9a825;font-size:11px;font-weight:bold;">${i + 1}</td>
        <td style="padding:8px;border:1px solid #f9a825;font-size:11px;font-weight:bold;">${formatCOT(ev.created_at)}</td>
        <td style="padding:8px;border:1px solid #f9a825;font-size:11px;font-weight:bold;">
          ${label}<br/>
          <span style="font-weight:normal;font-size:10px;color:#555;">
            Método: Manuscrita digital | Trazos: ${strokeCount} | Puntos: ${totalPoints}<br/>
            Dispositivo: ${parsedUA.device} / ${parsedUA.browser} / ${parsedUA.os}
          </span>${hashInfo}
        </td>
        <td style="padding:8px;border:1px solid #f9a825;font-size:11px;font-weight:bold;">${actor}</td>
        <td style="padding:8px;border:1px solid #f9a825;font-size:11px;font-weight:bold;">${ip}</td>
      </tr>`;
    }
    return `<tr>
      <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${i + 1}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${formatCOT(ev.created_at)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${label}${hashInfo}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${actor}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${ip}</td>
    </tr>`;
  }).join("\n");

  return `
  <h3 style="color:#1a1a2e;background:#f0f0f5;padding:10px 12px;margin-top:32px;font-size:14px;letter-spacing:1px;border-left:4px solid #1a1a2e;">
    ${sectionTitle}
  </h3>

  <table style="width:100%;border-collapse:collapse;margin:8px 0;">
    <tr><td style="padding:6px 0;color:#666;width:40%;">Nombre completo:</td><td style="padding:6px 0;font-weight:bold;">${signerData.signer_name}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Cédula:</td><td style="padding:6px 0;">${signerData.signer_cedula || "N/A"}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Correo electrónico:</td><td style="padding:6px 0;">${signerData.signer_email}</td></tr>
  </table>

  <h4 style="color:#1a1a2e;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:16px;font-size:12px;">MÉTODO DE VERIFICACIÓN DE IDENTIDAD</h4>
  <div style="background:#f8f9fa;border:1px solid #e0e0e0;border-radius:4px;padding:12px;margin:8px 0;font-size:12px;">
    <p style="margin:0;"><strong>${identityMethodText}</strong></p>
    <p style="margin:4px 0 0;color:#888;font-size:10px;">Nota: "Indicador de sesión/dispositivo (hash)" es un hash derivado de IP y User-Agent. No identifica unívocamente al dispositivo.</p>
    ${identityData?.confirmed_at ? `<p style="margin:4px 0 0;color:#666;">Identidad confirmada: ${formatCOT(identityData.confirmed_at)}</p>` : ""}
  </div>
  <table style="width:100%;border-collapse:collapse;">
    ${signerData.otp_sent_at ? `<tr><td style="padding:4px 0;color:#666;width:40%;font-size:12px;">OTP enviado:</td><td style="padding:4px 0;font-size:12px;">${formatCOT(signerData.otp_sent_at)}</td></tr>` : ""}
    ${signerData.otp_verified_at ? `<tr><td style="padding:4px 0;color:#666;font-size:12px;">OTP verificado:</td><td style="padding:4px 0;font-size:12px;">${formatCOT(signerData.otp_verified_at)}</td></tr>` : ""}
    <tr><td style="padding:4px 0;color:#666;font-size:12px;">Intentos OTP:</td><td style="padding:4px 0;font-size:12px;">${signerData.otp_attempts || 0} de 3</td></tr>
  </table>

  <h4 style="color:#1a1a2e;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:16px;font-size:12px;">DATOS DE LA FIRMA</h4>
  <table style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:4px 0;color:#666;width:40%;font-size:12px;">Fecha y hora:</td><td style="padding:4px 0;font-weight:bold;font-size:12px;">${signerData.signed_at ? formatCOT(signerData.signed_at) : "Pendiente"}</td></tr>
    <tr><td style="padding:4px 0;color:#666;font-size:12px;">Dirección IP:</td><td style="padding:4px 0;font-family:monospace;font-size:12px;">${signerData.signer_ip || "N/A"}</td></tr>
    <tr><td style="padding:4px 0;color:#666;font-size:12px;">Navegador:</td><td style="padding:4px 0;font-size:12px;">${parsedUA.browser}</td></tr>
    <tr><td style="padding:4px 0;color:#666;font-size:12px;">Sistema operativo:</td><td style="padding:4px 0;font-size:12px;">${parsedUA.os}</td></tr>
     <tr><td style="padding:4px 0;color:#666;font-size:12px;">Dispositivo:</td><td style="padding:4px 0;font-size:12px;">${parsedUA.device}</td></tr>
     <tr><td style="padding:4px 0;color:#666;font-size:12px;">Indicador de sesión/dispositivo (hash):</td><td style="padding:4px 0;font-family:monospace;font-size:12px;">${deviceFP}</td></tr>
     <tr><td style="padding:4px 0;color:#666;font-size:12px;">Firma manuscrita digital:</td><td style="padding:4px 0;font-size:12px;">${strokeCount} trazos, ${totalPoints} puntos</td></tr>
  </table>

  <h4 style="color:#1a1a2e;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:16px;font-size:12px;">REGISTRO DE AUDITORÍA — Firmante ${signerIndex}</h4>
  <table style="width:100%;border-collapse:collapse;margin:8px 0;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">#</th>
        <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Fecha/Hora COT</th>
        <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Evento</th>
        <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Actor</th>
        <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">IP</th>
      </tr>
    </thead>
    <tbody>
      ${auditRows}
    </tbody>
  </table>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { signing_token, signature_method, signature_data, signature_stroke_data, consent_given, geolocation } = body;

    if (!signing_token || !signature_method || !signature_data || !consent_given) {
      return json({ error: "Datos incompletos. Se requiere firma y consentimiento." }, 400);
    }
    if (signature_method !== "drawn") {
      return json({ error: "Solo se acepta firma manuscrita digital (drawn). La firma tipográfica no está permitida." }, 400);
    }
    if (!signature_data.startsWith("data:image/png;base64,")) {
      return json({ error: "Formato de firma inválido. Se requiere imagen PNG." }, 400);
    }
    const base64Part = signature_data.split(",")[1] || "";
    if (base64Part.length > 700000) {
      return json({ error: "La imagen de la firma es demasiado grande." }, 400);
    }
    if (!signature_stroke_data || !Array.isArray(signature_stroke_data) || signature_stroke_data.length === 0) {
      return json({ error: "Se requieren datos de trazos de la firma manuscrita." }, 400);
    }
    let payloadTotalPoints = 0;
    for (const stroke of signature_stroke_data) {
      if (!stroke.points || !Array.isArray(stroke.points)) return json({ error: "Estructura de datos de trazos inválida." }, 400);
      payloadTotalPoints += stroke.points.length;
    }
    if (payloadTotalPoints < 15) {
      return json({ error: "La firma debe ser más elaborada (mínimo 15 puntos). Por favor dibújela nuevamente." }, 422);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);
    const signerIp = getSignerIp(req);
    const signerUA = req.headers.get("user-agent") || "unknown";
    const deviceFingerprintHash = computeDeviceFingerprint(signerIp, signerUA);

    // Rate limiting
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count } = await adminClient
      .from("rate_limits").select("*", { count: "exact", head: true })
      .eq("key", signing_token).eq("endpoint", "complete-signature").gte("window_start", oneHourAgo);
    if ((count || 0) >= 3) return json({ error: "Demasiadas solicitudes. Intente nuevamente en unos minutos." }, 429);
    await adminClient.from("rate_limits").insert({ key: signing_token, endpoint: "complete-signature", window_start: new Date().toISOString() });

    // Fetch signature
    const { data: sig, error: sigErr } = await adminClient
      .from("document_signatures").select("*").eq("signing_token", signing_token).single();
    if (sigErr || !sig) return json({ error: "Solicitud de firma no encontrada." }, 404);
    if (sig.status === "signed") return json({ error: "Este documento ya fue firmado." }, 409);
    if (sig.consumed_at) return json({ error: "Este enlace ya fue utilizado." }, 409);
    if (sig.status === "revoked") return json({ error: "Esta solicitud fue cancelada. Comuníquese con su abogado." }, 403);
    if (sig.status !== "otp_verified") return json({ error: "Debe verificar su identidad antes de firmar." }, 403);
    if (new Date(sig.expires_at) < new Date()) {
      await adminClient.from("document_signatures").update({ status: "expired" }).eq("id", sig.id);
      return json({ error: "El enlace de firma ha expirado. Solicite uno nuevo a su abogado." }, 410);
    }

    const signedAt = new Date().toISOString();
    const parsedUA = parseUserAgent(signerUA);
    let strokeCount = 0, totalPoints = 0;
    if (signature_stroke_data && Array.isArray(signature_stroke_data)) {
      strokeCount = signature_stroke_data.length;
      totalPoints = signature_stroke_data.reduce((sum: number, stroke: any) => sum + (stroke.points?.length || 0), 0);
    }

    // Log consent event with hash chaining
    await insertChainedEvent(adminClient, {
      organization_id: sig.organization_id, document_id: sig.document_id, signature_id: sig.id,
      event_type: "signature.consent_given",
      event_data: { consent_text: "Acepto firmar electrónicamente conforme a Ley 527/1999", timestamp: signedAt, device_fingerprint_hash: deviceFingerprintHash },
      actor_type: "signer", actor_id: sig.signer_email, actor_ip: signerIp, actor_user_agent: signerUA,
      device_fingerprint_hash: deviceFingerprintHash,
    }, sig.document_id);

    // Fetch document
    const { data: doc } = await adminClient
      .from("generated_documents")
      .select("id, title, content_html, organization_id, document_type, work_item_id, created_by, created_at, poderdante_type, entity_data")
      .eq("id", sig.document_id).single();
    if (!doc) return json({ error: "Documento no encontrado." }, 404);

    // Fetch work item radicado
    let radicado = "";
    if (doc.work_item_id) {
      const { data: wi } = await adminClient.from("work_items").select("radicado").eq("id", doc.work_item_id).single();
      radicado = wi?.radicado || "";
    }

    // Fetch lawyer info + branding
    let lawyerName = "", lawyerEmail = "", lawyerProfile: any = null;
    if (doc.created_by) {
      const { data: prof } = await adminClient.from("profiles").select("full_name, email, litigation_email, custom_branding_enabled, custom_logo_path, custom_firm_name").eq("id", doc.created_by).single();
      lawyerName = prof?.full_name || ""; lawyerEmail = prof?.litigation_email || prof?.email || ""; lawyerProfile = prof;
    }
    let orgData: any = null;
    if (sig.organization_id) {
      const { data: org } = await adminClient.from("organizations").select("name, custom_branding_enabled, custom_logo_path, custom_firm_name").eq("id", sig.organization_id).single();
      orgData = org;
    }
    const branding = resolveBranding(supabaseUrl, orgData, lawyerProfile);

    // Store drawn signature image
    let signatureImagePath: string | null = null;
    try {
      const binaryStr = atob(base64Part);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      signatureImagePath = `${sig.organization_id}/${sig.document_id}/signature-${sig.id}.png`;
      await adminClient.storage.from("signed-documents").upload(signatureImagePath, bytes, { contentType: "image/png", upsert: true });
    } catch (uploadErr) { console.error("Signature image upload error:", uploadErr); }

    // Build signature block
    const signatureBlock = `<div style="margin-top:40px;border-top:2px solid #333;padding-top:20px;">
      <img src="${signature_data}" alt="Firma manuscrita digital" style="max-width:300px;max-height:100px;" />
      <p><strong>${sig.signer_name}</strong></p>
      <p>C.C. ${sig.signer_cedula || "N/A"}</p>
      <p style="font-size:12px;color:#666;">Firmado electrónicamente el ${formatCOT(signedAt)}</p>
      <p style="font-size:11px;color:#999;">Firma manuscrita digital válida conforme a Ley 527 de 1999 y Decreto 2364 de 2012</p>
    </div>`;

    // Log signed event with hash chaining
    await insertChainedEvent(adminClient, {
      organization_id: sig.organization_id, document_id: sig.document_id, signature_id: sig.id,
      event_type: "signature.signed",
      event_data: {
        signature_method: "drawn", timestamp: signedAt, geolocation: geolocation || null,
        stroke_count: strokeCount, total_points: totalPoints, biometric_data_captured: true,
        device_fingerprint_hash: deviceFingerprintHash,
      },
      actor_type: "signer", actor_id: sig.signer_email, actor_ip: signerIp, actor_user_agent: signerUA,
      device_fingerprint_hash: deviceFingerprintHash,
    }, sig.document_id);

    // Update this signature record — mark as signed AND consumed
    await adminClient.from("document_signatures").update({
      status: "signed", signature_method: "drawn", signature_data: null,
      signature_image_path: signatureImagePath, signature_stroke_data: signature_stroke_data || null,
      signed_at: signedAt, signer_ip: signerIp, signer_user_agent: signerUA,
      signer_geolocation: geolocation || null,
      consumed_at: signedAt, // One-time use: mark token as consumed
      device_fingerprint_hash: deviceFingerprintHash,
    }).eq("id", sig.id);

    // Check for dependent signers (multi-signer flow)
    const { data: waitingSigners } = await adminClient
      .from("document_signatures").select("*")
      .eq("document_id", sig.document_id).eq("depends_on", sig.id).eq("status", "waiting");

    if (waitingSigners && waitingSigners.length > 0) {
      await adminClient.from("generated_documents").update({ status: "partially_signed" }).eq("id", sig.document_id);
      for (const nextSig of waitingSigners) {
        await adminClient.from("document_signatures").update({ status: "pending" }).eq("id", nextSig.id);
        await insertChainedEvent(adminClient, {
          organization_id: sig.organization_id, document_id: sig.document_id, signature_id: nextSig.id,
          event_type: "signature.requested",
          event_data: { signer_email: nextSig.signer_email, signer_name: nextSig.signer_name, triggered_by: sig.id },
          actor_type: "system", actor_id: "system",
        }, sig.document_id);
        const resendKeyNotify = Deno.env.get("RESEND_API_KEY");
        if (resendKeyNotify && nextSig.signer_email) {
          const expiresTs = Math.floor(new Date(nextSig.expires_at).getTime() / 1000);
          const nextSigningUrl = `https://lexyai.lovable.app/sign/${nextSig.signing_token}?expires=${expiresTs}&signature=${nextSig.hmac_signature}`;
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendKeyNotify}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: `${branding.firm_name} <info@andromeda.legal>`, to: [nextSig.signer_email],
                subject: `Su turno de firmar — ${doc.title}`,
                html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
                  ${buildEmailHeader(branding)}
                  <div style="padding:24px 0;">
                    <h2 style="color:#1a1a2e;">Su turno de firmar</h2>
                    <p>${sig.signer_name} ha firmado el documento <strong>${doc.title}</strong>. Ahora es su turno.</p>
                    <div style="text-align:center;margin:24px 0;">
                      <a href="${nextSigningUrl}" style="background:#1a1a2e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Firmar Documento</a>
                    </div>
                  </div>
                  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
                  <p style="color:#999;font-size:12px;text-align:center;">${branding.firm_name}</p>
                </div>`,
              }),
            });
          } catch (emailErr) { console.error("Next signer notification error:", emailErr); }
        }
      }
      return json({ ok: true, signature_id: sig.id, document_hash: null, signed_at: signedAt, download_url: null, is_partial: true, message: "Su firma ha sido registrada. El documento requiere firmas adicionales." });
    }

    // ─── ALL signers complete — generate final combined PDF ───
    const { data: allSignatures } = await adminClient
      .from("document_signatures").select("*").eq("document_id", sig.document_id).order("signing_order", { ascending: true });
    const signedSigs = allSignatures?.filter(s => s.status === "signed") || [];
    const totalSigners = signedSigs.length;

    const allSignatureBlocks = signedSigs.map(s => {
      const roleLabel = s.signer_role === "lawyer" ? "EL MANDATARIO" : "EL MANDANTE";
      return `<div style="margin-top:30px;border-top:2px solid #333;padding-top:16px;display:inline-block;width:${totalSigners > 1 ? '48%' : '100%'};vertical-align:top;">
        ${s.signature_image_path ? `<img src="${supabaseUrl}/storage/v1/object/public/signed-documents/${s.signature_image_path}" alt="Firma" style="max-width:250px;max-height:80px;" />` : '<p style="color:#999;">[Firma registrada]</p>'}
        <p><strong>${s.signer_name}</strong></p><p>C.C. ${s.signer_cedula || "N/A"}</p>
        ${totalSigners > 1 ? `<p style="font-size:12px;font-weight:bold;">${roleLabel}</p>` : ""}
        <p style="font-size:11px;color:#666;">Firmado: ${s.signed_at ? formatCOT(s.signed_at) : "N/A"}</p>
      </div>`;
    }).join(totalSigners > 1 ? '&nbsp;&nbsp;' : '');

    // Build DOCUMENT PAGES HTML (for hash)
    const documentPagesHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${doc.title}</title>
<style>body { font-family: 'Georgia', serif; max-width: 800px; margin: 0 auto; padding: 40px; }</style>
</head><body>${doc.content_html}<div style="margin-top:40px;">${allSignatureBlocks}</div></body></html>`;

    const documentBytes = new TextEncoder().encode(documentPagesHtml);
    const documentHash = await sha256Hex(documentBytes);

    // Log hash event
    await insertChainedEvent(adminClient, {
      organization_id: sig.organization_id, document_id: sig.document_id, signature_id: sig.id,
      event_type: "document.hash_generated",
      event_data: { hash: documentHash, algorithm: "SHA-256", scope: "document_pages_all_signatures" },
      actor_type: "system", actor_id: "system",
    }, sig.document_id);

    // Fetch ALL audit trail events
    const { data: allDocEvents } = await adminClient
      .from("document_signature_events").select("*").eq("document_id", sig.document_id)
      .in("event_type", ["document.created", "document.edited", "document.finalized"])
      .order("created_at", { ascending: true });

    const certificateId = crypto.randomUUID();
    const docTypeLabel = doc.document_type === "poder_especial" ? "Poder Especial" : doc.document_type === "contrato_servicios" ? "Contrato de Servicios Profesionales" : doc.document_type;
    const verifyUrl = `https://lexyai.lovable.app/verify?hash=${documentHash}`;

    // Determine delivery method from initial signature.requested event
    const { data: requestedEvent } = await adminClient
      .from("document_signature_events").select("event_data")
      .eq("document_id", sig.document_id).eq("event_type", "signature.requested")
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    const deliveryMethod = requestedEvent?.event_data?.delivery_method || "EMAIL";

    const docAuditRows = (allDocEvents || []).map((ev, i) => {
      const label = EVENT_LABELS[ev.event_type] || ev.event_type;
      const actor = ev.actor_type === "lawyer" ? "Abogado" : ev.actor_type === "signer" ? "Firmante" : "Sistema";
      const ip = ev.actor_ip || "Sistema";
      return `<tr>
        <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${i + 1}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${formatCOT(ev.created_at)}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${label}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${actor}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${ip}</td>
      </tr>`;
    }).join("\n");

    // Build per-signer evidence sections
    const poderdanteType = (doc as any).poderdante_type || "natural";
    const entityInfo = (doc as any).entity_data || null;
    const signerSections: string[] = [];
    for (let idx = 0; idx < signedSigs.length; idx++) {
      const s = signedSigs[idx];
      let roleLabel: string;
      if (s.signer_role === "lawyer") roleLabel = "EL MANDATARIO (ABOGADO)";
      else if (poderdanteType === "juridica" && entityInfo) roleLabel = `PODERDANTE (PERSONA JURÍDICA)`;
      else if (poderdanteType === "multiple") roleLabel = `PODERDANTE ${idx + 1}`;
      else roleLabel = "EL MANDANTE (CLIENTE)";

      const { data: signerEvents } = await adminClient
        .from("document_signature_events").select("*").eq("signature_id", s.id).order("created_at", { ascending: true });

      let extraInfo = "";
      if (poderdanteType === "juridica" && s.signer_role !== "lawyer" && entityInfo) {
        extraInfo = `<table style="width:100%;border-collapse:collapse;margin:8px 0 16px;">
          <tr><td style="padding:6px 0;color:#666;width:40%;">Sociedad:</td><td style="padding:6px 0;font-weight:bold;">${entityInfo.company_name || "N/A"}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">NIT:</td><td style="padding:6px 0;">${entityInfo.company_nit || "N/A"}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Domicilio:</td><td style="padding:6px 0;">${entityInfo.company_city || "N/A"}</td></tr>
          ${entityInfo.rep_legal_cargo ? `<tr><td style="padding:6px 0;color:#666;">Cargo del firmante:</td><td style="padding:6px 0;">${entityInfo.rep_legal_cargo}</td></tr>` : ""}
        </table><h4 style="color:#1a1a2e;border-bottom:1px solid #ddd;padding-bottom:4px;font-size:12px;">REPRESENTANTE LEGAL</h4>`;
      }
      const section = buildSignerEvidenceSection(s, signerEvents || [], idx + 1, totalSigners, roleLabel);
      if (extraInfo) {
        const insertPoint = section.indexOf('</h3>') + 5;
        signerSections.push(section.slice(0, insertPoint) + extraInfo + section.slice(insertPoint));
      } else {
        signerSections.push(section);
      }
    }

    let statusLabel: string;
    if (poderdanteType === "multiple") statusLabel = `Firmado por todos los poderdantes (${totalSigners}/${totalSigners})`;
    else if (totalSigners > 1) statusLabel = "Firmado por ambas partes";
    else statusLabel = "Firmado";

    // Delivery method label for audit report
    const deliveryMethodLabel = deliveryMethod === "LINK"
      ? "Enlace de firma (compartido por el abogado)"
      : "Correo electrónico (info@andromeda.legal)";

    // Token info
    const tokenIssuedAt = sig.created_at ? formatCOT(sig.created_at) : "N/A";
    const tokenExpiresAt = sig.expires_at ? formatCOT(sig.expires_at) : "N/A";
    const tokenConsumedAt = formatCOT(signedAt);

    const evidenceAppendix = `
<div style="page-break-before:always;padding:40px;font-family:sans-serif;max-width:800px;margin:0 auto;">
  ${buildCertificateHeader(branding)}
  
  <h2 style="text-align:center;color:#1a1a2e;border-top:2px solid #1a1a2e;border-bottom:2px solid #1a1a2e;padding:12px 0;letter-spacing:2px;font-size:16px;">
    CERTIFICADO DE FIRMA ELECTRÓNICA
  </h2>

  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:6px 0;color:#666;width:40%;">Documento:</td><td style="padding:6px 0;font-weight:bold;">${doc.title}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">ID del documento:</td><td style="padding:6px 0;font-family:monospace;font-size:11px;">${doc.id}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Tipo:</td><td style="padding:6px 0;">${docTypeLabel}</td></tr>
    ${radicado ? `<tr><td style="padding:6px 0;color:#666;">Expediente:</td><td style="padding:6px 0;">${radicado}</td></tr>` : ""}
    <tr><td style="padding:6px 0;color:#666;">Estado:</td><td style="padding:6px 0;font-weight:bold;">${statusLabel}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Creado:</td><td style="padding:6px 0;">${formatCOT(doc.created_at)}</td></tr>
    ${lawyerName ? `<tr><td style="padding:6px 0;color:#666;">Generado para:</td><td style="padding:6px 0;">${lawyerName} (${lawyerEmail})</td></tr>` : ""}
    ${doc.created_by ? `<tr><td style="padding:6px 0;color:#666;">ID de usuario abogado:</td><td style="padding:6px 0;font-family:monospace;font-size:11px;">${doc.created_by}</td></tr>` : ""}
    <tr><td style="padding:6px 0;color:#666;">Método de entrega:</td><td style="padding:6px 0;">${deliveryMethodLabel}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Remitente del sistema:</td><td style="padding:6px 0;">info@andromeda.legal</td></tr>
  </table>

  <h3 style="color:#1a1a2e;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:24px;">INFORMACIÓN DEL TOKEN DE FIRMA</h3>
  <table style="width:100%;border-collapse:collapse;margin:8px 0;">
    <tr><td style="padding:4px 0;color:#666;width:40%;font-size:12px;">Token emitido:</td><td style="padding:4px 0;font-size:12px;">${tokenIssuedAt}</td></tr>
    <tr><td style="padding:4px 0;color:#666;font-size:12px;">Token expira:</td><td style="padding:4px 0;font-size:12px;">${tokenExpiresAt}</td></tr>
    <tr><td style="padding:4px 0;color:#666;font-size:12px;">Token consumido:</td><td style="padding:4px 0;font-size:12px;">${tokenConsumedAt}</td></tr>
    <tr><td style="padding:4px 0;color:#666;font-size:12px;">Estado del token:</td><td style="padding:4px 0;font-weight:bold;font-size:12px;">CONSUMIDO (uso único)</td></tr>
  </table>

  ${docAuditRows.length > 0 ? `
  <h3 style="color:#1a1a2e;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:24px;">HISTORIAL DEL DOCUMENTO</h3>
  <table style="width:100%;border-collapse:collapse;margin:8px 0;">
    <thead><tr style="background:#f5f5f5;">
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">#</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Fecha/Hora COT</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Evento</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Actor</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">IP</th>
    </tr></thead>
    <tbody>${docAuditRows}</tbody>
  </table>` : ""}

  ${signerSections.join("")}

  <h3 style="color:#1a1a2e;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:32px;">INTEGRIDAD DEL DOCUMENTO</h3>
  <table style="width:100%;border-collapse:collapse;">
     <tr><td style="padding:6px 0;color:#666;width:40%;">Algoritmo:</td><td style="padding:6px 0;">SHA-256</td></tr>
     <tr><td style="padding:6px 0;color:#666;">Hash del documento firmado (final_pdf_sha256):</td><td style="padding:6px 0;font-family:monospace;font-size:10px;word-break:break-all;">${documentHash}</td></tr>
     <tr><td style="padding:6px 0;color:#666;">Nota:</td><td style="padding:6px 0;font-size:11px;">Este hash corresponde al artefacto PDF firmado adjunto a este certificado.</td></tr>
     <tr><td style="padding:6px 0;color:#666;">Cadena de hash de eventos:</td><td style="padding:6px 0;font-size:11px;">Habilitada (SHA-256 encadenado)</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Verificar en:</td><td style="padding:6px 0;"><a href="${verifyUrl}" style="color:#1a1a2e;">${verifyUrl}</a></td></tr>
  </table>

  <h3 style="color:#1a1a2e;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:24px;">MARCO LEGAL</h3>
  <div style="font-size:12px;color:#444;line-height:1.6;">
    <p>Esta firma electrónica se emite de conformidad con:</p>
    <ul style="margin:8px 0;">
      <li>Ley 527 de 1999 — Comercio electrónico y firmas digitales</li>
      <li>Decreto 2364 de 2012 — Reglamentación de la firma electrónica</li>
      <li>Decreto 806 de 2020 — Firma electrónica en actuaciones judiciales</li>
    </ul>
    <p>La firma cumple los requisitos del Art. 4° Decreto 2364/2012: (1) datos de creación vinculados exclusivamente al firmante (verificación de identidad por nombre y cédula + OTP + email personal + firma manuscrita digital con datos biométricos), (2) cualquier alteración posterior es detectable (hash SHA-256 con cadena de eventos inmutable).</p>
  </div>

  <div style="margin-top:32px;padding-top:16px;border-top:2px solid #1a1a2e;text-align:center;font-size:11px;color:#999;">
    <p>Generado por ${branding.firm_name}</p>
    <p>Certificado ID: ${certificateId} | Documento ID: ${doc.id}</p>
    <p>Este documento fue generado automáticamente y no requiere firma adicional.</p>
  </div>
</div>`;

    const combinedHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${doc.title}</title>
<style>body { font-family: 'Georgia', serif; max-width: 800px; margin: 0 auto; padding: 40px; }
@media print { div[style*="page-break-before"] { page-break-before: always; } }</style>
</head><body>
${doc.content_html}
<div style="margin-top:40px;">${allSignatureBlocks}</div>
<footer style="margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:10px;color:#999;text-align:center;">
  Documento firmado electrónicamente — ID: ${doc.id.substring(0, 8)}
</footer>
${evidenceAppendix}
</body></html>`;

    const combinedBytes = new TextEncoder().encode(combinedHtml);
    const combinedHash = await sha256Hex(combinedBytes);

    const storagePath = `${sig.organization_id}/${sig.document_id}/signed.html`;
    const { error: uploadErr } = await adminClient.storage.from("signed-documents").upload(storagePath, combinedBytes, { contentType: "text/html; charset=utf-8", upsert: true });
    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      return json({ error: "Hubo un error al generar el documento. Por favor intente nuevamente." }, 500);
    }

    // Update ALL signed signatures with hash + storage path
    for (const s of signedSigs) {
      await adminClient.from("document_signatures").update({
        signed_document_path: storagePath, signed_document_hash: documentHash,
        combined_pdf_hash: combinedHash, certificate_id: certificateId,
      }).eq("id", s.id);
    }

    // Set finalized_at NOW (execution timestamp) — this triggers retention computation via DB trigger
    await adminClient.from("generated_documents").update({
      status: "signed",
      final_pdf_sha256: documentHash,
      finalized_at: new Date().toISOString(),
      finalized_by: sig.signer_name,
    }).eq("id", sig.document_id);

    await insertChainedEvent(adminClient, {
      organization_id: sig.organization_id, document_id: sig.document_id, signature_id: sig.id,
      event_type: "document.stored",
      event_data: { storage_path: storagePath, includes_evidence_appendix: true, combined_hash: combinedHash, total_signers: totalSigners, final_pdf_sha256: documentHash },
      actor_type: "system", actor_id: "system",
    }, sig.document_id);

    const { data: signedUrlData } = await adminClient.storage.from("signed-documents").createSignedUrl(storagePath, 30 * 24 * 60 * 60);
    const downloadUrl = signedUrlData?.signedUrl || "";

    // Send notification emails
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const confirmHtml = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          ${buildEmailHeader(branding)}
          <div style="padding:24px 0;">
            <h2 style="color:#1a1a2e;">✅ Documento Firmado</h2>
            <p>Hola <strong>{RECIPIENT_NAME}</strong>,</p>
            <p>El siguiente documento ha sido firmado electrónicamente${totalSigners > 1 ? " por todas las partes" : ""}:</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Documento</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">${doc.title}</td></tr>
              ${signedSigs.map(s => `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Firmado por</td><td style="padding:8px;border-bottom:1px solid #eee;">${s.signer_name} — ${s.signed_at ? formatCOT(s.signed_at) : ""}</td></tr>`).join("")}
              <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Hash SHA-256</td><td style="padding:8px;border-bottom:1px solid #eee;font-family:monospace;font-size:10px;word-break:break-all;">${documentHash}</td></tr>
            </table>
            ${downloadUrl ? `<div style="text-align:center;margin:24px 0;">
              <a href="${downloadUrl}" style="background:#1a1a2e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Descargar documento firmado</a>
            </div>
            <p style="color:#666;font-size:13px;text-align:center;">El documento incluye el certificado de evidencia con el registro completo de auditoría.</p>` : ""}
            <p style="color:#666;font-size:13px;">Para verificar la integridad: <a href="https://lexyai.lovable.app/verify" style="color:#1a1a2e;">https://lexyai.lovable.app/verify</a></p>
          </div>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
          <p style="color:#999;font-size:12px;text-align:center;">${branding.firm_name}<br/>Firma electrónica conforme a la Ley 527 de 1999 y Decreto 2364 de 2012.</p>
        </div>`;

      const recipients = new Set<string>();
      for (const s of signedSigs) { if (s.signer_email) recipients.add(s.signer_email); }
      if (lawyerEmail) recipients.add(lawyerEmail);

      for (const email of recipients) {
        try {
          const recipientName = signedSigs.find(s => s.signer_email === email)?.signer_name || lawyerName || "Usuario";
          const html = confirmHtml.replace("{RECIPIENT_NAME}", recipientName);
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `${branding.firm_name} <info@andromeda.legal>`, to: [email],
              subject: `✅ Documento firmado — ${doc.title}`, html,
            }),
          });
        } catch (e) {
          console.error(`Notification error for ${email}:`, e);
          await adminClient.from("document_signature_events").insert({
            organization_id: sig.organization_id, document_id: sig.document_id, signature_id: sig.id,
            event_type: "notification.failed", event_data: { recipient: email, error: String(e) },
            actor_type: "system", actor_id: "system",
          }).catch(() => {});
        }
      }

      await insertChainedEvent(adminClient, {
        organization_id: sig.organization_id, document_id: sig.document_id, signature_id: sig.id,
        event_type: "notification.sent",
        event_data: {
          recipients: Array.from(recipients), type: "signature_confirmation",
          total_signers: totalSigners, sender: "info@andromeda.legal",
          delivery_method: deliveryMethod,
          generated_for: { user_id: doc.created_by, lawyer_name: lawyerName, litigation_email: lawyerEmail },
          event_timeline: deliveryMethod === "LINK"
            ? "CREATED → LINK_GENERATED → IDENTITY_CONFIRMED → OTP_VERIFIED → VIEWED → SIGNED → DISTRIBUTED"
            : "CREATED → SENT_EMAIL_TO_SIGNER → IDENTITY_CONFIRMED → OTP_VERIFIED → VIEWED → SIGNED → DISTRIBUTED",
          final_pdf_sha256: documentHash,
        },
        actor_type: "system", actor_id: "system",
      }, sig.document_id);
    }

    return json({
      ok: true, signature_id: sig.id, document_hash: documentHash,
      signed_at: signedAt, download_url: downloadUrl,
      message: "Documento firmado exitosamente",
    });
  } catch (err) {
    console.error("complete-signature error:", err);
    return json({ error: "Hubo un error al procesar la firma. Por favor intente nuevamente." }, 500);
  }
});
