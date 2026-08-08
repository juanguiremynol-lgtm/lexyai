/**
 * upstream-endpoint-probe — ITERATION 45 (B2).
 *
 * Walks every endpoint in the registry against its declared host and records
 * the outcome. The point is to distinguish three things we kept conflating:
 *
 *   RESUELVE      — the route exists (2xx, or 401/403: guarded, therefore real)
 *   NO_EXISTE     — 404: the route genuinely is not there
 *   INALCANZABLE  — DNS/TLS/timeout: nothing can be concluded
 *
 * A 404 for a *sample* (an id upstream does not know) is NOT the same as a 404
 * for the *route*; endpoints that take an id declare 404 as resolving so a
 * missing sample never masquerades as a missing feature.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  UPSTREAM_ENDPOINTS,
  UPSTREAM_HOSTS,
  buildEndpointUrl,
  endpointResolves,
  upstreamHeaders,
  upstreamBaseUrl,
} from "../_shared/upstreamEndpoints.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TIMEOUT_MS = 12_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { radicado?: string; work_item_id?: string } = {};
  try { body = await req.json(); } catch { /* portfolio-wide probe */ }

  // Use a real matter as sample so id-bearing routes get a fair probe.
  let radicado = body.radicado ?? null;
  let workItemId = body.work_item_id ?? null;
  if (!radicado || !workItemId) {
    const { data: sample } = await supabase
      .from("work_items")
      .select("id, radicado")
      .is("deleted_at", null)
      .not("radicado", "is", null)
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    radicado = radicado ?? (sample?.radicado ?? null);
    workItemId = workItemId ?? (sample?.id ?? null);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const ep of UPSTREAM_ENDPOINTS) {
    const url = buildEndpointUrl(ep, {
      radicado: (radicado ?? "").replace(/\D/g, ""),
      workItemId: workItemId ?? "",
    });
    const started = Date.now();
    let status: number | null = null;
    let outcome: "RESUELVE" | "NO_EXISTE" | "INALCANZABLE" = "INALCANZABLE";
    let detail: string | null = null;

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        method: ep.method,
        headers: ep.method === "POST"
          ? { ...upstreamHeaders(ep.host), "Content-Type": "application/json" }
          : upstreamHeaders(ep.host),
        body: ep.method === "POST" ? JSON.stringify(ep.probeBody ?? {}) : undefined,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      status = res.status;
      outcome = endpointResolves(ep, res.status)
        ? "RESUELVE"
        : res.status === 404
          ? "NO_EXISTE"
          : "INALCANZABLE";
      detail = (await res.text().catch(() => "")).slice(0, 300) || null;
    } catch (err) {
      detail = err instanceof Error ? err.message.slice(0, 300) : String(err);
    }

    const row = {
      endpoint_key: ep.key,
      host_key: ep.host,
      base_url: upstreamBaseUrl(ep.host),
      path: ep.path,
      method: ep.method,
      purpose: ep.purpose,
      http_status: status,
      outcome,
      latency_ms: Date.now() - started,
      detail,
      probed_at: new Date().toISOString(),
    };
    results.push(row);
    await supabase.from("upstream_endpoint_probes").upsert(row, { onConflict: "endpoint_key" });
  }

  const missing = results.filter((r) => r.outcome === "NO_EXISTE");
  const unreachable = results.filter((r) => r.outcome === "INALCANZABLE");

  return json({
    ok: true,
    sample: { radicado, work_item_id: workItemId },
    hosts: Object.values(UPSTREAM_HOSTS).map((h) => ({ key: h.key, base_url: upstreamBaseUrl(h.key) })),
    total: results.length,
    resuelven: results.length - missing.length - unreachable.length,
    no_existen: missing.length,
    inalcanzables: unreachable.length,
    resultados: results,
  });
});