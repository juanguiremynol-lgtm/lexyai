/**
 * ingest-source-health — ITERATION 46 (D1/D2).
 *
 * SAMAI's scraping has been frozen since 27 July. Our CPACA matters therefore
 * look "silent" when in fact we are not reading. Until now that silence was
 * invisible: the user saw an up-to-date screen with no data behind it.
 *
 * This runner pulls GCP's per-source, per-branch health and stores it so the
 * UI can say, in Spanish and attributed, that the SOURCE is stale rather than
 * implying the matter is.
 *
 * Two rules are non-negotiable here:
 *   · LIVE STATE WINS. A backfilled `consecutive_errors` reconstruction may not
 *     override a last run that succeeded — the DB trigger enforces this too.
 *   · NOT_FOUND and SUCCESS_EMPTY ARE SUCCESSES. They are determinations, not
 *     failures, and counting them as errors manufactures critical alerts.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { upstreamBaseUrl, upstreamHeaders } from "../_shared/upstreamEndpoints.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUCCESSFUL = new Set(["SUCCESS", "SUCCESS_EMPTY", "NOT_FOUND", "OK"]);

export interface SourceHealthRow {
  source: string;
  branch: string;
  status: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  consecutive_errors: number;
  consecutive_empty_runs: number;
  last_error_code: string | null;
  last_error_message: string | null;
  parsed_rows: number | null;
}

/** Normalise GCP's shape and apply the live-state-wins rule. */
export function normalizeSourceHealth(raw: unknown): SourceHealthRow[] {
  const root = raw as Record<string, unknown> | null;
  const list = (Array.isArray(root?.fuentes)
    ? root!.fuentes
    : Array.isArray(root?.sources)
      ? root!.sources
      : Array.isArray(raw)
        ? raw
        : []) as Array<Record<string, unknown>>;

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  return list.map((r) => {
    const status = (str(r.status) ?? str(r.estado) ?? "UNKNOWN").toUpperCase();
    const reconstructed = num(r.consecutive_errors ?? r.errores_consecutivos);
    return {
      source: (str(r.source) ?? str(r.fuente) ?? "UNKNOWN").toLowerCase(),
      branch: (str(r.branch) ?? str(r.rama) ?? str(r.workflow_type) ?? "ALL").toUpperCase(),
      status,
      last_run_at: str(r.last_run_at) ?? str(r.ultima_ejecucion),
      last_success_at: str(r.last_success_at) ?? str(r.ultimo_exito),
      last_error_at: str(r.last_error_at) ?? str(r.ultimo_error),
      // LIVE STATE WINS: a successful last run zeroes the streak.
      consecutive_errors: SUCCESSFUL.has(status) ? 0 : reconstructed,
      consecutive_empty_runs: num(r.consecutive_empty_runs ?? r.vacios_consecutivos),
      last_error_code: str(r.last_error_code) ?? str(r.codigo_error),
      last_error_message: str(r.last_error_message) ?? str(r.mensaje_error),
      parsed_rows: typeof r.parsed_rows === "number" ? r.parsed_rows : null,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = `${upstreamBaseUrl("andromeda_read")}/salud/source-health`;
  let payload: unknown = null;
  let httpStatus: number | null = null;

  try {
    const res = await fetch(url, { headers: upstreamHeaders("andromeda_read") });
    httpStatus = res.status;
    if (res.ok) payload = await res.json();
  } catch (err) {
    return json({ ok: false, endpoint: url, error: String(err) }, 502);
  }

  if (!payload) {
    // A failed read asserts nothing: leave the stored health untouched.
    return json({ ok: false, endpoint: url, http_status: httpStatus, error: "lectura_no_concluyente" }, 502);
  }

  const rows = normalizeSourceHealth(payload).filter((r) => r.source !== "unknown");
  const now = new Date().toISOString();

  for (const row of rows) {
    await supabase.from("upstream_source_health").upsert(
      { ...row, raw: payload as Record<string, unknown>, observed_at: now },
      { onConflict: "source,branch" },
    );
  }

  const degraded = rows.filter((r) => !SUCCESSFUL.has(r.status));

  return json({
    ok: true,
    endpoint: url,
    ingeridas: rows.length,
    degradadas: degraded.length,
    fuentes: rows.map((r) => ({
      source: r.source, branch: r.branch, status: r.status,
      last_success_at: r.last_success_at, consecutive_errors: r.consecutive_errors,
    })),
  });
});
