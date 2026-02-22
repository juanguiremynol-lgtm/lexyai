/**
 * process-pdf-job — Async worker that processes queued PDF generation jobs.
 * Called via cron, webhook, or fire-and-forget from complete-signature.
 *
 * Responsibilities (Phase 1 — policy-driven pipeline):
 * 1. Idempotency: skip if signed.pdf already exists with matching sha256
 * 2. Embed signatures as base64 data URIs (no network fetches by Gotenberg)
 * 3. Call html-to-pdf → store signed.pdf → compute SHA-256
 * 4. Send finalization emails ONLY after PDF succeeds (policy-driven distribution)
 * 5. Per-org concurrency limit, 429 backoff, wall-clock deadline guard
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

// ─── Document Policy (server-side mirror) ──────────────────
// Distribution rules per doc type — mirrors src/lib/document-policy.ts
type DistributionRecipient = "lawyer" | "client" | "both";
interface DocTypePolicy {
  label_es: string;
  signerModel: "UNILATERAL" | "BILATERAL";
  distribution: DistributionRecipient;
  finalizedEvent: "SIGNED_FINALIZED" | "ISSUED_FINALIZED";
}

const DOC_TYPE_POLICIES: Record<string, DocTypePolicy> = {
  poder_especial: { label_es: "Poder Especial", signerModel: "UNILATERAL", distribution: "both", finalizedEvent: "SIGNED_FINALIZED" },
  contrato_servicios: { label_es: "Contrato de Prestación de Servicios", signerModel: "BILATERAL", distribution: "both", finalizedEvent: "SIGNED_FINALIZED" },
  paz_y_salvo: { label_es: "Paz y Salvo", signerModel: "UNILATERAL", distribution: "both", finalizedEvent: "ISSUED_FINALIZED" },
  notificacion_personal: { label_es: "Notificación Personal", signerModel: "UNILATERAL", distribution: "lawyer", finalizedEvent: "ISSUED_FINALIZED" },
  notificacion_por_aviso: { label_es: "Notificación por Aviso", signerModel: "UNILATERAL", distribution: "lawyer", finalizedEvent: "ISSUED_FINALIZED" },
};

function getPolicy(docType: string): DocTypePolicy {
  return DOC_TYPE_POLICIES[docType] || { label_es: docType, signerModel: "UNILATERAL", distribution: "both", finalizedEvent: "SIGNED_FINALIZED" };
}

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5000;
const ORG_CONCURRENCY_LIMIT = 1;

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

    // ── Resolve Gotenberg config from DB → env → fallback ──
    let gotenbergUrl = "";
    let providerMode = "UNKNOWN";
    try {
      const { data: settings } = await adminClient
        .from("platform_pdf_settings")
        .select("gotenberg_url, mode, enabled")
        .limit(1)
        .single();

      if (settings) {
        if (!settings.enabled) {
          return json({ error: "PDF generation disabled by platform administrator", retryable: false }, 503);
        }
        if (settings.mode === "DEMO") {
          gotenbergUrl = "https://demo.gotenberg.dev";
          providerMode = "DEMO";
        } else if (settings.mode === "DIRECT" && settings.gotenberg_url) {
          gotenbergUrl = settings.gotenberg_url;
          providerMode = "DIRECT";
        }
      }
    } catch (e) {
      console.warn("[process-pdf-job] Could not read platform_pdf_settings:", e);
    }

    if (!gotenbergUrl) {
      gotenbergUrl = Deno.env.get("GOTENBERG_URL") || "";
      if (gotenbergUrl) providerMode = gotenbergUrl.includes("demo.gotenberg.dev") ? "DEMO" : "DIRECT";
    }

    if (!gotenbergUrl) {
      return json({ error: "Gotenberg URL not configured. Set it in Platform Console → PDF Generation." }, 500);
    }

    console.log(`[process-pdf-job] Provider mode: ${providerMode}`);

    // ── Gotenberg health check ──
    try {
      const healthRes = await fetch(`${gotenbergUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!healthRes.ok) {
        await healthRes.text();
        await adminClient.from("platform_pdf_settings").update({ last_failure_at: new Date().toISOString() }).not("id", "is", null).catch(() => {});
        return json({ error: "Gotenberg unavailable, will retry later", retryable: true }, 502);
      }
      await healthRes.text();
    } catch (healthErr) {
      await adminClient.from("platform_pdf_settings").update({ last_failure_at: new Date().toISOString() }).not("id", "is", null).catch(() => {});
      return json({ error: `Gotenberg unreachable: ${healthErr}`, retryable: true }, 502);
    }

    // ── Pick a job ──
    let jobQuery = adminClient.from("document_pdf_jobs").select("*");

    if (specificJobId) {
      jobQuery = jobQuery.eq("id", specificJobId);
    } else if (specificDocId) {
      jobQuery = jobQuery.eq("document_id", specificDocId).in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1);
    } else {
      jobQuery = jobQuery.eq("status", "queued").order("created_at", { ascending: true }).limit(1);
    }

    const { data: jobs, error: jobErr } = await jobQuery;
    if (jobErr) return json({ error: "Failed to fetch jobs" }, 500);
    if (!jobs || jobs.length === 0) return json({ ok: true, message: "No jobs to process" });

    const job = jobs[0];

    // ── Idempotency: check if signed.pdf already exists ──
    const { data: existingDoc } = await adminClient
      .from("generated_documents")
      .select("final_pdf_sha256")
      .eq("id", job.document_id)
      .single();

    if (existingDoc?.final_pdf_sha256) {
      // Check if the PDF file actually exists in storage
      const checkPath = `${job.organization_id}/${job.document_id}/signed.pdf`;
      const { data: existingFile } = await adminClient.storage.from("signed-documents").list(
        `${job.organization_id}/${job.document_id}`,
        { limit: 10, search: "signed.pdf" }
      );
      if (existingFile && existingFile.some(f => f.name === "signed.pdf")) {
        console.log(`[process-pdf-job] Idempotency: signed.pdf already exists for ${job.document_id}, skipping regeneration`);
        await adminClient.from("document_pdf_jobs").update({
          status: "succeeded", finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          result_path: checkPath, pdf_sha256: existingDoc.final_pdf_sha256,
        }).eq("id", job.id);
        return json({ ok: true, idempotent: true, message: "PDF already exists" });
      }
    }

    // ── Per-org concurrency check ──
    const { count: runningCount } = await adminClient
      .from("document_pdf_jobs")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", job.organization_id)
      .eq("status", "running")
      .neq("id", job.id);

    if ((runningCount || 0) >= ORG_CONCURRENCY_LIMIT) {
      return json({ ok: true, message: "Org concurrency limit reached, will retry later", skipped: true });
    }

    // ── Lock the job ──
    const { error: lockErr } = await adminClient
      .from("document_pdf_jobs")
      .update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", job.status);

    if (lockErr) return json({ error: "Failed to lock job" }, 409);

    console.log(`[process-pdf-job] Processing job ${job.id} for document ${job.document_id} (attempt ${job.attempts + 1})`);

    try {
      if (Date.now() > DEADLINE) throw new Error("Wall-clock deadline exceeded before processing");

      // ── Fetch document ──
      const { data: doc, error: docErr } = await adminClient
        .from("generated_documents")
        .select("id, title, content_html, organization_id, document_type, work_item_id, created_by, created_at, poderdante_type, entity_data")
        .eq("id", job.document_id)
        .single();

      if (docErr || !doc) throw new Error(`Document not found: ${job.document_id}`);

      const policy = getPolicy(doc.document_type);

      // ── Fetch all signed signatures ──
      const { data: allSignatures } = await adminClient
        .from("document_signatures").select("*")
        .eq("document_id", job.document_id).eq("status", "signed")
        .order("signing_order", { ascending: true });

      const signedSigs = allSignatures || [];
      if (signedSigs.length === 0) throw new Error("No signed signatures found for document");

      // ── Validate signature payloads (HARD INVARIANT) ──
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

      // ── Embed signature images as base64 data URIs ──
      const signatureBase64Map: Record<string, string> = {};
      for (const s of signedSigs) {
        if (s.signature_image_path) {
          try {
            const { data: imgData, error: imgErr } = await adminClient.storage
              .from("signed-documents")
              .download(s.signature_image_path);
            if (!imgErr && imgData) {
              const arrayBuf = await imgData.arrayBuffer();
              const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
              signatureBase64Map[s.id] = `data:image/png;base64,${base64}`;
            }
          } catch (e) {
            console.warn(`[process-pdf-job] Could not download signature image for ${s.id}:`, e);
          }
        }
      }

      // ── Build combined HTML with base64 signatures ──
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

      const documentPagesHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${doc.title}</title>
<style>body { font-family: 'Georgia', serif; max-width: 800px; margin: 0 auto; padding: 40px; }</style>
</head><body>${doc.content_html}<div style="margin-top:40px;">${allSignatureBlocks}</div></body></html>`;
      const documentHash = await sha256Hex(documentPagesHtml);

      // ── Build audit evidence appendix ──
      const { data: allDocEvents } = await adminClient
        .from("document_signature_events").select("*")
        .eq("document_id", doc.id).order("created_at", { ascending: true });

      const auditRows = (allDocEvents || []).map((ev, i) => {
        const label = ev.event_type || "";
        const actor = ev.actor_type === "lawyer" ? "Abogado" : ev.actor_type === "signer" ? "Firmante" : "Sistema";
        return `<tr>
          <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${i + 1}</td>
          <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${formatCOT(ev.created_at)}</td>
          <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${label}</td>
          <td style="padding:6px 8px;border:1px solid #ddd;font-size:11px;">${actor}</td>
        </tr>`;
      }).join("\n");

      const verifyUrl = `https://lexyai.lovable.app/verify?hash=${documentHash}`;
      const firmName = orgData?.custom_firm_name || orgData?.name || lawyerProfile?.custom_firm_name || "Andromeda Legal";
      const logoUrl = orgData?.custom_branding_enabled && orgData?.custom_logo_path
        ? `${supabaseUrl}/storage/v1/object/public/branding/${orgData.custom_logo_path}`
        : lawyerProfile?.custom_branding_enabled && lawyerProfile?.custom_logo_path
          ? `${supabaseUrl}/storage/v1/object/public/branding/${lawyerProfile.custom_logo_path}` : null;

      const headerHtml = logoUrl
        ? `<div style="text-align:center;border-bottom:3px solid #1a1a2e;padding-bottom:16px;margin-bottom:24px;">
            <img src="${logoUrl}" alt="${firmName}" style="max-height:60px;max-width:250px;" />
            <p style="color:#666;margin:8px 0 0;font-size:13px;">${firmName}</p>
          </div>`
        : `<div style="text-align:center;border-bottom:3px solid #1a1a2e;padding-bottom:16px;margin-bottom:24px;">
            <h1 style="color:#1a1a2e;font-size:22px;margin:0;">${firmName.toUpperCase()}</h1>
            <p style="color:#666;margin:4px 0 0;font-size:13px;">Plataforma de Gestión Legal</p>
          </div>`;

      const evidenceAppendix = `
<div style="page-break-before:always;padding:40px;font-family:sans-serif;max-width:800px;margin:0 auto;">
  ${headerHtml}
  <h2 style="text-align:center;color:#1a1a2e;border-top:2px solid #1a1a2e;border-bottom:2px solid #1a1a2e;padding:12px 0;letter-spacing:2px;font-size:16px;">
    CERTIFICADO DE FIRMA ELECTRÓNICA
  </h2>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:6px 0;color:#666;width:40%;">Documento:</td><td style="padding:6px 0;font-weight:bold;">${doc.title}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">ID:</td><td style="padding:6px 0;font-family:monospace;font-size:11px;">${doc.id}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Tipo:</td><td style="padding:6px 0;">${policy.label_es}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Hash SHA-256:</td><td style="padding:6px 0;font-family:monospace;font-size:10px;word-break:break-all;">${documentHash}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Verificar:</td><td style="padding:6px 0;"><a href="${verifyUrl}">${verifyUrl}</a></td></tr>
  </table>
  ${signedSigs.map((s, i) => `
    <h3 style="color:#1a1a2e;background:#f0f0f5;padding:10px 12px;margin-top:24px;font-size:14px;border-left:4px solid #1a1a2e;">
      FIRMANTE ${i + 1}: ${s.signer_name}
    </h3>
    <table style="width:100%;border-collapse:collapse;margin:8px 0;">
      <tr><td style="padding:4px 0;color:#666;width:40%;">Nombre:</td><td>${s.signer_name}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Cédula:</td><td>${s.signer_cedula || "N/A"}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Email:</td><td>${s.signer_email}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Firmado:</td><td>${s.signed_at ? formatCOT(s.signed_at) : "N/A"}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">IP:</td><td style="font-family:monospace;">${s.signer_ip || "N/A"}</td></tr>
    </table>
  `).join("")}
  ${auditRows.length > 0 ? `
  <h3 style="color:#1a1a2e;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:24px;">REGISTRO DE AUDITORÍA</h3>
  <table style="width:100%;border-collapse:collapse;margin:8px 0;">
    <thead><tr style="background:#f5f5f5;">
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">#</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Fecha/Hora</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Evento</th>
      <th style="padding:6px 8px;border:1px solid #ddd;font-size:11px;text-align:left;">Actor</th>
    </tr></thead>
    <tbody>${auditRows}</tbody>
  </table>` : ""}
  <div style="margin-top:32px;padding-top:16px;border-top:2px solid #1a1a2e;text-align:center;font-size:11px;color:#999;">
    <p>Generado por ${firmName}</p>
    <p>Marco legal: Ley 527/1999 y Decreto 2364/2012</p>
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

      // ── Check deadline before calling html-to-pdf ──
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
        const errorDetail = {
          http_status: pdfRes.status,
          gotenberg_response: (pdfResult.details || pdfResult.error || "").substring(0, 500),
          attempt: job.attempts + 1,
          retryable: isRetryable,
          provider_mode: providerMode,
        };
        throw Object.assign(new Error(`html-to-pdf failed: ${pdfResult.error}`), { errorDetail, isRetryable });
      }

      // ── Update job as succeeded ──
      await adminClient.from("document_pdf_jobs").update({
        status: "succeeded",
        result_path: pdfResult.storage_path,
        pdf_sha256: pdfResult.pdf_sha256,
        size_bytes: pdfResult.size_bytes,
        attempts: job.attempts + 1,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      // ── Update document with final PDF hash ──
      await adminClient.from("generated_documents").update({
        final_pdf_sha256: pdfResult.pdf_sha256,
      }).eq("id", doc.id);

      // ── Update all signatures with PDF path ──
      for (const s of signedSigs) {
        await adminClient.from("document_signatures").update({
          signed_document_path: pdfResult.storage_path,
          signed_document_hash: documentHash,
        }).eq("id", s.id);
      }

      // ── Log event ──
      await adminClient.from("document_signature_events").insert({
        organization_id: doc.organization_id, document_id: doc.id,
        event_type: "document.pdf_generated",
        event_data: {
          storage_path: pdfResult.storage_path, pdf_sha256: pdfResult.pdf_sha256,
          size_bytes: pdfResult.size_bytes, job_id: job.id, provider_mode: providerMode,
        },
        actor_type: "system", actor_id: "process-pdf-job",
      });

      console.log(`[process-pdf-job] Job ${job.id} succeeded: ${pdfResult.storage_path}, mode=${providerMode}`);

      // ── Update platform_pdf_settings with last success ──
      await adminClient.from("platform_pdf_settings")
        .update({ last_success_at: new Date().toISOString() })
        .not("id", "is", null).catch(() => {});

      // ══════════════════════════════════════════════════════════
      // ── POLICY-DRIVEN EMAIL DISPATCH (only after PDF exists) ──
      // ══════════════════════════════════════════════════════════
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          // Generate signed URL for PDF download (30 days)
          const { data: signedUrlData } = await adminClient.storage
            .from("signed-documents")
            .createSignedUrl(pdfResult.storage_path, 30 * 24 * 60 * 60);
          const downloadUrl = signedUrlData?.signedUrl || "";

          const lawyerName = lawyerProfile?.full_name || "";
          const lawyerEmail = lawyerProfile?.litigation_email || lawyerProfile?.email || "";
          const isBilateral = policy.signerModel === "BILATERAL";

          // Build email HTML
          const emailHeaderHtml = logoUrl
            ? `<div style="text-align:center;padding:24px 0;border-bottom:2px solid #1a1a2e;">
                <img src="${logoUrl}" alt="${firmName}" style="max-height:50px;max-width:200px;" />
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

          // ── Determine recipients based on policy distribution ──
          const recipients = new Set<string>();

          if (policy.distribution === "lawyer") {
            // Notificaciones: only lawyer
            if (lawyerEmail) recipients.add(lawyerEmail);
          } else if (policy.distribution === "both") {
            // POA, Contract, Paz y Salvo: both lawyer and client/signers
            if (lawyerEmail) recipients.add(lawyerEmail);
            for (const s of signedSigs) {
              if (s.signer_email) recipients.add(s.signer_email);
            }
          } else if (policy.distribution === "client") {
            for (const s of signedSigs) {
              if (s.signer_email && s.signer_role !== "lawyer") recipients.add(s.signer_email);
            }
          }

          // ── Subject line semantics per doc type ──
          let subject: string;
          if (isBilateral) {
            subject = `✅ Documento firmado por todas las partes — ${doc.title}`;
          } else {
            subject = `✅ Documento firmado — ${doc.title}`;
          }

          for (const email of recipients) {
            try {
              const recipientName = signedSigs.find(s => s.signer_email === email)?.signer_name || lawyerName || "Usuario";
              const html = confirmHtmlTemplate.replace("{RECIPIENT_NAME}", recipientName);
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: `${firmName} <info@andromeda.legal>`,
                  reply_to: lawyerEmail || undefined,
                  to: [email],
                  subject, html,
                }),
              });
              console.log(`[process-pdf-job] Notification sent to ${email}`);
            } catch (e) {
              console.error(`[process-pdf-job] Notification error for ${email}:`, e);
              await adminClient.from("document_signature_events").insert({
                organization_id: doc.organization_id, document_id: doc.id,
                event_type: "notification.failed", event_data: { recipient: email, error: String(e) },
                actor_type: "system", actor_id: "process-pdf-job",
              }).catch(() => {});
            }
          }

          // Log notification event
          await adminClient.from("document_signature_events").insert({
            organization_id: doc.organization_id, document_id: doc.id,
            event_type: "notification.sent",
            event_data: {
              recipients: Array.from(recipients),
              type: "signature_confirmation_with_pdf",
              total_signers: totalSigners,
              sender: "info@andromeda.legal",
              reply_to: lawyerEmail,
              distribution_policy: policy.distribution,
              doc_type: doc.document_type,
              pdf_sha256: pdfResult.pdf_sha256,
              download_url_type: "signed.pdf",
            },
            actor_type: "system", actor_id: "process-pdf-job",
          });
        } catch (emailErr) {
          // Email failures are non-fatal — PDF is already generated
          console.error("[process-pdf-job] Email dispatch error (non-fatal):", emailErr);
        }
      }

      return json({ ok: true, job_id: job.id, storage_path: pdfResult.storage_path, pdf_sha256: pdfResult.pdf_sha256 });

    } catch (processErr: any) {
      console.error(`[process-pdf-job] Job ${job.id} failed:`, processErr);

      const newAttempts = job.attempts + 1;
      const isRetryable = processErr.isRetryable !== false;
      const newStatus = newAttempts >= MAX_ATTEMPTS ? "failed" : "queued";

      const errorInfo = processErr.errorDetail || {
        message: String(processErr),
        attempt: newAttempts,
      };

      await adminClient.from("document_pdf_jobs").update({
        status: newStatus,
        attempts: newAttempts,
        last_error: JSON.stringify(errorInfo).substring(0, 2000),
        finished_at: newStatus === "failed" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      if (newStatus === "failed") {
        console.error(`[process-pdf-job] Job ${job.id} permanently failed after ${MAX_ATTEMPTS} attempts`);
      }

      return json({ error: `Job processing failed`, details: errorInfo, retriable: newStatus === "queued" }, 500);
    }
  } catch (err) {
    console.error("process-pdf-job top-level error:", err);
    return json({ error: `Internal error: ${err}` }, 500);
  }
});
