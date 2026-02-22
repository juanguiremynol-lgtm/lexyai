/**
 * merge-signed-pdf — Merges an uploaded source PDF with signature block(s) and audit certificate.
 *
 * Used for UPLOADED_PDF source_type documents where the lawyer uploads their own PDF.
 * Pipeline:
 *   1. Download source.pdf from unsigned-documents bucket
 *   2. Generate signature_block.pdf via Gotenberg (HTML → PDF with signature images)
 *   3. Generate audit.pdf via Gotenberg (audit certificate HTML → PDF)
 *   4. Merge all three using pdf-lib: source + signature_block + audit
 *   5. Store merged result as signed.pdf in signed-documents bucket
 *   6. Compute final_pdf_sha256 over merged bytes
 *
 * Auth: service_role only (called by process-pdf-job).
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

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

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convert HTML to PDF bytes via Gotenberg */
async function htmlToPdfBytes(
  gotenbergUrl: string,
  html: string,
  timeoutMs: number,
): Promise<Uint8Array> {
  const fd = new FormData();
  fd.append(
    "files",
    new Blob([html], { type: "text/html; charset=utf-8" }),
    "index.html",
  );
  fd.append("marginTop", "10mm");
  fd.append("marginBottom", "10mm");
  fd.append("marginLeft", "10mm");
  fd.append("marginRight", "10mm");
  fd.append("printBackground", "true");
  fd.append("preferCssPageSize", "true");
  fd.append("paperWidth", "8.27");
  fd.append("paperHeight", "11.7");

  const res = await fetch(`${gotenbergUrl}/forms/chromium/convert/html`, {
    method: "POST",
    body: fd,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Gotenberg conversion failed (${res.status}): ${errText.substring(0, 500)}`,
    );
  }

  return new Uint8Array(await res.arrayBuffer());
}

/** Download a file from Supabase Storage as Uint8Array */
async function downloadFromStorage(
  adminClient: any,
  bucket: string,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await adminClient.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(`Failed to download ${bucket}/${path}: ${error?.message || "no data"}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

/** Download a storage file and return as base64 data URI */
async function downloadAsBase64DataUri(
  adminClient: any,
  bucket: string,
  path: string,
  mimeType = "image/png",
): Promise<string | null> {
  try {
    const bytes = await downloadFromStorage(adminClient, bucket, path);
    const base64 = btoa(String.fromCharCode(...bytes));
    return `data:${mimeType};base64,${base64}`;
  } catch {
    return null;
  }
}

function formatCOT(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return (
      d.toLocaleDateString("es-CO", {
        timeZone: "America/Bogota",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }) +
      " " +
      d.toLocaleTimeString("es-CO", {
        timeZone: "America/Bogota",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }) +
      " COT"
    );
  } catch {
    return dateStr;
  }
}

/** Build signature block HTML page with both signatures */
function buildSignatureBlockHtml(
  signatures: any[],
  signatureBase64Map: Record<string, string>,
): string {
  const totalSigners = signatures.length;

  const sigBlocks = signatures
    .map((s) => {
      const roleLabel = s.signer_role === "lawyer" ? "EL MANDATARIO" : "EL MANDANTE";
      const sigImgSrc = signatureBase64Map[s.id] || null;

      return `
      <div style="margin-top:24px;border-top:2px solid #333;padding-top:16px;display:inline-block;width:${totalSigners > 1 ? "48%" : "100%"};vertical-align:top;">
        ${
          sigImgSrc
            ? `<img src="${sigImgSrc}" alt="Firma" style="max-width:250px;max-height:80px;" />`
            : '<p style="color:#999;">[Firma registrada]</p>'
        }
        <p><strong>${s.signer_name}</strong></p>
        <p>C.C. ${s.signer_cedula || "N/A"}</p>
        ${totalSigners > 1 ? `<p style="font-size:12px;font-weight:bold;">${roleLabel}</p>` : ""}
        <p style="font-size:11px;color:#666;">Firmado: ${s.signed_at ? formatCOT(s.signed_at) : "N/A"}</p>
      </div>`;
    })
    .join(totalSigners > 1 ? "&nbsp;&nbsp;" : "");

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Firmas</title></head>
<body style="font-family:'Georgia',serif;max-width:800px;margin:0 auto;padding:40px;">
  <h2 style="color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:8px;margin-bottom:24px;">
    FIRMAS ELECTRÓNICAS
  </h2>
  <div>${sigBlocks}</div>
  <footer style="margin-top:40px;padding-top:16px;border-top:1px solid #eee;font-size:10px;color:#999;text-align:center;">
    Firmas electrónicas — Documento original proporcionado por el abogado
  </footer>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: service_role only
    const authHeader = req.headers.get("authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");

    if (token !== serviceKey) {
      return json({ error: "Unauthorized: service_role required" }, 403);
    }

    const body = await req.json();
    const {
      document_id,
      organization_id,
      source_pdf_path,
      signature_block_html,
      audit_certificate_html,
      filename,
    } = body;

    if (!document_id || !organization_id || !source_pdf_path) {
      return json(
        {
          error:
            "Missing required fields: document_id, organization_id, source_pdf_path",
        },
        400,
      );
    }

    if (!signature_block_html || !audit_certificate_html) {
      return json(
        {
          error:
            "Missing required fields: signature_block_html, audit_certificate_html",
        },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── Resolve Gotenberg URL ──
    let gotenbergUrl = "";
    try {
      const { data: settings } = await adminClient
        .from("platform_pdf_settings")
        .select("gotenberg_url, mode, enabled")
        .limit(1)
        .single();

      if (settings) {
        if (!settings.enabled) {
          return json({ error: "PDF generation disabled", retryable: false }, 503);
        }
        if (settings.mode === "DEMO") {
          gotenbergUrl = "https://demo.gotenberg.dev";
        } else if (settings.mode === "DIRECT" && settings.gotenberg_url) {
          gotenbergUrl = settings.gotenberg_url;
        }
      }
    } catch (e) {
      console.warn(
        "[merge-signed-pdf] Could not read platform_pdf_settings:",
        e,
      );
    }

    if (!gotenbergUrl) {
      gotenbergUrl = Deno.env.get("GOTENBERG_URL") || "";
    }
    if (!gotenbergUrl) {
      return json({ error: "Gotenberg URL not configured" }, 500);
    }

    // ── Health check ──
    try {
      const healthRes = await fetch(`${gotenbergUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!healthRes.ok) {
        await healthRes.text();
        return json(
          { error: "Gotenberg health check failed", retryable: true },
          502,
        );
      }
      await healthRes.text();
    } catch (healthErr) {
      return json(
        { error: `Gotenberg unreachable: ${healthErr}`, retryable: true },
        502,
      );
    }

    console.log(
      `[merge-signed-pdf] Starting merge for document ${document_id}`,
    );

    // ── Step 1: Download source PDF ──
    console.log(
      `[merge-signed-pdf] Downloading source PDF: unsigned-documents/${source_pdf_path}`,
    );
    const sourcePdfBytes = await downloadFromStorage(
      adminClient,
      "unsigned-documents",
      source_pdf_path,
    );
    console.log(
      `[merge-signed-pdf] Source PDF: ${sourcePdfBytes.length} bytes`,
    );

    // ── Step 2: Generate signature block PDF via Gotenberg ──
    console.log(`[merge-signed-pdf] Generating signature block PDF`);
    const sigBlockPdfBytes = await htmlToPdfBytes(
      gotenbergUrl,
      signature_block_html,
      60_000,
    );
    console.log(
      `[merge-signed-pdf] Signature block PDF: ${sigBlockPdfBytes.length} bytes`,
    );

    // ── Step 3: Generate audit certificate PDF via Gotenberg ──
    console.log(`[merge-signed-pdf] Generating audit certificate PDF`);
    const auditPdfBytes = await htmlToPdfBytes(
      gotenbergUrl,
      audit_certificate_html,
      60_000,
    );
    console.log(
      `[merge-signed-pdf] Audit certificate PDF: ${auditPdfBytes.length} bytes`,
    );

    // ── Step 4: Merge PDFs using pdf-lib ──
    console.log(`[merge-signed-pdf] Merging PDFs`);
    const mergedPdf = await PDFDocument.create();

    // Copy source PDF pages
    const sourcePdf = await PDFDocument.load(sourcePdfBytes);
    const sourcePages = await mergedPdf.copyPages(
      sourcePdf,
      sourcePdf.getPageIndices(),
    );
    for (const page of sourcePages) {
      mergedPdf.addPage(page);
    }

    // Copy signature block pages
    const sigBlockPdf = await PDFDocument.load(sigBlockPdfBytes);
    const sigBlockPages = await mergedPdf.copyPages(
      sigBlockPdf,
      sigBlockPdf.getPageIndices(),
    );
    for (const page of sigBlockPages) {
      mergedPdf.addPage(page);
    }

    // Copy audit certificate pages
    const auditPdf = await PDFDocument.load(auditPdfBytes);
    const auditPages = await mergedPdf.copyPages(
      auditPdf,
      auditPdf.getPageIndices(),
    );
    for (const page of auditPages) {
      mergedPdf.addPage(page);
    }

    const mergedBytes = await mergedPdf.save();
    const mergedUint8 = new Uint8Array(mergedBytes);
    const pdfSha256 = await sha256Hex(mergedUint8);
    const sizeBytes = mergedUint8.length;

    console.log(
      `[merge-signed-pdf] Merged PDF: ${sizeBytes} bytes, sha256=${pdfSha256.substring(0, 16)}…, pages=${mergedPdf.getPageCount()} (source=${sourcePdf.getPageCount()}, sigBlock=${sigBlockPdf.getPageCount()}, audit=${auditPdf.getPageCount()})`,
    );

    // ── Step 5: Upload merged PDF to signed-documents ──
    const pdfFilename = filename || "signed.pdf";
    const storagePath = `${organization_id}/${document_id}/${pdfFilename}`;

    const { error: uploadErr } = await adminClient.storage
      .from("signed-documents")
      .upload(storagePath, mergedUint8, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[merge-signed-pdf] Storage upload error:", uploadErr);
      return json(
        { error: `Storage upload failed: ${uploadErr.message}` },
        500,
      );
    }

    // ── Also store the individual PDFs for debugging ──
    try {
      await adminClient.storage
        .from("signed-documents")
        .upload(
          `${organization_id}/${document_id}/signature_block.pdf`,
          sigBlockPdfBytes,
          { contentType: "application/pdf", upsert: true },
        );
      await adminClient.storage
        .from("signed-documents")
        .upload(
          `${organization_id}/${document_id}/audit_certificate.pdf`,
          auditPdfBytes,
          { contentType: "application/pdf", upsert: true },
        );
    } catch (debugErr) {
      console.warn("[merge-signed-pdf] Debug artifact upload:", debugErr);
    }

    return json({
      ok: true,
      storage_path: storagePath,
      pdf_sha256: pdfSha256,
      size_bytes: sizeBytes,
      page_count: mergedPdf.getPageCount(),
      source_pages: sourcePdf.getPageCount(),
      signature_block_pages: sigBlockPdf.getPageCount(),
      audit_pages: auditPdf.getPageCount(),
    });
  } catch (err) {
    console.error("[merge-signed-pdf] Error:", err);
    return json({ error: `Internal error: ${err}`, retryable: true }, 500);
  }
});
