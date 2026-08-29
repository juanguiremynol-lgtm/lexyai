/**
 * silence-notice-sweep — IT1.
 *
 * Surfaces monitored matters that have been silent for a long time TO THE
 * LAWYER. It reads; it never writes state.
 *
 * HARD LIMITS (IT1 / stop conditions S1, S4, S6):
 *   - It never calls set_work_item_lifecycle, never touches monitoring_enabled,
 *     never writes provider fields and never computes a term.
 *   - It is not a control. Crossing the threshold has no consequence other
 *     than a notification the lawyer may ignore.
 *
 * `?dry_run=1` (default) reports the candidates and the exact copy without
 * inserting any notification.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildSilenceNotice,
  days,
  isSilenceCandidate,
  MIN_AGE_DAYS,
  SILENCE_DAYS,
  type SilenceChannelEvidence,
} from "../_shared/silenceNotice.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESPUESTA_ES: Record<string, string> = {
  RUN_SUCCESS_WITH_DATA: "leído con datos",
  RUN_SUCCESS_EMPTY: "leído y vacío (el proveedor respondió y no reporta filas)",
  RUN_SUCCESS_NOT_FOUND: "el proveedor no encontró el radicado",
  RUN_FAILED: "la consulta falló",
  SOURCE_STALE: "la fuente respondió con datos viejos",
  PENDING_UPSTREAM: "consulta aceptada y nunca completada por el proveedor",
  SCRAPING_INITIATED: "consulta en curso",
  PROCESO_PRIVADO: "expediente con reserva (proceso privado)",
};

/** IT2 — human verdicts from the portal, phrased so they cannot be read as a provider assertion. */
const HALLAZGO_ES: Record<string, string> = {
  CORTE_VERIFICADA_SIN_PUBLICACION: "el juzgado fue consultado y no existe publicación",
  DESPACHO_NO_PUBLICA_ESTADOS: "este despacho no publica estados en línea",
  PROCESO_PRIVADO: "el expediente está marcado como PRIVADO en el portal",
  RADICADO_EXISTE_SIN_ACTUACIONES: "el radicado existe y el juzgado no ha proferido actuación alguna",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") !== "0";
  const now = new Date();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: items, error } = await supabase
    .from("work_items")
    .select("id, radicado, title, workflow_type, despacho, owner_id, created_at, lifecycle_state, monitoring_enabled")
    .is("deleted_at", null)
    .eq("lifecycle_state", "ACTIVE")
    .eq("monitoring_enabled", true);
  if (error) return json({ ok: false, error: error.message }, 500);

  const avisos: Array<Record<string, unknown>> = [];

  for (const wi of items ?? []) {
    const [{ data: acts }, { data: pubs }, { data: sources }] = await Promise.all([
      supabase.from("work_item_acts").select("detected_at").eq("work_item_id", wi.id)
        .order("detected_at", { ascending: false }).limit(1),
      supabase.from("work_item_publicaciones").select("detected_at").eq("work_item_id", wi.id)
        .order("detected_at", { ascending: false }).limit(1),
      supabase.from("work_item_sources")
        .select("source_input_type, scrape_status, last_error_code, last_synced_at")
        .eq("work_item_id", wi.id),
    ]);

    const lastAct = acts?.[0]?.detected_at ?? null;
    const lastPub = pubs?.[0]?.detected_at ?? null;
    const lastSignal = [lastAct, lastPub].filter(Boolean).sort().pop() ?? null;

    if (!isSilenceCandidate(
      {
        created_at: wi.created_at,
        last_signal_at: lastSignal,
        lifecycle_state: wi.lifecycle_state,
        monitoring_enabled: wi.monitoring_enabled,
      },
      now,
    )) continue;

    // Despacho profile: what do we know about this court, stated as knowledge
    // or as its absence. A manual finding (IT2) is quoted as a human check and
    // is kept apart from the derived profile.
    let perfil = "Sin evidencia suficiente sobre este despacho.";
    const prefix = String(wi.radicado ?? "").slice(0, 12);
    const { data: derived } = await supabase
      .from("despacho_profiles")
      .select("publishes_estados, feeds_actuaciones, evidence_sufficient, evidence_note")
      .eq("despacho_code", prefix).maybeSingle();
    if (derived?.evidence_sufficient) {
      perfil =
        `Perfil observado por Andrómeda — estados: ${derived.publishes_estados}; ` +
        `actuaciones: ${derived.feeds_actuaciones}.`;
    }
    const { data: manual } = await supabase
      .from("manual_court_findings")
      .select("finding_kind, scope, note, verified_on")
      .or(`work_item_id.eq.${wi.id},despacho_prefix.eq.${prefix}`)
      .order("verified_on", { ascending: false }).limit(1);
    if (manual?.[0]) {
      const m = manual[0];
      perfil +=
        ` Verificación manual en el portal (${m.verified_on}) — ` +
        `${HALLAZGO_ES[String(m.finding_kind)] ?? String(m.finding_kind)}: ${m.note} ` +
        `(constatación del abogado, no una afirmación del proveedor).`;
    }

    const canales: SilenceChannelEvidence[] = [
      channel("Actuaciones", lastAct, sources ?? [], ["RADICADO", "CPNU", "cpnu"]),
      channel("Estados", lastPub, sources ?? [], ["PUBLICACIONES", "publicaciones", "PP"]),
    ];

    const notice = buildSilenceNotice({
      radicado: wi.radicado,
      titulo: wi.title,
      dias_en_silencio: lastSignal ? days(lastSignal, now) : days(wi.created_at, now),
      registrado_hace_dias: days(wi.created_at, now),
      canales,
      perfil_despacho: perfil,
    });

    avisos.push({ work_item_id: wi.id, radicado: wi.radicado, ...notice });

    if (!dryRun && wi.owner_id) {
      // Monthly cadence: one notice per matter per calendar month.
      await supabase.rpc("rpc_insert_notification", {
        p_audience_scope: "USER",
        p_user_id: wi.owner_id,
        p_category: "WORK_ITEM_ALERTS",
        p_type: "SILENCIO_PROLONGADO",
        p_title: notice.title,
        p_body: notice.message,
        p_severity: "info",
        p_metadata: { informativo: true, umbral_dias: SILENCE_DAYS, canales },
        p_dedupe_key: `SILENCIO_PROLONGADO_${wi.id}_${now.toISOString().slice(0, 7)}`,
        p_deep_link: `/app/work-items/${wi.id}`,
        p_work_item_id: wi.id,
      });
    }
  }

  return json({
    ok: true,
    dry_run: dryRun,
    umbral_dias: SILENCE_DAYS,
    edad_minima_dias: MIN_AGE_DAYS,
    evaluados: items?.length ?? 0,
    avisos: avisos.length,
    detalle: avisos,
  });
});

function channel(
  label: string,
  lastData: string | null,
  sources: Array<Record<string, unknown>>,
  keys: string[],
): SilenceChannelEvidence {
  const row = sources.find((s) =>
    keys.some((k) => String(s.source_input_type ?? "").toUpperCase().includes(k.toUpperCase()))
  );
  const code = String(row?.last_error_code ?? row?.scrape_status ?? "").toUpperCase();
  return {
    canal: label,
    ultimo_dato: lastData,
    ultima_respuesta: RESPUESTA_ES[code] ?? (code ? code.toLowerCase() : "sin lectura registrada"),
    ultima_lectura: (row?.last_synced_at as string) ?? null,
  };
}
