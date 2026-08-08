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
  let sampleHasClase = false;
  if (!radicado || !workItemId) {
    // ITER49 — /clase-proceso needs a matter the provider actually knows and
    // has answered a clase for; the previous "most recently synced" sample
    // could be any matter, so the route was probed with an id upstream had
    // never classified and the outcome said nothing about the route.
    let sample: { id: string; radicado: string | null } | null = null;
    const { data: classified } = await supabase
      .from("work_items")
      .select("id, radicado")
      .is("deleted_at", null)
      .not("radicado", "is", null)
      .eq("clase_proceso_disponible", true)
      .order("clase_proceso_observed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    sample = (classified as typeof sample) ?? null;
    sampleHasClase = !!sample;
    if (!sample) {
      const { data: fallback } = await supabase
        .from("work_items")
        .select("id, radicado")
        .is("deleted_at", null)
        .not("radicado", "is", null)
        .order("last_synced_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      sample = (fallback as typeof sample) ?? null;
    }
    radicado = radicado ?? (sample?.radicado ?? null);
    workItemId = workItemId ?? (sample?.id ?? null);
  }

  const results: Array<Record<string, unknown>> = [];
  // ITER48 — the upsert used to be fire-and-forget, so a missing unique index
  // on endpoint_key kept the table empty while this function reported ok:true.
  // Persistence failures are now surfaced, never swallowed.
  const persistErrors: Array<{ endpoint_key: string; error: string }> = [];

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
    // ITER49 — a throw here (network blip on the DB call) used to escape the
    // loop and abort the whole probe with a 500 that reported nothing. Every
    // persistence failure, returned OR thrown, lands in persist_errors.
    try {
      const { error: persistError } = await supabase
        .from("upstream_endpoint_probes")
        .upsert(row, { onConflict: "endpoint_key" });
      if (persistError) persistErrors.push({ endpoint_key: ep.key, error: persistError.message });
    } catch (err) {
      persistErrors.push({
        endpoint_key: ep.key,
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
    }
  }

  const missing = results.filter((r) => r.outcome === "NO_EXISTE");
  const unreachable = results.filter((r) => r.outcome === "INALCANZABLE");
  const guarded = results.filter((r) => r.outcome === "RESUELVE_GUARDADO");
  const erroring = results.filter((r) => r.outcome === "RESPONDE_CON_ERROR");
  const indeterminate = results.filter((r) => r.outcome === "INDETERMINADO");

  return json({
    ok: persistErrors.length === 0,
    persist_errors: persistErrors,
    sample: { radicado, work_item_id: workItemId },
    sample_clase_disponible: sampleHasClase,
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