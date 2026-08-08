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
 *  · SHAPE (iter46, probed live). `/reserva/estado` does NOT answer a per-item
 *    lookup: probing it with one radicado came back with a DIFFERENT one. It
 *    returns the REGISTRY of currently-private matters,
 *    `{success, total, radicados:[{radicado, en_reserva, desde, ...}]}`.
 *    So we read it ONCE and treat it as a set: membership means PROCESO_PRIVADO,
 *    and absence from a registry that was read successfully is positive
 *    evidence of exposure. Querying it per item would have made every matter
 *    look private.
 *
 * An unreachable endpoint asserts nothing: a failed read never becomes a
 * statement about the matter.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { upstreamBaseUrl, upstreamHeaders } from "../_shared/upstreamEndpoints.ts";
import { evaluateBulkFlip } from "../_shared/bulkFlipGuard.ts";

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

export interface PrivateRegistry {
  /** Keyed by digits-only radicado. Only matters the provider marks private. */
  entries: Map<string, ExposicionReading>;
  /** False when the read failed; then the registry asserts nothing at all. */
  conclusive: boolean;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Parse the registry of private matters. A payload we cannot understand is
 * NON-CONCLUSIVE, never an empty registry: an empty registry would silently
 * declare the whole portfolio exposed.
 */
export function parsePrivateRegistry(payload: unknown): PrivateRegistry {
  const empty: PrivateRegistry = { entries: new Map(), conclusive: false };
  if (!payload || typeof payload !== "object") return empty;
  const root = payload as Record<string, unknown>;
  const list = root.radicados ?? root.data ?? root.items;
  if (!Array.isArray(list)) return empty;

  const entries = new Map<string, ExposicionReading>();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const key = String(b.radicado ?? b.numero_radicacion ?? "").replace(/\D/g, "");
    if (!key) continue;

    const flag = b.en_reserva ?? b.es_privado ?? b.privado;
    // The registry only lists private matters; an absent flag still means listed.
    if (flag === false) continue;

    const ttlRaw = b.ttl_days ?? b.ttlDias ?? b.ttl;
    entries.set(key, {
      expuesto: false,
      motivo: str(b.motivo) ?? "PROCESO_PRIVADO",
      desde: str(b.desde) ?? str(b.inicio),
      ultima_verificacion: str(b.ultima_verificacion) ?? str(b.ultimaVerificacion),
      ttl_days: typeof ttlRaw === "number" && Number.isFinite(ttlRaw) ? ttlRaw : null,
      raw: b,
    });
  }
  return { entries, conclusive: true };
}

/** Reading for one matter, given a registry that was read successfully. */
export function readingFor(registry: PrivateRegistry, radicado: string): ExposicionReading {
  const key = String(radicado ?? "").replace(/\D/g, "");
  const hit = registry.entries.get(key);
  if (hit) return hit;
  return {
    expuesto: registry.conclusive ? true : null,
    motivo: null, desde: null, ultima_verificacion: null, ttl_days: null, raw: null,
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

  const base = upstreamBaseUrl("cpnu_jobs");
  const headers = upstreamHeaders("cpnu_jobs");

  // ONE read of the registry, not one per matter.
  let registry: PrivateRegistry = { entries: new Map(), conclusive: false };
  let httpStatus: number | null = null;
  try {
    const res = await fetch(`${base}/reserva/estado`, { headers });
    httpStatus = res.status;
    if (res.ok) registry = parsePrivateRegistry(await res.json());
  } catch {
    httpStatus = null;
  }

  if (!registry.conclusive) {
    // A failed read asserts nothing. Touching no matter is the correct outcome.
    return json({
      ok: false,
      host: base,
      http_status: httpStatus,
      error: "registro_no_concluyente",
      nota: "No se pudo leer el registro de procesos privados; no se modificó ningún expediente.",
    }, 502);
  }

  // ITER45 — exposure is not a penal concept: any matter can have its detail
  // withheld, so the portfolio pass is not restricted by workflow.
  let query = supabase
    .from("work_items")
    .select("id, radicado, workflow_type, provider_detail_exposure")
    .is("deleted_at", null)
    .not("radicado", "is", null);
  if (body.work_item_id) query = query.eq("id", body.work_item_id);

  const { data: items, error } = await query.limit(1000);
  if (error) return json({ ok: false, error: error.message }, 500);

  // ITER47 — bulk-flip guard. Before writing anything, ask what this ONE read
  // would do to the portfolio as a whole. The registry misreading we caught in
  // iteration 46 would have flipped every matter to PROCESO_PRIVADO in a single
  // pass; a guard that only looks at rows one at a time cannot see that.
  const candidates = (items ?? []).filter((wi) => {
    const rad = String(wi.radicado ?? "").replace(/\D/g, "");
    const r = readingFor(registry, rad);
    return r.expuesto === false && wi.provider_detail_exposure !== "PROCESO_PRIVADO";
  });

  const verdict = evaluateBulkFlip({
    endpointKey: "cpnu.detalle_estado",
    field: "provider_detail_exposure",
    targetState: "PROCESO_PRIVADO",
    affectedRows: candidates.length,
    totalRows: (items ?? []).length,
  });

  if (!verdict.allowed) {
    await supabase.from("provider_bulk_flip_blocks").insert({
      endpoint_key: "cpnu.detalle_estado",
      field: "provider_detail_exposure",
      target_state: "PROCESO_PRIVADO",
      affected_rows: candidates.length,
      total_rows: (items ?? []).length,
      fraction: verdict.fraction,
      threshold: verdict.threshold,
      sample: { radicados: candidates.slice(0, 20).map((c) => c.radicado) },
    });
    await supabase.from("admin_notifications").insert({
      title: "Cambio masivo de estado bloqueado (PROCESO_PRIVADO)",
      body: verdict.reason,
      severity: "CRITICAL",
      category: "OPS_INCIDENTS",
    });
    return json({
      ok: false,
      host: base,
      error: "cambio_masivo_bloqueado",
      motivo: verdict.reason,
      candidatos: candidates.length,
      evaluados: (items ?? []).length,
    }, 409);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const wi of items ?? []) {
    const radicado = String(wi.radicado ?? "").replace(/\D/g, "");
    if (!radicado) continue;
    const reading = readingFor(registry, radicado);
    if (reading.expuesto === null) continue;

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
    registro_privados: registry.entries.size,
    guardia_cambio_masivo: verdict.reason,
    evaluados: results.length,
    privados: results.filter((r) => r.estado === "PROCESO_PRIVADO").length,
    cambios: results.filter((r) => r.cambio).length,
    resultados: results.filter((r) => r.cambio || r.estado === "PROCESO_PRIVADO"),
  });
});
