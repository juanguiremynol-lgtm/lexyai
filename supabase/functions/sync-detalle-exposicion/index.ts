/**
 * sync-detalle-exposicion — ITERATION 46.
 *
 * Corrections carried by this runner:
 *
 *  · HOST (iter45). `/reserva/estado` was never on andromeda-read-api; it is
 *    served by cpnu-https-jobs. The 404s we read as "GCP did not ship it" were
 *    our own wrong host. The route comes from the central endpoint registry.
 *  · PARAMETER (iter46). The query parameter is `numero_radicacion`. Sending
 *    `radicado` produced an error we were reading as absence.
 *  · VOCABULARY (iter46). We record the provider's own term, PROCESO_PRIVADO,
 *    and attribute it. We do not assert *why*: the provider never declares a
 *    cause, and "reserva sumarial" was our interpretation, not its statement.
 *
 * An unreachable endpoint asserts nothing: a failed read never becomes a
 * statement about the matter.
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

export interface ExposicionReading {
  expuesto: boolean | null;
  motivo: string | null;
  desde: string | null;
  ultima_verificacion: string | null;
  ttl_days: number | null;
  raw: Record<string, unknown> | null;
}

/** Parse the provider's exposure block. Absence is never read as "expuesto". */
export function parseExposicion(payload: unknown): ExposicionReading {
  const empty: ExposicionReading = {
    expuesto: null, motivo: null, desde: null,
    ultima_verificacion: null, ttl_days: null, raw: null,
  };
  if (!payload || typeof payload !== "object") return empty;
  const root = payload as Record<string, unknown>;
  const b = (root.reserva ?? root.exposicion ?? root.estado ?? root.data ?? root) as Record<string, unknown>;
  if (!b || typeof b !== "object") return empty;

  const flag = b.es_privado ?? b.esPrivado ?? b.privado ?? b.en_reserva ?? b.detalle_no_expuesto;
  // The provider states NON-exposure; we store the positive form.
  const expuesto = typeof flag === "boolean" ? !flag : null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const ttlRaw = b.ttl_days ?? b.ttlDias ?? b.ttl;

  return {
    expuesto,
    motivo: str(b.motivo) ?? str(b.motivo_ausencia) ?? (expuesto === false ? "PROCESO_PRIVADO" : null),
    desde: str(b.desde) ?? str(b.reserva_desde) ?? str(b.inicio),
    ultima_verificacion:
      str(b.ultima_verificacion) ?? str(b.ultimaVerificacion) ?? str(b.verificado_en),
    ttl_days: typeof ttlRaw === "number" && Number.isFinite(ttlRaw) ? ttlRaw : null,
    raw: b as Record<string, unknown>,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { work_item_id?: string } = {};
  try { body = await req.json(); } catch { /* portfolio pass */ }

  // ITER45 — exposure is not a penal concept: any matter can have its detail
  // withheld, so the portfolio pass is no longer restricted by workflow.
  let query = supabase
    .from("work_items")
    .select("id, radicado, workflow_type, provider_detail_exposure")
    .is("deleted_at", null)
    .not("radicado", "is", null);
  if (body.work_item_id) query = query.eq("id", body.work_item_id);

  const { data: items, error } = await query.limit(200);
  if (error) return json({ ok: false, error: error.message }, 500);

  const base = upstreamBaseUrl("cpnu_jobs");
  const headers = upstreamHeaders("cpnu_jobs");
  const results: Array<Record<string, unknown>> = [];

  for (const wi of items ?? []) {
    const radicado = String(wi.radicado ?? "").replace(/\D/g, "");
    if (!radicado) continue;

    let reading: ExposicionReading | null = null;
    let httpStatus: number | null = null;
    try {
      const res = await fetch(
        `${base}/reserva/estado?numero_radicacion=${radicado}`,
        { headers },
      );
      httpStatus = res.status;
      if (res.ok) reading = parseExposicion(await res.json());
    } catch {
      httpStatus = null;
    }

    if (!reading || reading.expuesto === null) {
      results.push({ work_item_id: wi.id, radicado, estado: "LECTURA_FALLIDA", http_status: httpStatus });
      continue;
    }

    const { data: applied, error: rpcErr } = await supabase.rpc("apply_detalle_exposicion", {
      p_work_item_id: wi.id,
      p_expuesto: reading.expuesto,
      p_concluyente: true,
      p_motivo: reading.motivo,
      p_desde: reading.desde,
      p_ultima_verificacion: reading.ultima_verificacion,
      p_ttl_days: reading.ttl_days,
    });

    results.push({
      work_item_id: wi.id,
      radicado,
      estado: reading.expuesto ? "DETALLE_EXPUESTO" : "PROCESO_PRIVADO",
      cambio: (applied as { changed?: boolean } | null)?.changed ?? false,
      error: rpcErr?.message ?? null,
    });
  }

  return json({
    ok: true,
    host: base,
    evaluados: results.length,
    cambios: results.filter((r) => r.cambio).length,
    lecturas_fallidas: results.filter((r) => r.estado === "LECTURA_FALLIDA").length,
    resultados: results,
  });
});