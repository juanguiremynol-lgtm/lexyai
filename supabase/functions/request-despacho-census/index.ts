/**
 * request-despacho-census — Iteration 55 (C3).
 *
 * Drains `despacho_census_requests`: every work item created for a despacho we
 * have never measured enqueues one request. This function asks the provider for
 * the census window and records the answer.
 *
 * Discipline (iteration 35 doctrine, reinforced here):
 *   - An INCONCLUSIVE / failed census window is recorded as NOT MEASURED
 *     (`measurement_status = 'INDETERMINADO'`). It NEVER becomes
 *     "never published", and it never silences an orphan fijación.
 *   - A measured window with zero volume in every year is only written as fact
 *     when a control despacho of the same circuit was measured too — the DB
 *     trigger `trg_guard_zero_census` enforces that, this function supplies it.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { resolveHost } from "../_shared/upstreamEndpoints.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Control despacho = same circuit, a sibling office code, to prove the
 *  instrument reaches that circuit at all. */
export function controlDespachoFor(code: string, siblings: string[]): string | null {
  const circuit = code.slice(0, 8);
  return siblings.find((s) => s !== code && s.slice(0, 8) === circuit) ?? null;
}

export function annualVolumesTotal(v: Record<string, unknown> | null | undefined): number {
  if (!v) return 0;
  return Object.values(v).reduce<number>((a, n) => a + (Number(n) || 0), 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const host = resolveHost("publicaciones");
  const baseUrl = host.baseUrl;
  const apiKey = host.apiKey ?? "";

  const { data: pending, error: qErr } = await supabase
    .from("despacho_census_requests")
    .select("id, despacho_code, radicado, attempts")
    .eq("status", "PENDING")
    .order("requested_at", { ascending: true })
    .limit(10);

  if (qErr) return json({ ok: false, error: qErr.message }, 500);
  if (!pending?.length) return json({ ok: true, processed: 0, note: "sin solicitudes pendientes" });

  const { data: measured } = await supabase
    .from("despacho_coverage")
    .select("radicado_prefix")
    .eq("provider_key", "publicaciones")
    .eq("measurement_status", "MEDIDO");
  const measuredCodes = (measured ?? []).map((m: any) => String(m.radicado_prefix));

  const results: unknown[] = [];

  for (const row of pending) {
    const code = String(row.despacho_code);
    const url = `${baseUrl}/censo-despacho/${code}`;
    let payload: any = null;
    let httpStatus: number | null = null;
    try {
      const res = await fetch(url, {
        headers: apiKey ? { "X-API-Key": apiKey, Accept: "application/json" } : { Accept: "application/json" },
      });
      httpStatus = res.status;
      if (res.ok) payload = await res.json();
    } catch (err) {
      payload = null;
      results.push({ despacho: code, status: "ERROR", error: String((err as Error)?.message ?? err) });
    }

    // Anything other than a clean, complete answer is NOT a measurement.
    const complete =
      payload &&
      typeof payload === "object" &&
      payload.inconcluso !== true &&
      payload.status !== "INCONCLUSIVE" &&
      (payload.annual_volumes || payload.volumen_por_ano);

    if (!complete) {
      await supabase
        .from("despacho_census_requests")
        .update({
          status: "INDETERMINADO",
          attempts: (row.attempts ?? 0) + 1,
          result: { http_status: httpStatus, payload },
          error: "ventana de censo inconclusa — no se registra como medición",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      await supabase.from("despacho_coverage").upsert(
        {
          radicado_prefix: code,
          despacho_label: `Despacho ${code}`,
          note: "Censo solicitado: la ventana resultó inconclusa. No medido — no silencia ninguna fijación huérfana.",
          provider_key: "publicaciones",
          publishes: true,
          measurement_status: "INDETERMINADO",
          census_source: "CENSO_DESPACHO",
          checked_at: new Date().toISOString(),
        },
        { onConflict: "radicado_prefix,provider_key" },
      );
      results.push({ despacho: code, status: "INDETERMINADO", http_status: httpStatus });
      continue;
    }

    const annual: Record<string, number> = payload.annual_volumes ?? payload.volumen_por_ano ?? {};
    const total = annualVolumesTotal(annual);
    const control = total === 0 ? controlDespachoFor(code, measuredCodes) : null;

    if (total === 0 && !control) {
      // A zero report without a control is not a fact yet.
      await supabase
        .from("despacho_census_requests")
        .update({
          status: "INDETERMINADO",
          attempts: (row.attempts ?? 0) + 1,
          result: { annual_volumes: annual, reason: "cero sin despacho de control" },
          error: "censo en cero sin control del mismo circuito",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      results.push({ despacho: code, status: "CERO_SIN_CONTROL" });
      continue;
    }

    const first = typeof payload.first_publication === "string" ? payload.first_publication.slice(0, 10) : null;
    const last = typeof payload.last_publication === "string" ? payload.last_publication.slice(0, 10) : null;

    const { error: covErr } = await supabase.from("despacho_coverage").upsert(
      {
        radicado_prefix: code,
        despacho_label: payload.despacho_label ?? payload.nombre ?? `Despacho ${code}`,
        note: `Censo medido por el proveedor el ${new Date().toISOString().slice(0, 10)}.`,
        provider_key: "publicaciones",
        publishes: total > 0,
        publishes_from: first,
        publishes_until: last,
        from_confidence: typeof payload.from_confidence === "string" ? payload.from_confidence.toUpperCase() : null,
        until_confidence: typeof payload.until_confidence === "string" ? payload.until_confidence.toUpperCase() : null,
        annual_volumes: annual,
        monthly_presence: payload.monthly_presence ?? payload.presencia_mensual ?? {},
        measurement_status: "MEDIDO",
        control_despacho_code: control,
        control_result: control ? { despacho: control, reason: "mismo circuito, medido" } : null,
        census_source: "CENSO_DESPACHO",
        checked_at: new Date().toISOString(),
      },
      { onConflict: "radicado_prefix,provider_key" },
    );

    await supabase
      .from("despacho_census_requests")
      .update({
        status: covErr ? "ERROR" : "DONE",
        attempts: (row.attempts ?? 0) + 1,
        result: { annual_volumes: annual, first_publication: first, last_publication: last, control },
        error: covErr?.message ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    results.push({ despacho: code, status: covErr ? "ERROR" : "MEDIDO", total });
  }

  return json({ ok: true, processed: pending.length, results });
});
