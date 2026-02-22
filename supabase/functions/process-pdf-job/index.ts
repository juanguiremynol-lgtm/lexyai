/**
 * process-pdf-job — Async worker that processes queued PDF generation jobs.
 * Called via cron, webhook, or fire-and-forget from complete-signature.
 * Picks up QUEUED jobs, invokes html-to-pdf, updates document records.
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

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5000; // 5s, 10s, 20s

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const DEADLINE = Date.now() + 142_000; // 142s wall-clock guard

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const specificJobId = body?.job_id;

    // ── Pick a job ──
    let jobQuery = adminClient
      .from("document_pdf_jobs")
      .select("*");

    if (specificJobId) {
      jobQuery = jobQuery.eq("id", specificJobId);
    } else {
      jobQuery = jobQuery
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1);
    }

    const { data: jobs, error: jobErr } = await jobQuery;
    if (jobErr) {
      console.error("Job fetch error:", jobErr);
      return json({ error: "Failed to fetch jobs" }, 500);
    }

    if (!jobs || jobs.length === 0) {
      return json({ ok: true, message: "No jobs to process" });
    }

    const job = jobs[0];

    // ── Lock the job ──
    const { error: lockErr } = await adminClient
      .from("document_pdf_jobs")
      .update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", job.status); // optimistic lock

    if (lockErr) {
      console.error("Job lock error:", lockErr);
      return json({ error: "Failed to lock job" }, 409);
    }

    console.log(`[process-pdf-job] Processing job ${job.id} for document ${job.document_id} (attempt ${job.attempts + 1})`);

    try {
      // ── Fetch document ──
      const { data: doc, error: docErr } = await adminClient
        .from("generated_documents")
        .select("id, title, content_html, organization_id, document_type, work_item_id, created_by, created_at, poderdante_type, entity_data")
        .eq("id", job.document_id)
        .single();

      if (docErr || !doc) {
        throw new Error(`Document not found: ${job.document_id}`);
      }

      // ── Fetch all signed signatures ──
      const { data: allSignatures } = await adminClient
        .from("document_signatures")
        .select("*")
        .eq("document_id", job.document_id)
        .eq("status", "signed")
        .order("signing_order", { ascending: true });

      const signedSigs = allSignatures || [];
      if (signedSigs.length === 0) {
        throw new Error("No signed signatures found for document");
      }

      // ── Fetch branding ──
      let lawyerProfile: any = null;
      let orgData: any = null;
      if (doc.created_by) {
        const { data: prof } = await adminClient
          .from("profiles")
          .select("full_name, email, litigation_email, custom_branding_enabled, custom_logo_path, custom_firm_name")
          .eq("id", doc.created_by)
          .single();
        lawyerProfile = prof;
      }
      if (doc.organization_id) {
        const { data: org } = await adminClient
          .from("organizations")
          .select("name, custom_branding_enabled, custom_logo_path, custom_firm_name")
          .eq("id", doc.organization_id)
          .single();
        orgData = org;
      }

      // ── Build the combined HTML (same as complete-signature but for PDF) ──
      const totalSigners = signedSigs.length;
      const isBilateral = doc.document_type === "contrato_servicios";

      const allSignatureBlocks = signedSigs.map((s) => {
        const roleLabel = s.signer_role === "lawyer" ? "EL MANDATARIO" : "EL MANDANTE";
        const sigImgSrc = s.signature_image_path
          ? `${supabaseUrl}/storage/v1/object/public/signed-documents/${s.signature_image_path}`
          : null;
        return `<div style="margin-top:30px;border-top:2px solid #333;padding-top:16px;display:inline-block;width:${totalSigners > 1 ? "48%" : "100%"};vertical-align:top;">
          ${sigImgSrc ? `<img src="${sigImgSrc}" alt="Firma" style="max-width:250px;max-height:80px;" />` : '<p style="color:#999;">[Firma registrada]</p>'}
          <p><strong>${s.signer_name}</strong></p><p>C.C. ${s.signer_cedula || "N/A"}</p>
          ${totalSigners > 1 ? `<p style="font-size:12px;font-weight:bold;">${roleLabel}</p>` : ""}
          <p style="font-size:11px;color:#666;">Firmado: ${s.signed_at ? formatCOT(s.signed_at) : "N/A"}</p>
        </div>`;
      }).join(totalSigners > 1 ? "&nbsp;&nbsp;" : "");

      // Compute document hash (same as complete-signature)
      const documentPagesHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${doc.title}</title>
<style>body { font-family: 'Georgia', serif; max-width: 800px; margin: 0 auto; padding: 40px; }</style>
</head><body>${doc.content_html}<div style="margin-top:40px;">${allSignatureBlocks}</div></body></html>`;

      const documentHash = await sha256Hex(documentPagesHtml);

      // Build full combined HTML with evidence appendix (reuse from stored events)
      const { data: allDocEvents } = await adminClient
        .from("document_signature_events")
        .select("*")
        .eq("document_id", doc.id)
        .order("created_at", { ascending: true });

      // Build a simplified evidence appendix for the PDF
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
          ? `${supabaseUrl}/storage/v1/object/public/branding/${lawyerProfile.custom_logo_path}`
          : null;

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

      // ── Call html-to-pdf ──
      const htmlToPdfUrl = `${supabaseUrl}/functions/v1/html-to-pdf`;
      const pdfRes = await fetch(htmlToPdfUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document_id: doc.id,
          html: combinedHtml,
          filename: "signed.pdf",
          organization_id: doc.organization_id,
          paper: { format: "A4", margin_top: "10mm", margin_bottom: "10mm", margin_left: "10mm", margin_right: "10mm", print_background: true },
        }),
        signal: AbortSignal.timeout(90000),
      });

      if (!pdfRes.ok) {
        const errBody = await pdfRes.text();
        throw new Error(`html-to-pdf failed (${pdfRes.status}): ${errBody}`);
      }

      const pdfResult = await pdfRes.json();
      if (!pdfResult.ok) {
        throw new Error(`html-to-pdf error: ${pdfResult.error}`);
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

      // ── Update document with PDF hash and path ──
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
        organization_id: doc.organization_id,
        document_id: doc.id,
        event_type: "document.pdf_generated",
        event_data: {
          storage_path: pdfResult.storage_path,
          pdf_sha256: pdfResult.pdf_sha256,
          size_bytes: pdfResult.size_bytes,
          job_id: job.id,
        },
        actor_type: "system",
        actor_id: "process-pdf-job",
      });

      console.log(`[process-pdf-job] Job ${job.id} succeeded: ${pdfResult.storage_path}`);

      return json({
        ok: true,
        job_id: job.id,
        storage_path: pdfResult.storage_path,
        pdf_sha256: pdfResult.pdf_sha256,
      });

    } catch (processErr) {
      console.error(`[process-pdf-job] Job ${job.id} failed:`, processErr);

      const newAttempts = job.attempts + 1;
      const newStatus = newAttempts >= MAX_ATTEMPTS ? "failed" : "queued";

      await adminClient.from("document_pdf_jobs").update({
        status: newStatus,
        attempts: newAttempts,
        last_error: String(processErr),
        finished_at: newStatus === "failed" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      if (newStatus === "failed") {
        console.error(`[process-pdf-job] Job ${job.id} permanently failed after ${MAX_ATTEMPTS} attempts`);
      }

      return json({ error: `Job processing failed: ${processErr}`, retriable: newStatus === "queued" }, 500);
    }
  } catch (err) {
    console.error("process-pdf-job top-level error:", err);
    return json({ error: `Internal error: ${err}` }, 500);
  }
});
