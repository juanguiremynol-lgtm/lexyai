// Ephemeral diagnostic: probes CURRENT SAMAI_BASE_URL and samai-read-api for a radicado.
// Requires ADMIN_FORCE_SYNC_TOKEN in x-admin-token header. Returns counts + first item date.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const READ_API = "https://samai-read-api-11974381924.us-central1.run.app";

async function probe(url: string, apiKey: string | undefined, method: "GET"|"POST", body?: unknown) {
  const t0 = Date.now();
  const headers: Record<string,string> = { "content-type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20_000);
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    clearTimeout(to);
    const text = await r.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* noop */ }
    const container = json?.result ?? json ?? {};
    const acts = container.feedCombinado || container.actuaciones || container.feed_combinado || [];
    const first = Array.isArray(acts) && acts[0] ? acts[0] : null;
    return {
      url_host: new URL(url).host,
      method, status: r.status, ok: r.ok, latency_ms: Date.now()-t0,
      total_found: container.total_found ?? (Array.isArray(acts) ? acts.length : null),
      count: Array.isArray(acts) ? acts.length : 0,
      first_date: first?.fecha_actuacion || first?.fecha || first?.act_date || first?.fecha_registro || null,
      first_desc: (first?.descripcion || first?.actuacion || first?.description || "").toString().slice(0,120),
      keys: Object.keys(container).slice(0,20),
      body_preview: text.slice(0, 300),
    };
  } catch (e: any) {
    return { url_host: new URL(url).host, method, error: e?.message || String(e), latency_ms: Date.now()-t0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const token = req.headers.get("x-admin-token") || "";
  if (!token || token !== Deno.env.get("ADMIN_FORCE_SYNC_TOKEN")) {
    return new Response(JSON.stringify({ ok:false, error:"UNAUTHORIZED" }), { status: 401, headers: { ...corsHeaders, "content-type":"application/json" } });
  }
  const url = new URL(req.url);
  const radicado = url.searchParams.get("radicado") || "11001333704320260004700";

  const currentBase = (Deno.env.get("SAMAI_BASE_URL") || "").replace(/\/+$/,"");
  const samaiKey = Deno.env.get("SAMAI_X_API_KEY");
  const estadosKey = Deno.env.get("SAMAI_ESTADOS_API_KEY");
  const feedKey = Deno.env.get("SAMAI_FEED_API_KEY");

  const results: any = { radicado, current_base_host: currentBase ? new URL(currentBase).host : null, samai_x_api_key_present: !!samaiKey, samai_estados_api_key_present: !!estadosKey, samai_feed_api_key_present: !!feedKey };

  // (a) current adapter route
  if (currentBase) {
    results.current_post_snapshot = await probe(`${currentBase}/snapshot`, samaiKey, "POST", { radicado });
    results.current_get_snapshot_qs = await probe(`${currentBase}/snapshot?numero_radicacion=${radicado}`, samaiKey, "GET");
  }
  // (b) samai-read-api candidate — try multiple paths & auth keys
  const candidateKey = feedKey || samaiKey || estadosKey;
  results.read_api_snapshot_qs = await probe(`${READ_API}/snapshot?numero_radicacion=${radicado}`, candidateKey, "GET");
  results.read_api_feed_qs = await probe(`${READ_API}/feed?numero_radicacion=${radicado}`, candidateKey, "GET");
  results.read_api_buscar_qs = await probe(`${READ_API}/buscar?numero_radicacion=${radicado}`, candidateKey, "GET");
  results.read_api_proceso = await probe(`${READ_API}/proceso/${radicado}`, candidateKey, "GET");
  results.read_api_root = await probe(`${READ_API}/`, candidateKey, "GET");

  return new Response(JSON.stringify(results, null, 2), { headers: { ...corsHeaders, "content-type":"application/json" } });
});
