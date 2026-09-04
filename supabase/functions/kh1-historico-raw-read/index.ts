// KH1 — RAW READ, READ-ONLY.
// Issues exactly the request the nightly run already makes:
//   GET {PUBLICACIONES_BASE_URL}/historico/{radicado}
// and stores the literal body in external_sync_run_payloads (stage
// HISTORICO_RAW). It does NOT call /procesar-radicado, does NOT touch the
// novedades queue, and writes NO estado, term, state or provider row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { upstreamBaseUrl, upstreamHeaders } from "../_shared/upstreamEndpoints.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGETS = [
  "05376311200120230031400",
  "05376311200120230029200",
];

function pickArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const k of ["estados", "publicaciones", "historico", "data", "items", "results"]) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function pickDate(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  for (const k of ["fecha", "fecha_publicacion", "fecha_estado", "fecha_fijacion", "date"]) {
    const v = r[k];
    if (typeof v === "string" && v.length >= 8) return v;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const base = upstreamBaseUrl("publicaciones");
  const headers = upstreamHeaders("publicaciones");
  const report: unknown[] = [];

  for (const radicado of TARGETS) {
    const url = `${base}/historico/${radicado}`;
    const t0 = Date.now();
    let http_status = 0;
    let bodyText = "";
    let parsed: unknown = null;
    let parse_error: string | null = null;
    let transport_error: string | null = null;

    try {
      const res = await fetch(url, { method: "GET", headers });
      http_status = res.status;
      bodyText = await res.text();
      try {
        parsed = JSON.parse(bodyText);
      } catch (e) {
        parse_error = (e as Error).message;
      }
    } catch (e) {
      transport_error = (e as Error).message;
    }

    const rows = pickArray(parsed);
    const dates = rows.map(pickDate).filter((d): d is string => !!d).sort();
    const summary = {
      radicado,
      endpoint: "GET /historico/{radicado}",
      url,
      http_status,
      latency_ms: Date.now() - t0,
      body_bytes: bodyText.length,
      payload_count: rows.length,
      max_fecha: dates.length ? dates[dates.length - 1] : null,
      min_fecha: dates.length ? dates[0] : null,
      parse_error,
      transport_error,
      top_level_keys:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? Object.keys(parsed as Record<string, unknown>)
          : (Array.isArray(parsed) ? ["<array>"] : []),
    };

    const { data: wi } = await supabase
      .from("work_items")
      .select("id")
      .eq("radicado", radicado)
      .limit(1)
      .maybeSingle();

    const { error: insErr } = await supabase.from("external_sync_run_payloads").insert({
      sync_run_id: null,
      work_item_id: wi?.id ?? null,
      radicado,
      provider_name: "publicaciones",
      // stage CHECK constraint only admits the six legacy values; HISTORICO_RAW
      // is rejected. Using "response" until the constraint is widened.
      stage: "response",
      endpoint: "GET /historico/{radicado}",
      http_status,
      payload_json: { summary, body: parsed ?? bodyText },
      payload_size_bytes: bodyText.length,
    } as any);

    report.push({ ...summary, persist_error: insErr?.message ?? null });
  }

  return new Response(JSON.stringify({ ok: true, report }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
