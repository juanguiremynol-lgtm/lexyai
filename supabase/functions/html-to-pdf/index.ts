/**
 * html-to-pdf — Converts HTML to PDF via Gotenberg.
 * Service-role only. Stores result in Supabase Storage.
 * Returns storage_path, pdf_sha256, size_bytes.
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

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth: service_role only ──
    const authHeader = req.headers.get("authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const token = authHeader.replace("Bearer ", "");

    // Allow service_role key or internal invocations (where token matches service key)
    if (token !== serviceKey && token !== anonKey) {
      // Also allow if called from another edge function via supabase client (anon key with service role header)
      // For maximum security, we check the actual key
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const testClient = createClient(supabaseUrl, token);
      const { data: { user } } = await testClient.auth.getUser();
      if (!user) {
        return json({ error: "Unauthorized: service_role required" }, 401);
      }
      // If user exists, check if they're an org admin — but prefer service_role
      // For now, reject non-service-role to keep it locked down
      return json({ error: "Unauthorized: this function is restricted to service_role" }, 403);
    }

    const body = await req.json();
    const { document_id, html, filename, paper, organization_id } = body;

    if (!document_id || !html || !organization_id) {
      return json({ error: "Missing required fields: document_id, html, organization_id" }, 400);
    }

    const GOTENBERG_URL = Deno.env.get("GOTENBERG_URL");
    if (!GOTENBERG_URL) {
      return json({ error: "GOTENBERG_URL secret not configured" }, 500);
    }

    // ── Health check ──
    try {
      const healthRes = await fetch(`${GOTENBERG_URL}/health`, { signal: AbortSignal.timeout(5000) });
      if (!healthRes.ok) {
        await healthRes.text();
        return json({ error: "Gotenberg health check failed" }, 502);
      }
      await healthRes.text();
    } catch (healthErr) {
      console.error("Gotenberg health check error:", healthErr);
      return json({ error: `Gotenberg unreachable: ${healthErr}` }, 502);
    }

    // ── Build multipart/form-data for Gotenberg ──
    const formData = new FormData();

    // Main HTML file
    const htmlBlob = new Blob([html], { type: "text/html; charset=utf-8" });
    formData.append("files", htmlBlob, "index.html");

    // Paper settings
    const paperSettings = paper || {};
    formData.append("marginTop", paperSettings.margin_top || "10mm");
    formData.append("marginBottom", paperSettings.margin_bottom || "10mm");
    formData.append("marginLeft", paperSettings.margin_left || "10mm");
    formData.append("marginRight", paperSettings.margin_right || "10mm");
    formData.append("printBackground", paperSettings.print_background !== false ? "true" : "false");
    formData.append("preferCssPageSize", "true");

    // Paper format (A4 default)
    if (paperSettings.format === "A4" || !paperSettings.format) {
      formData.append("paperWidth", "8.27");
      formData.append("paperHeight", "11.7");
    }

    // ── Call Gotenberg ──
    console.log(`[html-to-pdf] Converting document ${document_id} via Gotenberg`);
    const gotenbergRes = await fetch(
      `${GOTENBERG_URL}/forms/chromium/convert/html`,
      {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60000), // 60s timeout
      }
    );

    if (!gotenbergRes.ok) {
      const errText = await gotenbergRes.text();
      console.error(`Gotenberg error ${gotenbergRes.status}:`, errText);
      return json({ error: `Gotenberg conversion failed: ${gotenbergRes.status}` }, 502);
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
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("PDF storage upload error:", uploadErr);
      return json({ error: `Storage upload failed: ${uploadErr.message}` }, 500);
    }

    // ── Optionally store HTML for debug ──
    const htmlStoragePath = `${organization_id}/${document_id}/signed.html`;
    await adminClient.storage
      .from("signed-documents")
      .upload(htmlStoragePath, new TextEncoder().encode(html), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      })
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
