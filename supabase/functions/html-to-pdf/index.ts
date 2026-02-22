/**
 * html-to-pdf — Converts HTML to PDF via Gotenberg.
 * Service-role only. Stores result in Supabase Storage.
 * Returns storage_path, pdf_sha256, size_bytes.
 *
 * Runtime URL resolution (priority order):
 * 1. platform_pdf_settings DB config (mode DEMO/DIRECT)
 * 2. GOTENBERG_URL env secret (fallback)
 * 3. Demo URL (dev only final fallback)
 *
 * Demo constraints hardening:
 * - Payload size check (configurable via DB, default 4MB HTML)
 * - 429 rate limit backoff with jitter
 * - Configurable timeout via DB
 * - Health check before conversion
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_MULTIPART_BYTES = 5 * 1024 * 1024;
const MAX_GOTENBERG_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const DEMO_URL = "https://demo.gotenberg.dev";

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

interface ResolvedConfig {
  url: string;
  mode: string;
  enabled: boolean;
  timeoutMs: number;
  maxHtmlBytes: number;
}

/** Resolve effective Gotenberg URL and config from DB, then env, then fallback */
async function resolveGotenbergConfig(adminClient: any): Promise<ResolvedConfig> {
  // Try DB settings first
  try {
    const { data: settings } = await adminClient
      .from("platform_pdf_settings")
      .select("gotenberg_url, mode, enabled, timeout_seconds, max_html_bytes")
      .limit(1)
      .single();

    if (settings) {
      if (!settings.enabled) {
        return { url: "", mode: "DISABLED", enabled: false, timeoutMs: 30000, maxHtmlBytes: 4_000_000 };
      }

      let url: string;
      if (settings.mode === "DEMO") {
        url = DEMO_URL;
      } else if (settings.mode === "DIRECT" && settings.gotenberg_url) {
        url = settings.gotenberg_url;
      } else {
        // DIRECT but no URL — fall through to env
        url = Deno.env.get("GOTENBERG_URL") || "";
      }

      if (url) {
        return {
          url,
          mode: settings.mode,
          enabled: true,
          timeoutMs: (settings.timeout_seconds || 30) * 1000,
          maxHtmlBytes: settings.max_html_bytes || 4_000_000,
        };
      }
    }
  } catch (e) {
    console.warn("[html-to-pdf] Could not read platform_pdf_settings, falling back to env:", e);
  }

  // Fallback to env secret
  const envUrl = Deno.env.get("GOTENBERG_URL");
  if (envUrl) {
    const isDemo = envUrl.includes("demo.gotenberg.dev");
    return {
      url: envUrl,
      mode: isDemo ? "DEMO" : "DIRECT",
      enabled: true,
      timeoutMs: isDemo ? 30_000 : 60_000,
      maxHtmlBytes: 4_000_000,
    };
  }

  return { url: "", mode: "UNCONFIGURED", enabled: false, timeoutMs: 30_000, maxHtmlBytes: 4_000_000 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth: service_role only
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Resolve config from DB → env → fallback
    const config = await resolveGotenbergConfig(adminClient);

    if (!config.enabled || !config.url) {
      return json({
        error: config.mode === "DISABLED"
          ? "PDF generation is currently disabled by platform administrator."
          : "Gotenberg URL not configured. Configure it in Platform Console → PDF Generation.",
        error_code: "PDF_PROVIDER_UNCONFIGURED",
      }, 500);
    }

    console.log(`[html-to-pdf] Using provider mode=${config.mode}, timeout=${config.timeoutMs}ms`);

    // Payload size check (configurable via DB)
    const htmlBytes = new TextEncoder().encode(html);
    if (htmlBytes.length > config.maxHtmlBytes) {
      return json({
        error: `HTML payload too large (${(htmlBytes.length / 1024 / 1024).toFixed(1)}MB). Maximum is ${(config.maxHtmlBytes / 1024 / 1024).toFixed(0)}MB. Reduce embedded assets or use a self-hosted Gotenberg instance.`,
        error_code: "PAYLOAD_TOO_LARGE",
      }, 413);
    }

    // Health check
    try {
      const healthRes = await fetch(`${config.url}/health`, { signal: AbortSignal.timeout(5000) });
      if (!healthRes.ok) {
        const hBody = await healthRes.text();
        console.error(`Gotenberg health check failed (${healthRes.status}):`, hBody);
        return json({ error: "Gotenberg health check failed", status: healthRes.status, retryable: true }, 502);
      }
      await healthRes.text();
    } catch (healthErr) {
      console.error("Gotenberg health check error:", healthErr);
      return json({ error: `Gotenberg unreachable: ${healthErr}`, retryable: true }, 502);
    }

    // Build paper settings
    const paperSettings = paper || {};

    // Call Gotenberg with retry on 429
    let gotenbergRes: Response | null = null;
    let lastError = "";

    for (let attempt = 0; attempt < MAX_GOTENBERG_RETRIES; attempt++) {
      console.log(`[html-to-pdf] Attempt ${attempt + 1}/${MAX_GOTENBERG_RETRIES} for document ${document_id}`);

      try {
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
          `${config.url}/forms/chromium/convert/html`,
          { method: "POST", body: fd, signal: AbortSignal.timeout(config.timeoutMs) }
        );

        if (gotenbergRes.status === 429) {
          const retryAfter = gotenbergRes.headers.get("retry-after");
          const waitMs = retryAfter
            ? parseInt(retryAfter) * 1000
            : BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
          console.warn(`[html-to-pdf] 429 rate limited. Backing off ${waitMs}ms`);
          await gotenbergRes.text();
          await sleep(waitMs);
          lastError = `429 Too Many Requests (attempt ${attempt + 1})`;
          gotenbergRes = null;
          continue;
        }

        if (gotenbergRes.ok) break;

        const errText = await gotenbergRes.text();
        lastError = `Gotenberg ${gotenbergRes.status}: ${errText.substring(0, 500)}`;
        console.error(`[html-to-pdf] ${lastError}`);
        return json({
          error: "Gotenberg conversion failed",
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

    console.log(`[html-to-pdf] PDF generated: ${sizeBytes} bytes, sha256=${pdfSha256.substring(0, 16)}…, provider_mode=${config.mode}`);

    // Store PDF in Supabase Storage
    const pdfFilename = filename || "signed.pdf";
    const storagePath = `${organization_id}/${document_id}/${pdfFilename}`;

    const { error: uploadErr } = await adminClient.storage
      .from("signed-documents")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadErr) {
      console.error("PDF storage upload error:", uploadErr);
      return json({ error: `Storage upload failed: ${uploadErr.message}` }, 500);
    }

    // Store HTML for debug only
    const htmlStoragePath = `${organization_id}/${document_id}/signed.html`;
    await adminClient.storage
      .from("signed-documents")
      .upload(htmlStoragePath, htmlBytes, { contentType: "text/html; charset=utf-8", upsert: true })
      .catch((e: unknown) => console.warn("HTML debug upload warning:", e));

    // Update last_success_at in settings
    await adminClient
      .from("platform_pdf_settings")
      .update({ last_success_at: new Date().toISOString() })
      .not("id", "is", null)
      .catch(() => {});

    return json({
      ok: true,
      storage_path: storagePath,
      pdf_sha256: pdfSha256,
      size_bytes: sizeBytes,
      html_debug_path: htmlStoragePath,
      provider_mode: config.mode,
    });
  } catch (err) {
    console.error("html-to-pdf error:", err);
    return json({ error: `Internal error: ${err}` }, 500);
  }
});
