/**
 * ingest-pp-coverage-census — Iteration 35 (supersedes iteration 34).
 *
 * The per-despacho orphan census is published by the Andromeda read API under
 * `GET /salud/radicados?source=PP_COVERAGE`, NOT by the Publicaciones
 * Procesales API (which 404s on that path — that was the iteration-34 bug).
 *
 * The payload is a `salud[]` array whose `radicado` field carries the despacho
 * code and whose `last_run_status` carries the counters:
 *   "ORPHAN_FIJACIONES=5 sin_publicacion=5 radicado_ausente=0 sin_fecha=0"
 *
 * We ingest every row verbatim. Rows with `workflow_type: null` or
 * `activo: null` are NOT filtered out — the census is a source-level artefact
 * and carries no workflow attribution by design.
 *
 * The two detectors (ours and the provider's) must agree on the same number;
 * a divergence is itself the finding and is reported, never smoothed over.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ANDROMEDA_API_BASE =
  "https://andromeda-read-api-11974381924.us-central1.run.app";

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

/** Parse "ORPHAN_FIJACIONES=5 sin_publicacion=5 radicado_ausente=0 sin_fecha=0". */
export function parseCensusStatus(status: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof status !== "string") return out;
  for (const m of status.matchAll(/([A-Za-z_]+)\s*=\s*(-?\d+)/g)) {
    out[m[1].toLowerCase()] = Number(m[2]);
  }
  return out;
}

export function normaliseRows(payload: any): CensusRow[] {
  const rows: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.salud)
      ? payload.salud
      : Array.isArray(payload?.radicados)
        ? payload.radicados
        : Array.isArray(payload?.despachos)
          ? payload.despachos
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
  const out: CensusRow[] = [];
  for (const r of rows) {
    const code = String(
      r?.despacho_code ?? r?.radicado ?? r?.despacho ?? r?.codigo_despacho ?? "",
    ).replace(/\D/g, "");
    if (!code) continue;
    const counters = parseCensusStatus(r?.last_run_status);
    const orphan =
      Number(
        r?.orphan_count ??
          r?.huerfanos ??
          r?.orphans ??
          counters.orphan_fijaciones ??
          0,
      ) || 0;
    out.push({
      despacho_code: code,
      despacho_label: r?.despacho_label ?? r?.nombre ?? r?.label ?? null,
      orphan_count: orphan,
      first_publication: typeof r?.first_publication === "string"
        ? r.first_publication.slice(0, 10)
        : (typeof r?.primera_publicacion === "string" ? r.primera_publicacion.slice(0, 10) : null),
      last_publication: typeof r?.last_publication === "string"
        ? r.last_publication.slice(0, 10)
        : (typeof r?.ultima_publicacion === "string" ? r.ultima_publicacion.slice(0, 10) : null),
      raw: {
        ...(typeof r === "object" && r !== null ? r : {}),
        _counters: counters,
      },
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

  const apiKey = Deno.env.get("ANDROMEDA_API_KEY") || Deno.env.get("EXTERNAL_X_API_KEY") || "";
  const url = `${ANDROMEDA_API_BASE}/salud/radicados?source=PP_COVERAGE`;

  let payload: any = null;
  let httpStatus: number | null = null;
  try {
    const res = await fetch(url, {
      headers: apiKey ? { "X-API-Key": apiKey, Accept: "application/json" } : { Accept: "application/json" },
    });
    httpStatus = res.status;
    if (!res.ok) {
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
    total_huerfanos_proveedor: rows.reduce((a, r) => a + r.orphan_count, 0),
    fetched_at: fetchedAt,
    reconciliation,
    divergencias: divergent,
    detectores_coinciden: divergent.length === 0,
  });
});
