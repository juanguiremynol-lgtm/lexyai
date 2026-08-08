/**
 * ingest-source-health — ITERATION 46 (D1/D2).
 *
 * SAMAI's scraping has been frozen since 27 July, so our CPACA matters look
 * "silent" when in fact we are not reading. Until now that was invisible: the
 * user saw a confident, up-to-date screen with nothing behind it.
 *
 * CONTRACT NOTE (probed live, 2026-08-08): `/salud/source-health` does NOT
 * exist on andromeda-read-api — a 404 on the route itself, not on a sample. The
 * per-source truth is carried by `/radicados`, which reports, per radicado,
 * `en_pp / en_cpnu / en_samai / en_samai_estados` plus each source's last state
 * and row counts. We therefore DERIVE source health from the inventory rather
 * than inventing an endpoint, and we record where the reading came from.
 *
 * Two rules are non-negotiable:
 *   · LIVE STATE WINS. A reconstructed error streak may not override a last run
 *     that succeeded. The DB trigger enforces this independently.
 *   · NOT_FOUND and SUCCESS_EMPTY ARE SUCCESSES. They are determinations, not
 *     failures; counting them as errors manufactures critical alerts.
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

/** LIVE STATE WINS — exported so the parity test can assert the rule directly. */
export function normalizeStreak(status: string, reconstructed: number): number {
  return SUCCESSFUL.has((status ?? "").toUpperCase()) ? 0 : Math.max(reconstructed ?? 0, 0);
}

export interface DerivedSourceHealth {
  source: string;
  branch: string;
  status: string;
  last_success_at: string | null;
  consecutive_errors: number;
  consecutive_empty_runs: number;
  parsed_rows: number;
  last_error_message: string | null;
}

const SOURCES = [
  { key: "cpnu", flag: "en_cpnu", state: "cpnu_estado", rows: "cpnu_total_actuaciones", at: "cpnu_last_run_at" },
  { key: "publicaciones", flag: "en_pp", state: "pp_estado", rows: "pp_total_actuaciones", at: "pp_last_run_at" },
  { key: "samai", flag: "en_samai", state: "samai_estado", rows: "samai_total_actuaciones", at: "samai_last_run_at" },
  { key: "samai_estados", flag: "en_samai_estados", state: "samai_estados_estado", rows: "samai_estados_total", at: "samai_estados_last_run_at" },
] as const;

/**
 * A source is only judged on the radicados actually ENROLLED in it. Judging
 * SAMAI on CGP matters would report a permanent outage that does not exist.
 */
export function deriveSourceHealth(
  inventory: Array<Record<string, unknown>>,
): DerivedSourceHealth[] {
  const out: DerivedSourceHealth[] = [];

  for (const src of SOURCES) {
    const enrolled = inventory.filter((r) => r[src.flag] === true);
    if (enrolled.length === 0) continue;

    const states = enrolled.map((r) => String(r[src.state] ?? "").toUpperCase());
    const ok = states.filter((s) => SUCCESSFUL.has(s)).length;
    const unread = states.filter((s) => !s || s === "NULL").length;
    const errored = states.length - ok - unread;

    const times = enrolled
      .map((r) => (typeof r[src.at] === "string" ? Date.parse(r[src.at] as string) : NaN))
      .filter((n) => Number.isFinite(n)) as number[];
    const lastSuccessAt = times.length ? new Date(Math.max(...times)).toISOString() : null;

    // Never read at all is not the same as failing; both are "no lectura".
    const status = errored > 0 ? "DEGRADED" : ok > 0 ? "SUCCESS" : "SIN_LECTURA";

    out.push({
      source: src.key,
      branch: "ALL",
      status,
      last_success_at: lastSuccessAt,
      consecutive_errors: normalizeStreak(status, errored),
      consecutive_empty_runs: unread,
      parsed_rows: enrolled.reduce(
        (n, r) => n + (typeof r[src.rows] === "number" ? (r[src.rows] as number) : 0), 0),
      last_error_message:
        status === "SUCCESS"
          ? null
          : `${errored} con error y ${unread} sin lectura de ${enrolled.length} radicados inscritos en la fuente.`,
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

  const url = `${upstreamBaseUrl("andromeda_read")}/radicados`;
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
    return json(
      { ok: false, endpoint: url, http_status: httpStatus, error: "lectura_no_concluyente" },
      502,
    );
  }

  const root = payload as Record<string, unknown>;
  const inventory = (Array.isArray(root.radicados) ? root.radicados : []) as Array<Record<string, unknown>>;
  const rows = deriveSourceHealth(inventory);
  const now = new Date().toISOString();

  for (const row of rows) {
    await supabase.from("upstream_source_health").upsert(
      {
        ...row,
        last_run_at: now,
        last_error_at: row.status === "SUCCESS" ? null : now,
        last_error_code: row.status === "SUCCESS" ? null : row.status,
        raw: { derived_from: "andromeda_read:/radicados", inventario: inventory.length },
        observed_at: now,
      },
      { onConflict: "source,branch" },
    );
  }

  const degraded = rows.filter((r) => r.status !== "SUCCESS");

  return json({
    ok: true,
    endpoint: url,
    nota: "Derivado de /radicados: /salud/source-health no existe en andromeda-read-api (404 de ruta, verificado).",
    inventario: inventory.length,
    ingeridas: rows.length,
    degradadas: degraded.length,
    fuentes: rows,
  });
});
