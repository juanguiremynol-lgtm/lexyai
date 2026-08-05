/**
 * ingest-pp-coverage-census — Iteration 34, item 6.
 *
 * GCP publishes per-despacho orphan counts under source='PP_COVERAGE' at
 * GET /salud/radicados?source=PP_COVERAGE. We ingest them into
 * `provider_coverage_census` and reconcile them against our own detector.
 * The two detectors must agree on the same number; a divergence is itself the
 * finding and is reported, never silently smoothed over.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type CensusRow = {
  despacho_code: string;
  despacho_label: string | null;
  orphan_count: number;
  first_publication: string | null;
  last_publication: string | null;
  raw: Record<string, unknown>;
};

function normaliseRows(payload: any): CensusRow[] {
  const rows: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.radicados)
      ? payload.radicados
      : Array.isArray(payload?.despachos)
        ? payload.despachos
        : Array.isArray(payload?.data)
          ? payload.data
          : [];
  const out: CensusRow[] = [];
  for (const r of rows) {
    const code = String(r?.despacho_code ?? r?.despacho ?? r?.codigo_despacho ?? "").replace(/\D/g, "");
    if (!code) continue;
    out.push({
      despacho_code: code,
      despacho_label: r?.despacho_label ?? r?.nombre ?? r?.label ?? null,
      orphan_count: Number(r?.orphan_count ?? r?.huerfanos ?? r?.orphans ?? 0) || 0,
      first_publication: typeof r?.first_publication === "string" ? r.first_publication.slice(0, 10)
        : (typeof r?.primera_publicacion === "string" ? r.primera_publicacion.slice(0, 10) : null),
      last_publication: typeof r?.last_publication === "string" ? r.last_publication.slice(0, 10)
        : (typeof r?.ultima_publicacion === "string" ? r.ultima_publicacion.slice(0, 10) : null),
      raw: typeof r === "object" && r !== null ? r : {},
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const baseUrl = Deno.env.get("PUBLICACIONES_BASE_URL");
  const apiKey = Deno.env.get("PUBLICACIONES_X_API_KEY") || Deno.env.get("EXTERNAL_X_API_KEY");
  if (!baseUrl) {
    return json({ ok: false, status: "configuration_error", reason: "missing_base_url" });
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/salud/radicados?source=PP_COVERAGE`;
  let payload: any = null;
  let httpStatus: number | null = null;
  try {
    const res = await fetch(url, {
      headers: apiKey ? { "X-API-Key": apiKey, Accept: "application/json" } : { Accept: "application/json" },
    });
    httpStatus = res.status;
    if (!res.ok) {
      // The endpoint is not live yet on the provider side; report cleanly so the
      // panel can distinguish "not published yet" from "we disagree".
      const reconciliation = await supabase.rpc("estados_coverage_reconciliation");
      return json({
        ok: false,
        status: "provider_unavailable",
        http_status: httpStatus,
        endpoint: "/salud/radicados?source=PP_COVERAGE",
        ingested: 0,
        reconciliation: reconciliation.data ?? null,
      });
    }
    payload = await res.json();
  } catch (err) {
    return json({ ok: false, status: "provider_unreachable", error: String((err as Error)?.message ?? err) });
  }

  const rows = normaliseRows(payload);
  const fetchedAt = new Date().toISOString();
  if (rows.length > 0) {
    const { error } = await supabase
      .from("provider_coverage_census")
      .upsert(
        rows.map((r) => ({ source: "PP_COVERAGE", ...r, fetched_at: fetchedAt })),
        { onConflict: "source,despacho_code" },
      );
    if (error) {
      return json({ ok: false, status: "persist_error", error: error.message, rows: rows.length });
    }
  }

  const { data: reconciliation } = await supabase.rpc("estados_coverage_reconciliation");
  const divergent = ((reconciliation as any)?.filas ?? []).filter((f: any) => f.coincide === false);

  return json({
    ok: true,
    http_status: httpStatus,
    ingested: rows.length,
    fetched_at: fetchedAt,
    reconciliation,
    divergencias: divergent,
    // A divergence between the two detectors is itself the finding.
    detectores_coinciden: divergent.length === 0,
  });
});