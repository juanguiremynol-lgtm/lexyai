/**
 * test-gotenberg-connection — Health + render test for Gotenberg.
 * Platform admin only. Tests /health, converts a sample HTML to PDF,
 * stores it in storage for download, and returns pass/fail + metrics.
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
    const authHeader = req.headers.get("authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRecord } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!adminRecord) return json({ error: "Platform admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    let testUrl = body?.gotenberg_url;

    if (!testUrl) {
      const { data: settings } = await adminClient
        .from("platform_pdf_settings")
        .select("gotenberg_url, mode")
        .limit(1)
        .single();

      if (settings?.mode === "DEMO") {
        testUrl = "https://demo.gotenberg.dev";
      } else if (settings?.gotenberg_url) {
        testUrl = settings.gotenberg_url;
      }
    }

    if (!testUrl) {
      return json({ error: "No Gotenberg URL configured or provided" }, 400);
    }

    const results: Record<string, unknown> = { url: testUrl };
    const t0 = Date.now();

    // Step 1: Health check
    try {
      const healthRes = await fetch(`${testUrl}/health`, { signal: AbortSignal.timeout(10000) });
      const healthBody = await healthRes.text();
      results.health = {
        ok: healthRes.ok,
        status: healthRes.status,
        latency_ms: Date.now() - t0,
        body: healthBody.substring(0, 500),
      };
    } catch (err) {
      results.health = { ok: false, error: String(err), latency_ms: Date.now() - t0 };
      return json({ ok: false, ...results }, 502);
    }

    // Step 2: Render test with accented characters + em dash
    const now = new Date();
    const testHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Test PDF — Andromeda Legal</title>
<style>
  body { font-family: 'Georgia', serif; max-width: 700px; margin: 40px auto; padding: 20px; color: #1a1a2e; }
  h1 { color: #1a1a2e; border-bottom: 3px solid #1a1a2e; padding-bottom: 12px; }
  .meta { color: #666; font-size: 12px; margin-top: 24px; border-top: 1px solid #ddd; padding-top: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  td { padding: 8px; border: 1px solid #ddd; }
  th { padding: 8px; border: 1px solid #ddd; background: #f5f5f5; text-align: left; }
</style>
</head><body>
<h1>Prueba de Generación PDF — Andromeda Legal</h1>
<p>Este documento fue generado automáticamente para validar el pipeline de PDF.</p>

<h2>Verificación de caracteres</h2>
<table>
  <tr><th>Tipo</th><th>Caracteres</th><th>Estado</th></tr>
  <tr><td>Acentos</td><td>á é í ó ú Á É Í Ó Ú</td><td>✓</td></tr>
  <tr><td>Eñe</td><td>ñ Ñ</td><td>✓</td></tr>
  <tr><td>Diéresis</td><td>ü Ü</td><td>✓</td></tr>
  <tr><td>Em dash</td><td>—</td><td>✓</td></tr>
  <tr><td>Signos</td><td>¿ ¡ § © ® ™</td><td>✓</td></tr>
  <tr><td>Moneda</td><td>$ € £ ¥</td><td>✓</td></tr>
</table>

<h2>Datos de la prueba</h2>
<p><strong>Fecha/Hora:</strong> ${now.toLocaleString("es-CO", { timeZone: "America/Bogota" })} COT</p>
<p><strong>ISO:</strong> ${now.toISOString()}</p>
<p><strong>Endpoint:</strong> ${testUrl.includes("demo") ? "Demo (demo.gotenberg.dev)" : "Directo"}</p>

<p class="meta">Documento de prueba generado por Andromeda Legal Platform — No contiene datos reales de clientes.</p>
</body></html>`;

    const t1 = Date.now();
    let pdfBytes: Uint8Array | null = null;
    try {
      const fd = new FormData();
      fd.append("files", new Blob([testHtml], { type: "text/html; charset=utf-8" }), "index.html");
      fd.append("paperWidth", "8.27");
      fd.append("paperHeight", "11.7");
      fd.append("marginTop", "10mm");
      fd.append("marginBottom", "10mm");
      fd.append("marginLeft", "10mm");
      fd.append("marginRight", "10mm");
      fd.append("printBackground", "true");

      const renderRes = await fetch(`${testUrl}/forms/chromium/convert/html`, {
        method: "POST",
        body: fd,
        signal: AbortSignal.timeout(30000),
      });

      if (renderRes.ok) {
        pdfBytes = new Uint8Array(await renderRes.arrayBuffer());
        const pdfHash = await sha256Hex(pdfBytes);
        results.render = {
          ok: true,
          latency_ms: Date.now() - t1,
          pdf_size_bytes: pdfBytes.byteLength,
          pdf_sha256: pdfHash,
        };
      } else {
        const errText = await renderRes.text();
        results.render = {
          ok: false,
          status: renderRes.status,
          latency_ms: Date.now() - t1,
          error: errText.substring(0, 500),
        };
      }
    } catch (err) {
      results.render = { ok: false, error: String(err), latency_ms: Date.now() - t1 };
    }

    // Step 3: Store PDF in storage for download (test path, not client data)
    let downloadUrl: string | null = null;
    if (pdfBytes && (results.render as any)?.ok) {
      const testPath = `_platform_tests/pdf-test-${now.getTime()}.pdf`;
      const { error: uploadErr } = await adminClient.storage
        .from("signed-documents")
        .upload(testPath, pdfBytes, { contentType: "application/pdf", upsert: true });

      if (!uploadErr) {
        const { data: urlData } = await adminClient.storage
          .from("signed-documents")
          .createSignedUrl(testPath, 3600); // 1 hour
        downloadUrl = urlData?.signedUrl || null;
        (results.render as any).storage_path = testPath;
      } else {
        console.warn("Test PDF upload warning:", uploadErr);
      }
    }

    // Update health check timestamp
    const allOk = (results.health as any)?.ok && (results.render as any)?.ok;
    await adminClient
      .from("platform_pdf_settings")
      .update({
        last_health_check_at: new Date().toISOString(),
        last_health_status: allOk ? "healthy" : "unhealthy",
        updated_at: new Date().toISOString(),
      })
      .not("id", "is", null);

    return json({ ok: allOk, download_url: downloadUrl, ...results });
  } catch (err) {
    console.error("test-gotenberg-connection error:", err);
    return json({ error: `Internal error: ${err}` }, 500);
  }
});
