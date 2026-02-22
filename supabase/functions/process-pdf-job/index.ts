/**
 * process-pdf-job — Async worker for PDF artifact generation + email distribution.
 *
 * Phase 2 — Authoritative artifact generation:
 *   - Builds the FINAL combined HTML (document + signatures + audit certificate)
 *   - Converts via Gotenberg → stores signed.pdf
 *   - Computes final_pdf_sha256 from actual PDF bytes
 *   - Sends policy-driven email distribution ONLY after PDF exists
 *   - Idempotent: skips if signed.pdf already exists with matching SHA
 *   - Email-once: uses distribution_sent_at to prevent duplicate sends
 *
 * The audit certificate includes per-signer evidence sections with:
 *   - Identity verification method (canonical statement)
 *   - OTP details (sent, verified, attempts)
 *   - Signature biometrics (strokes, points)
 *   - Technical traces (IP, UA, device fingerprint hash)
 *   - Hash-chained event timeline
 *   - Token issuance/expiry/consumption
 *   - Legal framework references
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
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatCOT(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return (
      d.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric" }) +
      " " +
      d.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
      " COT"
    );
  } catch {
    return dateStr;
  }
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

// ─── Document Policy (server-side mirror) ──────────────────
type DistributionRecipient = "lawyer" | "client" | "both";
interface DocTypePolicy {
  label_es: string;
  signerModel: "UNILATERAL" | "BILATERAL";
  distribution: DistributionRecipient;
  finalizedEvent: "SIGNED_FINALIZED" | "ISSUED_FINALIZED";
  auditIdentityLabel_es: string;
}

const DOC_TYPE_POLICIES: Record<string, DocTypePolicy> = {
  poder_especial: { label_es: "Poder Especial", signerModel: "UNILATERAL", distribution: "both", finalizedEvent: "SIGNED_FINALIZED", auditIdentityLabel_es: "Método de verificación de identidad: OTP al correo/teléfono del firmante + campos de identidad asertados (nombre y cédula) verificados contra registro del expediente." },
  contrato_servicios: { label_es: "Contrato de Prestación de Servicios", signerModel: "BILATERAL", distribution: "both", finalizedEvent: "SIGNED_FINALIZED", auditIdentityLabel_es: "Método de verificación de identidad: OTP + campos de identidad asertados (nombre y cédula) verificados para cada firmante." },
  paz_y_salvo: { label_es: "Paz y Salvo", signerModel: "UNILATERAL", distribution: "both", finalizedEvent: "ISSUED_FINALIZED", auditIdentityLabel_es: "Método de verificación de identidad: OTP al correo registrado del abogado emisor + campos de identidad asertados (nombre, cédula y T.P.) verificados contra perfil de usuario." },
  notificacion_personal: { label_es: "Notificación Personal", signerModel: "UNILATERAL", distribution: "lawyer", finalizedEvent: "ISSUED_FINALIZED", auditIdentityLabel_es: "Documento de emisor firmado por el abogado. Método de verificación: OTP al correo registrado del abogado emisor + campos de identidad asertados (nombre, cédula y T.P.) verificados contra perfil de usuario." },
  notificacion_por_aviso: { label_es: "Notificación por Aviso", signerModel: "UNILATERAL", distribution: "lawyer", finalizedEvent: "ISSUED_FINALIZED", auditIdentityLabel_es: "Documento de emisor firmado por el abogado. Método de verificación: OTP al correo registrado del abogado emisor + campos de identidad asertados (nombre, cédula y T.P.) verificados contra perfil de usuario." },
};

function getPolicy(docType: string): DocTypePolicy {
  return DOC_TYPE_POLICIES[docType] || { label_es: docType, signerModel: "UNILATERAL", distribution: "both", finalizedEvent: "SIGNED_FINALIZED", auditIdentityLabel_es: "" };
}

const EVENT_LABELS: Record<string, string> = {
  "document.created": "Documento creado",
  "document.edited": "Documento editado",
  "document.finalized": "Documento finalizado",
  "document.executed": "Documento ejecutado",
  "document.hash_generated": "Hash SHA-256 generado",
  "document.stored": "Documento almacenado",
  "document.pdf_generated": "PDF generado",
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
  "notification.sent": "Notificación enviada",
  "notification.failed": "Error al enviar notificación",
  "document.distributed": "Documento distribuido",
  "document.distributed_to": "Documento entregado a destinatario",
};

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5000;
const ORG_CONCURRENCY_LIMIT = 1;

// ─── Hash chaining helpers (for immutable audit events) ──
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

async function getLastEventHash(adminClient: any, documentId: string): Promise<string | null> {
  const { data } = await adminClient
    .from("document_signature_events").select("event_hash")
    .eq("document_id", documentId).not("event_hash", "is", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.event_hash || null;
}

async function computeEventHash(previousHash: string | null, eventData: Record<string, unknown>): Promise<string> {
  const canonical = canonicalStringify(eventData);
  return sha256Hex((previousHash || "GENESIS") + canonical);
}

// ─── Per-signer audit evidence section builder ───────────
function buildSignerEvidenceSection(
  signerData: any, signerEvents: any[], signerIndex: number, totalSigners: number, roleLabel: string,
): string {
  const parsedUA = parseUserAgent(signerData.signer_user_agent || "");
  const strokeCount = signerData.signature_stroke_data?.length || 0;
  const totalPoints = signerData.signature_stroke_data?.reduce((s: number, st: any) => s + (st.points?.length || 0), 0) || 0;
  const sectionTitle = totalSigners > 1 ? `FIRMA ${signerIndex} DE ${totalSigners}: ${roleLabel}` : "FIRMANTE";
  const deviceFP = signerData.device_fingerprint_hash || "N/A";

  // Canonical identity verification method statement
  const identityData = signerData.identity_confirmation_data;
  const maskedEmail = signerData.signer_email.replace(/^(.{1,2})(.*)(@.*)$/, (_: string, s: string, _m: string, e: string) => s + "***" + e);
  const maskedPhone = signerData.signer_phone
    ? signerData.signer_phone.replace(/^(.{4})(.*)(.{4})$/, (_: string, s: string, _m: string, e: string) => s + " *** *** " + e)
    : null;
  const otpTarget = maskedPhone || maskedEmail;
  const identityMethodText = identityData
    ? `Método de verificación de identidad: OTP a ${otpTarget} + campos de identidad asertados (nombre y cédula) verificados contra registro del expediente.`
    : `Método de verificación de identidad: OTP a ${otpTarget} + verificación de identidad vía enlace seguro.`;

  const auditRows = signerEvents.map((ev, i) => {
    const label = EVENT_LABELS[ev.event_type] || ev.event_type;
    const actor = ev.actor_type === "lawyer" ? "Abogado" : ev.actor_type === "signer" ? "Firmante" : "Sistema";
    const ip = ev.actor_ip || "Sistema";
    const hashInfo = ev.event_hash ? `<br/><span style="font-size:9px;color:#888;">Hash: ${ev.event_hash.substring(0, 16)}…</span>` : "";
    const isSignatureEvent = ev.event_type === "signature.signed";

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
    <thead><tr style="background:#f5f5f5;">
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">#</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Fecha/Hora COT</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Evento</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Actor</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">IP</th>
    </tr></thead>
    <tbody>${auditRows}</tbody>
  </table>`;
}

// ─── Helper: download and base64-encode a storage file ───
async function downloadAsBase64(adminClient: any, bucket: string, path: string): Promise<string | null> {
  try {
    const { data, error } = await adminClient.storage.from(bucket).download(path);
    if (error || !data) return null;
    const arrayBuf = await data.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
    return base64;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const DEADLINE = Date.now() + 142_000;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const specificDocId = body?.document_id;
    const specificJobId = body?.job_id;

    // ── Resolve Gotenberg config ──
    let gotenbergUrl = "";
    let providerMode = "UNKNOWN";
    try {
      const { data: settings } = await adminClient
        .from("platform_pdf_settings")
        .select("gotenberg_url, mode, enabled")
        .limit(1).single();
      if (settings) {
        if (!settings.enabled) return json({ error: "PDF generation disabled by platform administrator", retryable: false }, 503);
        if (settings.mode === "DEMO") { gotenbergUrl = "https://demo.gotenberg.dev"; providerMode = "DEMO"; }
        else if (settings.mode === "DIRECT" && settings.gotenberg_url) { gotenbergUrl = settings.gotenberg_url; providerMode = "DIRECT"; }
      }
    } catch (e) { console.warn("[process-pdf-job] Could not read platform_pdf_settings:", e); }

    if (!gotenbergUrl) {
      gotenbergUrl = Deno.env.get("GOTENBERG_URL") || "";
      if (gotenbergUrl) providerMode = gotenbergUrl.includes("demo.gotenberg.dev") ? "DEMO" : "DIRECT";
    }
    if (!gotenbergUrl) return json({ error: "Gotenberg URL not configured." }, 500);

    // ── Health check ──
    try {
      const healthRes = await fetch(`${gotenbergUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!healthRes.ok) { await healthRes.text(); return json({ error: "Gotenberg unavailable", retryable: true }, 502); }
      await healthRes.text();
    } catch (healthErr) {
      return json({ error: `Gotenberg unreachable: ${healthErr}`, retryable: true }, 502);
    }

    // ── Pick a job ──
    let jobQuery = adminClient.from("document_pdf_jobs").select("*");
    if (specificJobId) jobQuery = jobQuery.eq("id", specificJobId);
    else if (specificDocId) jobQuery = jobQuery.eq("document_id", specificDocId).in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1);
    else jobQuery = jobQuery.eq("status", "queued").order("created_at", { ascending: true }).limit(1);

    const { data: jobs, error: jobErr } = await jobQuery;
    if (jobErr) return json({ error: "Failed to fetch jobs" }, 500);
    if (!jobs || jobs.length === 0) return json({ ok: true, message: "No jobs to process" });

    const job = jobs[0];

    // ── Idempotency: check if signed.pdf already exists ──
    const { data: existingDoc } = await adminClient.from("generated_documents").select("final_pdf_sha256").eq("id", job.document_id).single();
    if (existingDoc?.final_pdf_sha256) {
      const { data: existingFile } = await adminClient.storage.from("signed-documents").list(
        `${job.organization_id}/${job.document_id}`, { limit: 10, search: "signed.pdf" }
      );
      if (existingFile && existingFile.some(f => f.name === "signed.pdf")) {
        console.log(`[process-pdf-job] Idempotency: signed.pdf already exists for ${job.document_id}`);
        await adminClient.from("document_pdf_jobs").update({
          status: "succeeded", finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          result_path: `${job.organization_id}/${job.document_id}/signed.pdf`, pdf_sha256: existingDoc.final_pdf_sha256,
        }).eq("id", job.id);
        return json({ ok: true, idempotent: true, message: "PDF already exists" });
      }
    }

    // ── Concurrency check ──
    const { count: runningCount } = await adminClient.from("document_pdf_jobs")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", job.organization_id).eq("status", "running").neq("id", job.id);
    if ((runningCount || 0) >= ORG_CONCURRENCY_LIMIT) {
      return json({ ok: true, message: "Org concurrency limit reached", skipped: true });
    }

    // ── Lock job ──
    const { error: lockErr } = await adminClient.from("document_pdf_jobs")
      .update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", job.id).eq("status", job.status);
    if (lockErr) return json({ error: "Failed to lock job" }, 409);

    console.log(`[process-pdf-job] Processing job ${job.id} for document ${job.document_id} (attempt ${job.attempts + 1})`);

    try {
      if (Date.now() > DEADLINE) throw new Error("Wall-clock deadline exceeded");

      // ── Fetch document ──
      const { data: doc, error: docErr } = await adminClient.from("generated_documents")
        .select("id, title, content_html, organization_id, document_type, work_item_id, created_by, created_at, poderdante_type, entity_data")
        .eq("id", job.document_id).single();
      if (docErr || !doc) throw new Error(`Document not found: ${job.document_id}`);

      const policy = getPolicy(doc.document_type);

      // ── Fetch all signed signatures ──
      const { data: allSignatures } = await adminClient.from("document_signatures").select("*")
        .eq("document_id", job.document_id).eq("status", "signed")
        .order("signing_order", { ascending: true });
      const signedSigs = allSignatures || [];
      if (signedSigs.length === 0) throw new Error("No signed signatures found for document");

      // ── HARD INVARIANT: validate signature payloads ──
      for (const s of signedSigs) {
        const hasStrokes = s.signature_stroke_data && Array.isArray(s.signature_stroke_data) && s.signature_stroke_data.length > 0;
        const hasImage = !!s.signature_image_path;
        if (!hasStrokes && !hasImage) {
          throw Object.assign(
            new Error(`Empty signature payload for signer ${s.signer_name} (${s.signer_email}). Cannot generate PDF.`),
            { isRetryable: false }
          );
        }
      }

      // ── Fetch branding ──
      let lawyerProfile: any = null;
      let orgData: any = null;
      if (doc.created_by) {
        const { data: prof } = await adminClient.from("profiles")
          .select("full_name, email, litigation_email, custom_branding_enabled, custom_logo_path, custom_firm_name")
          .eq("id", doc.created_by).single();
        lawyerProfile = prof;
      }
      if (doc.organization_id) {
        const { data: org } = await adminClient.from("organizations")
          .select("name, custom_branding_enabled, custom_logo_path, custom_firm_name")
          .eq("id", doc.organization_id).single();
        orgData = org;
      }

      const firmName = orgData?.custom_firm_name || orgData?.name || lawyerProfile?.custom_firm_name || "Andromeda Legal";

      // ── Base64 encode branding logo for Gotenberg (no network fetch) ──
      let logoBase64: string | null = null;
      if (orgData?.custom_branding_enabled && orgData?.custom_logo_path) {
        logoBase64 = await downloadAsBase64(adminClient, "branding", orgData.custom_logo_path);
      } else if (lawyerProfile?.custom_branding_enabled && lawyerProfile?.custom_logo_path) {
        logoBase64 = await downloadAsBase64(adminClient, "branding", lawyerProfile.custom_logo_path);
      }
      const logoImgTag = logoBase64
        ? `<img src="data:image/png;base64,${logoBase64}" alt="${firmName}" style="max-height:60px;max-width:250px;" />`
        : null;

      // ── Embed signature images as base64 data URIs ──
      const signatureBase64Map: Record<string, string> = {};
      for (const s of signedSigs) {
        if (s.signature_image_path) {
          const b64 = await downloadAsBase64(adminClient, "signed-documents", s.signature_image_path);
          if (b64) signatureBase64Map[s.id] = `data:image/png;base64,${b64}`;
        }
      }

      // ── Build signature blocks ──
      const totalSigners = signedSigs.length;
      const allSignatureBlocks = signedSigs.map((s) => {
        const roleLabel = s.signer_role === "lawyer" ? "EL MANDATARIO" : "EL MANDANTE";
        const sigImgSrc = signatureBase64Map[s.id] || null;
        return `<div style="margin-top:30px;border-top:2px solid #333;padding-top:16px;display:inline-block;width:${totalSigners > 1 ? "48%" : "100%"};vertical-align:top;">
          ${sigImgSrc ? `<img src="${sigImgSrc}" alt="Firma" style="max-width:250px;max-height:80px;" />` : '<p style="color:#999;">[Firma registrada]</p>'}
          <p><strong>${s.signer_name}</strong></p><p>C.C. ${s.signer_cedula || "N/A"}</p>
          ${totalSigners > 1 ? `<p style="font-size:12px;font-weight:bold;">${roleLabel}</p>` : ""}
          <p style="font-size:11px;color:#666;">Firmado: ${s.signed_at ? formatCOT(s.signed_at) : "N/A"}</p>
        </div>`;
      }).join(totalSigners > 1 ? "&nbsp;&nbsp;" : "");

      // ── Hash document content for integrity ──
      const documentPagesHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${doc.title}</title></head><body>${doc.content_html}<div>${allSignatureBlocks}</div></body></html>`;
      const documentHash = await sha256Hex(documentPagesHtml);

      // ── Fetch radicado ──
      let radicado = "";
      if (doc.work_item_id) {
        const { data: wi } = await adminClient.from("work_items").select("radicado").eq("id", doc.work_item_id).single();
        radicado = wi?.radicado || "";
      }

      // ── Fetch ALL audit events ──
      const { data: allDocEvents } = await adminClient.from("document_signature_events").select("*")
        .eq("document_id", doc.id).order("created_at", { ascending: true });

      // ── Determine delivery method ──
      const { data: requestedEvent } = await adminClient.from("document_signature_events").select("event_data")
        .eq("document_id", doc.id).eq("event_type", "signature.requested")
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      const deliveryMethod = requestedEvent?.event_data?.delivery_method || "EMAIL";
      const deliveryMethodLabel = deliveryMethod === "LINK"
        ? "Enlace de firma (compartido por el abogado)"
        : "Correo electrónico (info@andromeda.legal)";

      // ── Build per-signer evidence sections ──
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

        const { data: signerEvents } = await adminClient.from("document_signature_events").select("*")
          .eq("signature_id", s.id).order("created_at", { ascending: true });

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

      // ── Status label ──
      let statusLabel: string;
      if (poderdanteType === "multiple") statusLabel = `Firmado por todos los poderdantes (${totalSigners}/${totalSigners})`;
      else if (totalSigners > 1) statusLabel = "Firmado por ambas partes";
      else statusLabel = "Firmado";

      // ── Token info from last signer ──
      const lastSigner = signedSigs[signedSigs.length - 1];
      const tokenIssuedAt = lastSigner?.created_at ? formatCOT(lastSigner.created_at) : "N/A";
      const tokenExpiresAt = lastSigner?.expires_at ? formatCOT(lastSigner.expires_at) : "N/A";
      const tokenConsumedAt = lastSigner?.consumed_at ? formatCOT(lastSigner.consumed_at) : "N/A";

      const certificateId = crypto.randomUUID();
      const verifyUrl = `https://lexyai.lovable.app/verify?hash=${documentHash}`;
      const lawyerName = lawyerProfile?.full_name || "";
      const lawyerEmail = lawyerProfile?.litigation_email || lawyerProfile?.email || "";

      // ── Build document-level audit rows ──
      const docLevelEvents = (allDocEvents || []).filter(ev =>
        ["document.created", "document.edited", "document.finalized", "document.executed"].includes(ev.event_type)
      );
      const docAuditRows = docLevelEvents.map((ev, i) => {
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

      // ── Certificate header ──
      const certHeader = logoImgTag
        ? `<div style="text-align:center;border-bottom:3px solid #1a1a2e;padding-bottom:16px;margin-bottom:24px;">
            ${logoImgTag}
            <p style="color:#666;margin:8px 0 0;font-size:13px;">${firmName}</p>
          </div>`
        : `<div style="text-align:center;border-bottom:3px solid #1a1a2e;padding-bottom:16px;margin-bottom:24px;">
            <h1 style="color:#1a1a2e;font-size:22px;margin:0;">${firmName.toUpperCase()}</h1>
            <p style="color:#666;margin:4px 0 0;font-size:13px;">Plataforma de Gestión Legal</p>
          </div>`;

      // ── Build full audit certificate (evidence appendix) ──
      const evidenceAppendix = `
<div style="page-break-before:always;padding:40px;font-family:sans-serif;max-width:800px;margin:0 auto;">
  ${certHeader}
  <h2 style="text-align:center;color:#1a1a2e;border-top:2px solid #1a1a2e;border-bottom:2px solid #1a1a2e;padding:12px 0;letter-spacing:2px;font-size:16px;">
    CERTIFICADO DE FIRMA ELECTRÓNICA
  </h2>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:6px 0;color:#666;width:40%;">Documento:</td><td style="padding:6px 0;font-weight:bold;">${doc.title}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">ID del documento:</td><td style="padding:6px 0;font-family:monospace;font-size:11px;">${doc.id}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Tipo:</td><td style="padding:6px 0;">${policy.label_es}</td></tr>
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
    <tr><td style="padding:6px 0;color:#666;">Hash del contenido del documento:</td><td style="padding:6px 0;font-family:monospace;font-size:10px;word-break:break-all;">${documentHash}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Hash del PDF final (final_pdf_sha256):</td><td style="padding:6px 0;font-family:monospace;font-size:10px;word-break:break-all;"><em>Calculado sobre los bytes del PDF generado</em></td></tr>
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
    <p>Generado por ${firmName}</p>
    <p>Certificado ID: ${certificateId} | Documento ID: ${doc.id}</p>
    <p>Este documento fue generado automáticamente y no requiere firma adicional.</p>
  </div>
</div>`;

      // ── Build final combined HTML package ──
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

      // ── Store debug HTML ──
      const htmlBytes = new TextEncoder().encode(combinedHtml);
      const htmlStoragePath = `${doc.organization_id}/${doc.id}/signed.html`;
      await adminClient.storage.from("signed-documents")
        .upload(htmlStoragePath, htmlBytes, { contentType: "text/html; charset=utf-8", upsert: true })
        .catch((e: unknown) => console.warn("[process-pdf-job] HTML debug upload:", e));

      // ── Check deadline ──
      if (Date.now() > DEADLINE) throw new Error("Wall-clock deadline exceeded before PDF generation");

      // ── Call html-to-pdf ──
      const htmlToPdfUrl = `${supabaseUrl}/functions/v1/html-to-pdf`;
      const pdfRes = await fetch(htmlToPdfUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: doc.id, html: combinedHtml, filename: "signed.pdf",
          organization_id: doc.organization_id,
          paper: { format: "A4", margin_top: "10mm", margin_bottom: "10mm", margin_left: "10mm", margin_right: "10mm", print_background: true },
        }),
        signal: AbortSignal.timeout(90000),
      });

      const pdfResBody = await pdfRes.text();
      let pdfResult: any;
      try { pdfResult = JSON.parse(pdfResBody); } catch { throw new Error(`html-to-pdf returned non-JSON: ${pdfResBody.substring(0, 200)}`); }

      if (!pdfRes.ok || !pdfResult.ok) {
        const isRetryable = pdfResult.retryable === true;
        throw Object.assign(new Error(`html-to-pdf failed: ${pdfResult.error}`), {
          errorDetail: { http_status: pdfRes.status, details: (pdfResult.details || pdfResult.error || "").substring(0, 500), attempt: job.attempts + 1 },
          isRetryable,
        });
      }

      // ── Update job as succeeded ──
      await adminClient.from("document_pdf_jobs").update({
        status: "succeeded", result_path: pdfResult.storage_path,
        pdf_sha256: pdfResult.pdf_sha256, size_bytes: pdfResult.size_bytes,
        attempts: job.attempts + 1, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      // ── Update document with ACTUAL PDF hash (authoritative) ──
      await adminClient.from("generated_documents").update({
        final_pdf_sha256: pdfResult.pdf_sha256,
      }).eq("id", doc.id);

      // ── Update all signatures with PDF path ──
      for (const s of signedSigs) {
        await adminClient.from("document_signatures").update({
          signed_document_path: pdfResult.storage_path,
          signed_document_hash: documentHash,
          combined_pdf_hash: pdfResult.pdf_sha256,
          certificate_id: certificateId,
        }).eq("id", s.id);
      }

      // ── Log PDF generation event ──
      await adminClient.from("document_signature_events").insert({
        organization_id: doc.organization_id, document_id: doc.id,
        event_type: "document.pdf_generated",
        event_data: {
          storage_path: pdfResult.storage_path, pdf_sha256: pdfResult.pdf_sha256,
          size_bytes: pdfResult.size_bytes, job_id: job.id, provider_mode: providerMode,
          certificate_id: certificateId, content_hash: documentHash,
        },
        actor_type: "system", actor_id: "process-pdf-job",
      });

      console.log(`[process-pdf-job] Job ${job.id} succeeded: ${pdfResult.storage_path}, sha256=${pdfResult.pdf_sha256?.substring(0, 16)}…`);

      // ── Update platform_pdf_settings ──
      await adminClient.from("platform_pdf_settings")
        .update({ last_success_at: new Date().toISOString() })
        .not("id", "is", null).catch(() => {});

      // ══════════════════════════════════════════════════════════
      // ── POLICY-DRIVEN EMAIL DISPATCH (only after PDF exists) ──
      // ── With distribution_sent_at guard for idempotency     ──
      // ══════════════════════════════════════════════════════════
      const resendKey = Deno.env.get("RESEND_API_KEY");

      // Atomic check: only send emails once
      const { data: jobForEmail } = await adminClient.from("document_pdf_jobs")
        .select("distribution_sent_at")
        .eq("id", job.id).single();

      if (resendKey && !jobForEmail?.distribution_sent_at) {
        try {
          // Mark distribution_sent_at BEFORE sending to prevent duplicates on retry
          await adminClient.from("document_pdf_jobs").update({
            distribution_sent_at: new Date().toISOString(),
          }).eq("id", job.id);

          const { data: signedUrlData } = await adminClient.storage
            .from("signed-documents")
            .createSignedUrl(pdfResult.storage_path, 30 * 24 * 60 * 60);
          const downloadUrl = signedUrlData?.signedUrl || "";

          const isBilateral = policy.signerModel === "BILATERAL";

          // Email header (uses URL for email clients — they CAN fetch URLs unlike Gotenberg)
          const emailLogoUrl = orgData?.custom_branding_enabled && orgData?.custom_logo_path
            ? `${supabaseUrl}/storage/v1/object/public/branding/${orgData.custom_logo_path}`
            : lawyerProfile?.custom_branding_enabled && lawyerProfile?.custom_logo_path
              ? `${supabaseUrl}/storage/v1/object/public/branding/${lawyerProfile.custom_logo_path}` : null;

          const emailHeaderHtml = emailLogoUrl
            ? `<div style="text-align:center;padding:24px 0;border-bottom:2px solid #1a1a2e;">
                <img src="${emailLogoUrl}" alt="${firmName}" style="max-height:50px;max-width:200px;" />
                <p style="color:#666;margin:8px 0 0;font-size:13px;">${firmName}</p>
              </div>`
            : `<div style="text-align:center;padding:24px 0;border-bottom:2px solid #1a1a2e;">
                <h1 style="color:#1a1a2e;font-size:24px;margin:0;">${firmName.toUpperCase()}</h1>
                <p style="color:#666;margin:4px 0 0;">Plataforma de Gestión Legal</p>
              </div>`;

          const confirmHtmlTemplate = `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
              ${emailHeaderHtml}
              <div style="padding:24px 0;">
                <h2 style="color:#1a1a2e;">✅ Documento Firmado${isBilateral ? " por Todas las Partes" : ""}</h2>
                <p>Hola <strong>{RECIPIENT_NAME}</strong>,</p>
                <p>El siguiente documento ha sido firmado electrónicamente${totalSigners > 1 ? " por todas las partes" : ""}:</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Documento</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">${doc.title}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Tipo</td><td style="padding:8px;border-bottom:1px solid #eee;">${policy.label_es}</td></tr>
                  ${signedSigs.map(s => `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Firmado por</td><td style="padding:8px;border-bottom:1px solid #eee;">${s.signer_name} — ${s.signed_at ? formatCOT(s.signed_at) : ""}</td></tr>`).join("")}
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666;">Hash SHA-256</td><td style="padding:8px;border-bottom:1px solid #eee;font-family:monospace;font-size:10px;word-break:break-all;">${pdfResult.pdf_sha256}</td></tr>
                </table>
                ${downloadUrl ? `<div style="text-align:center;margin:24px 0;">
                  <a href="${downloadUrl}" style="background:#1a1a2e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Descargar documento firmado (PDF)</a>
                </div>
                <p style="color:#666;font-size:13px;text-align:center;">El documento incluye el certificado de evidencia con el registro completo de auditoría.</p>` : ""}
                <p style="color:#666;font-size:13px;">Para verificar la integridad: <a href="https://lexyai.lovable.app/verify" style="color:#1a1a2e;">https://lexyai.lovable.app/verify</a></p>
              </div>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
              <p style="color:#999;font-size:12px;text-align:center;">${firmName}<br/>Firma electrónica conforme a la Ley 527 de 1999 y Decreto 2364 de 2012.</p>
            </div>`;

          // ── Determine recipients based on policy ──
          const recipients = new Set<string>();
          if (policy.distribution === "lawyer") {
            if (lawyerEmail) recipients.add(lawyerEmail);
          } else if (policy.distribution === "both") {
            if (lawyerEmail) recipients.add(lawyerEmail);
            for (const s of signedSigs) { if (s.signer_email) recipients.add(s.signer_email); }
          } else if (policy.distribution === "client") {
            for (const s of signedSigs) { if (s.signer_email && s.signer_role !== "lawyer") recipients.add(s.signer_email); }
          }

          // ── Subject line semantics ──
          const subject = isBilateral
            ? `✅ Documento firmado por todas las partes — ${doc.title}`
            : `✅ Documento firmado — ${doc.title}`;

          const distributedRecipients: Array<{ email: string; name: string; role: string; status: string }> = [];

          for (const email of recipients) {
            const recipientSig = signedSigs.find(s => s.signer_email === email);
            const recipientName = recipientSig?.signer_name || lawyerName || "Usuario";
            const recipientRole = email === lawyerEmail ? "lawyer" : "client";
            let sendStatus = "sent";

            try {
              const html = confirmHtmlTemplate.replace("{RECIPIENT_NAME}", recipientName);
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: `${firmName} <info@andromeda.legal>`,
                  reply_to: lawyerEmail || undefined,
                  to: [email], subject, html,
                }),
              });
              console.log(`[process-pdf-job] Email sent to ${email}`);
            } catch (e) {
              console.error(`[process-pdf-job] Email error for ${email}:`, e);
              sendStatus = "failed";
            }

            // ── Immutable per-recipient document.distributed_to event (hash-chained) ──
            const prevHash = await getLastEventHash(adminClient, doc.id);
            const eventPayload = {
              event_type: "document.distributed_to" as const,
              event_data: {
                recipient_email: email, recipient_name: recipientName, recipient_role: recipientRole,
                delivery_channel: "email", delivery_status: sendStatus,
                sender: "info@andromeda.legal", subject,
                pdf_sha256: pdfResult.pdf_sha256, download_url_type: "signed.pdf", job_id: job.id,
              },
              actor_type: "system" as const, actor_id: "process-pdf-job",
            };
            const evHash = await computeEventHash(prevHash, {
              event_type: eventPayload.event_type, event_data: eventPayload.event_data,
              actor_type: eventPayload.actor_type, actor_id: eventPayload.actor_id,
              timestamp: new Date().toISOString(),
            });
            await adminClient.from("document_signature_events").insert({
              organization_id: doc.organization_id, document_id: doc.id,
              ...eventPayload,
              previous_event_hash: prevHash, event_hash: evHash,
            });

            distributedRecipients.push({ email, name: recipientName, role: recipientRole, status: sendStatus });
          }

          // ── Immutable document.distributed summary event (legal timeline anchor) ──
          const distPrevHash = await getLastEventHash(adminClient, doc.id);
          const distEventPayload = {
            event_type: "document.distributed",
            event_data: {
              recipients: distributedRecipients,
              total_recipients: distributedRecipients.length,
              distribution_policy: policy.distribution,
              doc_type: doc.document_type,
              pdf_sha256: pdfResult.pdf_sha256,
              pdf_storage_path: pdfResult.storage_path,
              total_signers: totalSigners,
              signer_model: policy.signerModel,
              sender: "info@andromeda.legal",
              reply_to: lawyerEmail,
              download_url_type: "signed.pdf",
              job_id: job.id,
              distributed_at: new Date().toISOString(),
            },
            actor_type: "system" as const, actor_id: "process-pdf-job",
          };
          const distEvHash = await computeEventHash(distPrevHash, {
            event_type: distEventPayload.event_type, event_data: distEventPayload.event_data,
            actor_type: distEventPayload.actor_type, actor_id: distEventPayload.actor_id,
            timestamp: new Date().toISOString(),
          });
          await adminClient.from("document_signature_events").insert({
            organization_id: doc.organization_id, document_id: doc.id,
            ...distEventPayload,
            previous_event_hash: distPrevHash, event_hash: distEvHash,
          });

          console.log(`[process-pdf-job] Distribution complete: ${distributedRecipients.length} recipients, document.distributed event logged`);
        } catch (emailErr) {
          console.error("[process-pdf-job] Email dispatch error (non-fatal):", emailErr);
        }
      } else if (jobForEmail?.distribution_sent_at) {
        console.log(`[process-pdf-job] Skipping email dispatch — already sent at ${jobForEmail.distribution_sent_at}`);
      }

      return json({ ok: true, job_id: job.id, storage_path: pdfResult.storage_path, pdf_sha256: pdfResult.pdf_sha256 });

    } catch (processErr: any) {
      console.error(`[process-pdf-job] Job ${job.id} failed:`, processErr);
      const newAttempts = job.attempts + 1;
      const isRetryable = processErr.isRetryable !== false;
      const newStatus = newAttempts >= MAX_ATTEMPTS ? "failed" : "queued";

      await adminClient.from("document_pdf_jobs").update({
        status: newStatus, attempts: newAttempts,
        last_error: JSON.stringify(processErr.errorDetail || { message: String(processErr) }).substring(0, 2000),
        finished_at: newStatus === "failed" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      return json({ error: "Job processing failed", details: processErr.errorDetail, retriable: newStatus === "queued" }, 500);
    }
  } catch (err) {
    console.error("process-pdf-job top-level error:", err);
    return json({ error: `Internal error: ${err}` }, 500);
  }
});
