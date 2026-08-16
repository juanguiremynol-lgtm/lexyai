/**
 * iter60-probe — TEMPORARY discovery probe for ITERATION 60.
 *
 * GCP published vw_instancias_sin_suscribir / vw_instancias_cobertura and a
 * CPNU documents surface. Their HTTP path names were not given to us, so this
 * walks a candidate list against the verified hosts and reports what answers.
 */
import { upstreamBaseUrl, upstreamHeaders } from "../_shared/upstreamEndpoints.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CANDIDATES: Array<[string, string]> = [];
const SKIP_DEFAULTS = true;
for (const host of ["cpnu_read", "andromeda_read", "cpnu_jobs"]) {
  for (
    const p of [
      "/instancias/sin-suscribir",
      "/instancias/pendientes",
      "/instancias",
      "/instancias/cobertura",
      "/recursos/instancias",
      "/salud/instancias",
      "/openapi.json",
    ]
  ) CANDIDATES.push([host, p]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const extra: string[] = [];
  try {
    const b = await req.json();
    if (Array.isArray(b?.paths)) extra.push(...b.paths);
  } catch { /* no body */ }
  const list = [...(SKIP_DEFAULTS ? [] : CANDIDATES), ...extra.map((p) => {
    const [h, ...rest] = p.split("|");
    return [h, rest.join("|")] as [string, string];
  })];

  const out: unknown[] = [];
  for (const [host, path] of list) {
    // deno-lint-ignore no-explicit-any
    const h = host as any;
    const url = `${upstreamBaseUrl(h)}${path}`;
    try {
      const r = await fetch(url, { headers: upstreamHeaders(h) });
      const text = (await r.text()).slice(0, 6000);
      out.push({ host, path, status: r.status, body: text });
    } catch (e) {
      out.push({ host, path, error: String(e).slice(0, 200) });
    }
  }
  return new Response(JSON.stringify({ ok: true, results: out }, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
