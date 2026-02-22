/**
 * test-gotenberg-connection — Lightweight health + render test for Gotenberg.
 * Platform admin only. Tests /health and converts a small HTML sample.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth: require authenticated platform admin
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

    // Check platform admin
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRecord } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!adminRecord) return json({ error: "Platform admin access required" }, 403);

    // Get the URL to test from request body or from DB settings
    const body = await req.json().catch(() => ({}));
    let testUrl = body?.gotenberg_url;

    if (!testUrl) {
      // Read from platform_pdf_settings
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

    // Step 2: Render test with accented characters
    const testHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Test</title></head>
<body><h1>Prueba de conexión Gotenberg</h1>
<p>Caracteres acentuados: á é í ó ú ñ Ñ ü Ü</p>
<p>Fecha: ${new Date().toISOString()}</p></body></html>`;

    const t1 = Date.now();
    try {
      const fd = new FormData();
      fd.append("files", new Blob([testHtml], { type: "text/html; charset=utf-8" }), "index.html");
      fd.append("paperWidth", "8.27");
      fd.append("paperHeight", "11.7");

      const renderRes = await fetch(`${testUrl}/forms/chromium/convert/html`, {
        method: "POST",
        body: fd,
        signal: AbortSignal.timeout(30000),
      });

      if (renderRes.ok) {
        const pdfBytes = await renderRes.arrayBuffer();
        results.render = {
          ok: true,
          latency_ms: Date.now() - t1,
          pdf_size_bytes: pdfBytes.byteLength,
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

    // Update health check timestamp in settings
    const healthOk = (results.health as any)?.ok && (results.render as any)?.ok;
    await adminClient
      .from("platform_pdf_settings")
      .update({
        last_health_check_at: new Date().toISOString(),
        last_health_status: healthOk ? "healthy" : "unhealthy",
        updated_at: new Date().toISOString(),
      })
      .not("id", "is", null); // update all rows (single row table)

    const allOk = (results.health as any)?.ok && (results.render as any)?.ok;
    return json({ ok: allOk, ...results });
  } catch (err) {
    console.error("test-gotenberg-connection error:", err);
    return json({ error: `Internal error: ${err}` }, 500);
  }
});
