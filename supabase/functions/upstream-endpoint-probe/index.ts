/**
 * upstream-endpoint-probe — ITERATION 46 (C).
 *
 * Walks every endpoint in the registry against its declared host and records
 * the outcome. ITER46 splits the outcomes further, because a 200 was proving
 * less than we assumed:
 *
 *   RESUELVE           — answered AND the body asserts success
 *   RESUELVE_GUARDADO  — 401/403: `allUsers` is not granted on these Cloud Run
 *                        services, so this is the EXPECTED unauthenticated
 *                        answer and proves the route exists
 *   RESPONDE_CON_ERROR — answered 200 carrying an error envelope
 *   INDETERMINADO      — answered, but the body cannot assert success
 *   NO_EXISTE          — 404 on the route itself
 *   INALCANZABLE       — DNS/TLS/timeout: nothing can be concluded
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
  classifyProbe,
  type ProbeOutcome,
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
    let outcome: ProbeOutcome = "INALCANZABLE";
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
      const text = await res.text().catch(() => "");
      let parsed: unknown = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
      outcome = classifyProbe(ep, res.status, parsed);
      detail = text.slice(0, 300) || null;
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
      resolves: outcome === "RESUELVE" || outcome === "RESUELVE_GUARDADO",
      latency_ms: Date.now() - started,
      detail,
      probed_at: new Date().toISOString(),
    };
    results.push(row);
    await supabase.from("upstream_endpoint_probes").upsert(row, { onConflict: "endpoint_key" });
  }

  const missing = results.filter((r) => r.outcome === "NO_EXISTE");
  const unreachable = results.filter((r) => r.outcome === "INALCANZABLE");
  const guarded = results.filter((r) => r.outcome === "RESUELVE_GUARDADO");
  const erroring = results.filter((r) => r.outcome === "RESPONDE_CON_ERROR");
  const indeterminate = results.filter((r) => r.outcome === "INDETERMINADO");

  return json({
    ok: true,
    sample: { radicado, work_item_id: workItemId },
    hosts: Object.values(UPSTREAM_HOSTS).map((h) => ({ key: h.key, base_url: upstreamBaseUrl(h.key) })),
    total: results.length,
    resuelven: results.filter((r) => r.outcome === "RESUELVE").length,
    resuelven_guardados: guarded.length,
    responden_con_error: erroring.length,
    indeterminados: indeterminate.length,
    no_existen: missing.length,
    inalcanzables: unreachable.length,
    resultados: results,
  });
});