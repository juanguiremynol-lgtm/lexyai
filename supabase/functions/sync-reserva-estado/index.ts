/**
 * sync-reserva-estado — ITERATION 44.
 *
 * GCP now keeps reserva sumarial as a STRUCTURAL fact (`cpnu_reserva_estado`
 * plus its historial) rather than a per-response flag. Reserva has a start, a
 * last revalidation and a TTL, and leaving reserva is a procedurally
 * meaningful event: the matter becomes legible again.
 *
 * This function pulls that state for the matters that can be in reserva and
 * applies it through `apply_reserva_estado`, the ONLY writer of the privacy
 * state and of the historial. Nothing here infers reserva from a count of
 * zero: an unreachable provider is a failed read, never a reservation.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ANDROMEDA_API_BASE =
  "https://andromeda-read-api-11974381924.us-central1.run.app";

/** Candidate paths, in contract order. The first that answers 2xx wins. */
const RESERVA_PATHS = [
  "/reserva/estado?radicado=",
  "/salud/reserva?radicado=",
  "/reserva?radicado=",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface ReservaReading {
  privado: boolean | null;
  motivo: string | null;
  desde: string | null;
  ultima_verificacion: string | null;
  ttl_days: number | null;
  raw: Record<string, unknown> | null;
}

/** Parse the provider's reserva block. Absence is never read as "público". */
export function parseReserva(payload: unknown): ReservaReading {
  const empty: ReservaReading = {
    privado: null, motivo: null, desde: null,
    ultima_verificacion: null, ttl_days: null, raw: null,
  };
  if (!payload || typeof payload !== "object") return empty;
  const root = payload as Record<string, unknown>;
  const b = (root.reserva ?? root.estado ?? root.data ?? root) as Record<string, unknown>;
  if (!b || typeof b !== "object") return empty;

  const flag = b.es_privado ?? b.esPrivado ?? b.privado ?? b.en_reserva;
  const privado = typeof flag === "boolean" ? flag : null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const ttlRaw = b.ttl_days ?? b.ttlDias ?? b.ttl;

  return {
    privado,
    motivo: str(b.motivo) ?? str(b.motivo_ausencia) ?? (privado ? "PROCESO_PRIVADO" : null),
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
  const apiKey = Deno.env.get("ANDROMEDA_API_KEY") ?? "";

  let body: { work_item_id?: string } = {};
  try { body = await req.json(); } catch { /* no body: portfolio pass */ }

  let query = supabase
    .from("work_items")
    .select("id, radicado, workflow_type, provider_privacy_state")
    .is("deleted_at", null)
    .not("radicado", "is", null);
  query = body.work_item_id
    ? query.eq("id", body.work_item_id)
    : query.or("workflow_type.eq.PENAL_906,provider_privacy_state.eq.RESERVADO");

  const { data: items, error } = await query.limit(200);
  if (error) return json({ ok: false, error: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const wi of items ?? []) {
    const radicado = String(wi.radicado ?? "").replace(/\D/g, "");
    if (!radicado) continue;

    let reading: ReservaReading | null = null;
    let httpStatus: number | null = null;
    for (const path of RESERVA_PATHS) {
      try {
        const res = await fetch(`${ANDROMEDA_API_BASE}${path}${radicado}`, {
          headers: apiKey
            ? { "X-API-Key": apiKey, Accept: "application/json" }
            : { Accept: "application/json" },
        });
        httpStatus = res.status;
        if (!res.ok) continue;
        reading = parseReserva(await res.json());
        break;
      } catch (_err) {
        httpStatus = null;
      }
    }

    // An unreachable endpoint asserts NOTHING: record the failed read and
    // leave the stored state exactly as it was.
    if (!reading || reading.privado === null) {
      results.push({ work_item_id: wi.id, radicado, estado: "LECTURA_FALLIDA", http_status: httpStatus });
      continue;
    }

    const { data: applied, error: rpcErr } = await supabase.rpc("apply_reserva_estado", {
      p_work_item_id: wi.id,
      p_privado: reading.privado,
      p_motivo: reading.motivo,
      p_desde: reading.desde,
      p_ultima_verificacion: reading.ultima_verificacion,
      p_ttl_days: reading.ttl_days,
      p_procedencia: { endpoint: "reserva", raw: reading.raw },
    });

    results.push({
      work_item_id: wi.id,
      radicado,
      estado: reading.privado ? "RESERVADO" : "PUBLICO",
      cambio: (applied as { changed?: boolean } | null)?.changed ?? false,
      error: rpcErr?.message ?? null,
    });
  }

  const { data: report } = await supabase.rpc("reserva_estado_report");
  return json({
    ok: true,
    evaluados: results.length,
    cambios: results.filter((r) => r.cambio).length,
    lecturas_fallidas: results.filter((r) => r.estado === "LECTURA_FALLIDA").length,
    resultados: results,
    reporte: report ?? null,
  });
});
