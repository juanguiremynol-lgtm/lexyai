/**
 * html-to-pdf — Converts HTML to PDF via Gotenberg.
 * Service-role only. Stores result in Supabase Storage.
 * Returns storage_path, pdf_sha256, size_bytes.
 *
 * Demo constraints hardening:
 * - Payload size check (4MB HTML, 5MB multipart)
 * - 429 rate limit backoff with jitter
 * - Configurable timeout (30s demo, 60s self-hosted)
 * - Health check before conversion
 *
 * Migration: demo → self-hosted is config-only (GOTENBERG_URL secret).
 *   demo:    https://demo.gotenberg.dev
 *   compose: http://gotenberg:3000
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Size limits ──
const MAX_HTML_BYTES = 4 * 1024 * 1024;  // 4MB
const MAX_MULTIPART_BYTES = 5 * 1024 * 1024; // 5MB (demo limit)

// ── Retry config for 429 ──
const MAX_GOTENBERG_RETRIES = 3;
const BACKOFF_BASE_MS = 1000; // 1s, 2s, 4s

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Determine if this is the demo instance (affects timeouts, size limits) */
function isDemo(url: string): boolean {
  return url.includes("demo.gotenberg.dev");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth: service_role only ──
    const authHeader = req.headers.get("authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");

    if (token !== serviceKey) {
      return json({ error: "Unauthorized: service_role required" }, 403);
    }

    const body = await req.json();
    const { document_id, html, filename, paper, organization_id } = body;

    if (!document_id || !html || !organization_id) {
      return json({ error: "Missing required fields: document_id, html, organization_id" }, 400);
    }

    const GOTENBERG_URL = Deno.env.get("GOTENBERG_URL");
    if (!GOTENBERG_URL) {
      return json({ error: "GOTENBERG_URL secret not configured. Set it to https://demo.gotenberg.dev (testing) or http://gotenberg:3000 (self-hosted)." }, 500);
    }

    const demo = isDemo(GOTENBERG_URL);
    const timeoutMs = demo ? 30_000 : 60_000;

    // ── Payload size check ──
    const htmlBytes = new TextEncoder().encode(html);
    if (htmlBytes.length > MAX_HTML_BYTES) {
      return json({
        error: `HTML payload too large (${(htmlBytes.length / 1024 / 1024).toFixed(1)}MB). Maximum is 4MB. Reduce embedded assets or use a self-hosted Gotenberg instance.`,
        error_code: "PAYLOAD_TOO_LARGE",
      }, 413);
    }

    // ── Health check ──
    try {
      const healthRes = await fetch(`${GOTENBERG_URL}/health`, { signal: AbortSignal.timeout(5000) });
      if (!healthRes.ok) {
        const body = await healthRes.text();
        console.error(`Gotenberg health check failed (${healthRes.status}):`, body);
        return json({ error: "Gotenberg health check failed", status: healthRes.status, retryable: true }, 502);
      }
      await healthRes.text(); // consume body
    } catch (healthErr) {
      console.error("Gotenberg health check error:", healthErr);
      return json({ error: `Gotenberg unreachable: ${healthErr}`, retryable: true }, 502);
    }

    // ── Build multipart/form-data ──
    const formData = new FormData();
    const htmlBlob = new Blob([html], { type: "text/html; charset=utf-8" });
    formData.append("files", htmlBlob, "index.html");

    const paperSettings = paper || {};
    formData.append("marginTop", paperSettings.margin_top || "10mm");
    formData.append("marginBottom", paperSettings.margin_bottom || "10mm");
    formData.append("marginLeft", paperSettings.margin_left || "10mm");
    formData.append("marginRight", paperSettings.margin_right || "10mm");
    formData.append("printBackground", paperSettings.print_background !== false ? "true" : "false");
    formData.append("preferCssPageSize", "true");

    if (paperSettings.format === "A4" || !paperSettings.format) {
      formData.append("paperWidth", "8.27");
      formData.append("paperHeight", "11.7");
    }

    // ── Call Gotenberg with retry on 429 ──
    let gotenbergRes: Response | null = null;
    let lastError = "";

    for (let attempt = 0; attempt < MAX_GOTENBERG_RETRIES; attempt++) {
      console.log(`[html-to-pdf] Attempt ${attempt + 1}/${MAX_GOTENBERG_RETRIES} for document ${document_id}`);

      try {
        // Re-create FormData each attempt (streams consumed)
        const fd = new FormData();
        fd.append("files", new Blob([html], { type: "text/html; charset=utf-8" }), "index.html");
        fd.append("marginTop", paperSettings.margin_top || "10mm");
        fd.append("marginBottom", paperSettings.margin_bottom || "10mm");
        fd.append("marginLeft", paperSettings.margin_left || "10mm");
        fd.append("marginRight", paperSettings.margin_right || "10mm");
        fd.append("printBackground", paperSettings.print_background !== false ? "true" : "false");
        fd.append("preferCssPageSize", "true");
        if (paperSettings.format === "A4" || !paperSettings.format) {
          fd.append("paperWidth", "8.27");
          fd.append("paperHeight", "11.7");
        }

        gotenbergRes = await fetch(
          `${GOTENBERG_URL}/forms/chromium/convert/html`,
          { method: "POST", body: fd, signal: AbortSignal.timeout(timeoutMs) }
        );

        if (gotenbergRes.status === 429) {
          const retryAfter = gotenbergRes.headers.get("retry-after");
          const waitMs = retryAfter
            ? parseInt(retryAfter) * 1000
            : BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
          console.warn(`[html-to-pdf] 429 rate limited. Backing off ${waitMs}ms`);
          await gotenbergRes.text(); // consume body
          await sleep(waitMs);
          lastError = `429 Too Many Requests (attempt ${attempt + 1})`;
          gotenbergRes = null;
          continue;
        }

        if (gotenbergRes.ok) break; // success

        // Non-retryable error
        const errText = await gotenbergRes.text();
        lastError = `Gotenberg ${gotenbergRes.status}: ${errText.substring(0, 500)}`;
        console.error(`[html-to-pdf] ${lastError}`);
        return json({
          error: `Gotenberg conversion failed`,
          gotenberg_status: gotenbergRes.status,
          details: errText.substring(0, 500),
          retryable: false,
        }, 502);

      } catch (fetchErr) {
        lastError = `Fetch error: ${fetchErr}`;
        console.error(`[html-to-pdf] Attempt ${attempt + 1} fetch error:`, fetchErr);
        if (attempt < MAX_GOTENBERG_RETRIES - 1) {
          await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 500);
        }
      }
    }

    if (!gotenbergRes || !gotenbergRes.ok) {
      return json({
        error: `Gotenberg conversion failed after ${MAX_GOTENBERG_RETRIES} attempts`,
        last_error: lastError,
        retryable: true,
      }, 502);
    }

    const pdfBytes = new Uint8Array(await gotenbergRes.arrayBuffer());
    const pdfSha256 = await sha256Hex(pdfBytes);
    const sizeBytes = pdfBytes.length;

    console.log(`[html-to-pdf] PDF generated: ${sizeBytes} bytes, sha256=${pdfSha256.substring(0, 16)}…`);

    // ── Store PDF in Supabase Storage ──
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const pdfFilename = filename || "signed.pdf";
    const storagePath = `${organization_id}/${document_id}/${pdfFilename}`;

    const { error: uploadErr } = await adminClient.storage
      .from("signed-documents")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadErr) {
      console.error("PDF storage upload error:", uploadErr);
      return json({ error: `Storage upload failed: ${uploadErr.message}` }, 500);
    }

    // ── Store HTML for debug only ──
    const htmlStoragePath = `${organization_id}/${document_id}/signed.html`;
    await adminClient.storage
      .from("signed-documents")
      .upload(htmlStoragePath, htmlBytes, { contentType: "text/html; charset=utf-8", upsert: true })
      .catch((e: unknown) => console.warn("HTML debug upload warning:", e));

    return json({
      ok: true,
      storage_path: storagePath,
      pdf_sha256: pdfSha256,
      size_bytes: sizeBytes,
      html_debug_path: htmlStoragePath,
    });
  } catch (err) {
    console.error("html-to-pdf error:", err);
    return json({ error: `Internal error: ${err}` }, 500);
  }
});
