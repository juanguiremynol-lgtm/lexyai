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
  channelEvidence,
  describeSilence,
  evaluateSilence,
  type SilenceManualReference,
  shouldNotify,
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
  // Dry-run preview only. The scheduled path (dry_run=0) always uses the
  // ratified 45-day threshold; this exists so the copy can be inspected on
  // matters that are not yet eligible.
  const previewDays = dryRun ? Number(url.searchParams.get("previsualizar_umbral") ?? "") : NaN;
  const umbral = Number.isFinite(previewDays) && previewDays > 0
    ? { silence_days: previewDays, min_age_days: previewDays }
    : {};

  // Bounded inspection is DRY-RUN ONLY: ?limite=N and ?work_item_id=UUID[,UUID].
  // The productive run (dry_run=0) ignores both and pages through every
  // eligible matter so later matters are never left out.
  const limitParam = url.searchParams.get("limite");
  const limit = dryRun && limitParam ? Math.min(Math.max(Number(limitParam) || 1, 1), 1000) : null;
  const onlyIds = dryRun
    ? (url.searchParams.get("work_item_id") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const resumen = url.searchParams.get("resumen") === "1";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const COLS = "id, radicado, title, workflow_type, authority_name, owner_id, created_at, deleted_at, lifecycle_state, monitoring_enabled, scrape_status, last_error_code, last_successful_sync_at, provider_detail_exposure";
  const items: any[] = [];
  if (onlyIds.length > 0) {
    // Explicit ids: fetch without lifecycle filters so exclusions are reported
    // by the shared criterion (archived/trashed/monitoring off → EXCLUDED).
    const { data, error } = await supabase.from("work_items").select(COLS).in("id", onlyIds);
    if (error) return json({ ok: false, error: error.message }, 500);
    items.push(...(data ?? []));
  } else {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const size = limit != null ? Math.min(PAGE, limit - items.length) : PAGE;
      if (size <= 0) break;
      const { data, error } = await supabase.from("work_items").select(COLS)
        .is("deleted_at", null).eq("lifecycle_state", "ACTIVE").eq("monitoring_enabled", true)
        .order("id").range(from, from + size - 1);
      if (error) return json({ ok: false, error: error.message }, 500);
      items.push(...(data ?? []));
      if (!data || data.length < size) break;
    }
  }

  const avisos: Array<Record<string, unknown>> = [];

  for (const wi of items) {
    const prefix = String(wi.radicado ?? "").slice(0, 12);
    const [actsQ, pubsQ, sourcesQ, findingsQ] = await Promise.all([
      // Judicial dates only: act_date / fecha_fijacion. Never detected_at/created_at.
      supabase.from("work_item_acts")
        .select("act_date, source, source_radicado, is_archived, is_future_dated, is_canonical, requiere_revision_manual")
        .eq("work_item_id", wi.id).not("act_date", "is", null)
        .order("act_date", { ascending: false }).limit(50),
      supabase.from("work_item_publicaciones")
        .select("fecha_fijacion, fecha_providencia, date_source, source, source_radicado, is_archived, is_future_dated, is_canonical, requiere_revision_manual")
        .eq("work_item_id", wi.id).not("fecha_fijacion", "is", null)
        .order("fecha_fijacion", { ascending: false }).limit(50),
      supabase.from("work_item_sources")
        .select("source_input_type, scrape_status, last_error_code, last_synced_at")
        .eq("work_item_id", wi.id),
      supabase.from("manual_court_findings")
        .select("id, finding_kind, scope, evidence, verified_on, verified_by")
        .eq("work_item_id", wi.id),
    ]);
    // A failed internal read is never an empty successful read.
    const readErrors = [
      actsQ.error && "work_item_acts",
      pubsQ.error && "work_item_publicaciones",
      sourcesQ.error && "work_item_sources",
      findingsQ.error && "manual_court_findings",
    ].filter(Boolean) as string[];
    const findings = findingsQ.data ?? [];

    const evaluation = evaluateSilence({
      radicado: wi.radicado,
      lifecycle_state: wi.lifecycle_state,
      monitoring_enabled: wi.monitoring_enabled,
      deleted_at: wi.deleted_at ?? null,
      created_at: wi.created_at,
      acts: actsQ.data ?? [],
      pubs: pubsQ.data ?? [],
      // Work-item level read state is the primary coverage evidence;
      // work_item_sources rows are sparse.
      sources: [
        {
          source_input_type: "WORK_ITEM",
          scrape_status: wi.scrape_status,
          last_error_code: wi.provider_detail_exposure === "PROCESO_PRIVADO" ? "PROCESO_PRIVADO" : wi.last_error_code,
          last_synced_at: wi.last_successful_sync_at,
        },
        ...(sourcesQ.data ?? []),
      ],
      manual_findings: findings.map((f) => String(f.finding_kind)),
      manual_references: manualReferences(findings),
      read_errors: readErrors,
    }, now);

    if (readErrors.length > 0) {
      avisos.push({ work_item_id: wi.id, tipo: evaluation.kind, criterio: describeSilence(evaluation), escrito: false });
      continue;
    }
    if (onlyIds.length > 0 && evaluation.kind === "EXCLUDED") {
      avisos.push({ work_item_id: wi.id, tipo: "EXCLUDED", criterio: describeSilence(evaluation), escrito: false });
      continue;
    }
    if (!shouldNotify(evaluation, umbral.silence_days)) {
      if (onlyIds.length > 0) {
        avisos.push({ work_item_id: wi.id, tipo: evaluation.kind, sin_aviso: true, criterio: describeSilence(evaluation), escrito: false });
      }
      continue;
    }

    // Despacho profile: what do we know about this court, stated as knowledge
    // or as its absence. A manual finding (IT2) is quoted as a human check and
    // is kept apart from the derived profile.
    let perfil = "Sin evidencia suficiente sobre este despacho.";
    const { data: derived } = await supabase
      .from("despacho_profiles")
      .select("publishes_estados, feeds_actuaciones, evidence_sufficient, evidence_note")
      .eq("despacho_code", prefix).maybeSingle();
    if (derived?.evidence_sufficient) {
      // JI3 — the estados pole is a statement about OUR reads, never a verdict
      // on the despacho. Render it in those words.
      const ESTADOS_ES: Record<string, string> = {
        RECIBIMOS_ESTADOS: "hemos recibido estados de este despacho",
        NO_RECIBIMOS_ESTADOS:
          "no hemos recibido estados de este despacho (observación nuestra, no una conclusión sobre el despacho)",
        INDETERMINADO: "aún no hay evidencia concluyente sobre los estados",
      };
      perfil =
        `Perfil observado por Andrómeda — estados: ${ESTADOS_ES[String(derived.publishes_estados)] ?? String(derived.publishes_estados)}; ` +
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

    const canales: SilenceChannelEvidence[] = channelEvidence(evaluation, wi.scrape_status);

    const notice = buildSilenceNotice({
      radicado: wi.radicado,
      titulo: wi.title,
      evaluation,
      canales,
      perfil_despacho: perfil,
    });

    avisos.push(resumen
      ? { work_item_id: wi.id, tipo: evaluation.kind, causa: evaluation.causa ?? null, criterio: describeSilence(evaluation), canales }
      : { work_item_id: wi.id, radicado: wi.radicado, tipo: evaluation.kind, criterio: describeSilence(evaluation), ...notice });

    if (!dryRun && wi.owner_id) {
      // Monthly cadence (Bogotá month): one notice per matter per month; same key
      // format as before so prior notices keep blocking duplicates.
      await supabase.rpc("rpc_insert_notification", {
        p_audience_scope: "USER",
        p_user_id: wi.owner_id,
        p_category: "WORK_ITEM_ALERTS",
        p_type: "SILENCIO_PROLONGADO",
        p_title: notice.title,
        p_body: notice.message,
        p_severity: "info",
        p_metadata: {
          informativo: true,
          umbral_dias: SILENCE_DAYS,
          canales,
          criterio_version: "2026-11-01",
          tipo: evaluation.kind,
          fecha_base: evaluation.fecha_base,
          fuente_base: evaluation.fuente_base,
          corte: evaluation.corte,
          dias: evaluation.dias,
          ultima_actuacion: evaluation.ultima_actuacion,
          ultimo_estado: evaluation.ultimo_estado,
          referencia_manual: evaluation.referencia_manual,
          causa: evaluation.causa ?? null,
          ultima_verificacion: evaluation.ultima_verificacion,
        },
        p_dedupe_key: `SILENCIO_PROLONGADO_${wi.id}_${evaluation.corte.slice(0, 7)}`,
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


/**
 * REFERENCIA MANUAL: a lawyer-verified last providencia recorded in
 * manual_court_findings (scope MATTER, provenance VERIFICACION_MANUAL_PORTAL)
 * with finding_kind ULTIMA_PROVIDENCIA_VERIFICADA and
 * evidence.fecha_providencia (YYYY-MM-DD). Not CPNU; never creates acts.
 * That kind requires the owner-reviewed CHECK extension before rows exist.
 */
function manualReferences(rows: Array<Record<string, unknown>>): SilenceManualReference[] {
  return rows
    .filter((r) => r.finding_kind === "ULTIMA_PROVIDENCIA_VERIFICADA" && r.scope === "MATTER")
    .map((r) => ({
      finding_id: String(r.id),
      fecha_providencia: String((r.evidence as Record<string, unknown> | null)?.fecha_providencia ?? ""),
      verified_on: String(r.verified_on ?? ""),
      verified_by: (r.verified_by as string) ?? null,
      procedencia: (r.evidence as Record<string, unknown> | null)?.procedencia === "VERIFICACION_DIRECTA_ABOGADO"
        ? "VERIFICACION_DIRECTA_ABOGADO" as const
        : "INFORME_APORTADO" as const,
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.fecha_providencia) && !!r.verified_on);
}
