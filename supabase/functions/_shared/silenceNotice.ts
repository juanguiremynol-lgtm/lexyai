/**
 * silenceNotice.ts — IT1. The response to silence is an ALERT, never a pause.
 *
 * Domain truth established by the lawyer against the Rama Judicial portals
 * (2026-08-28):
 *   - A radicado can sit for MONTHS with no actuación and no estado. Courts
 *     routinely take a long time to admit, inadmit or reject a demanda.
 *   - JF3: EVERY matter must publish estados (Publicaciones Procesales for the
 *     CGP family, SAMAI Estados for CPACA). There is no exception, so a
 *     permanent estados absence points at us or at the provider, never at the
 *     court.
 * Silence on actuaciones is therefore normal; it is information for him, never a conclusion
 * for us, and never a reason for the system to stop monitoring.
 *
 * This module produces the notice only. Nothing here may pause, demonitor,
 * compute a term or write provider state. The RPC guard
 * (AUTOMATIC_PAUSE_FORBIDDEN) remains the wall.
 */

/**
 * Threshold — 45 CALENDAR days of silence on BOTH channels.
 *
 * Reasoning: 45 calendar days is roughly 30 business days. It is long enough
 * that an ordinary admisión/inadmisión cycle (weeks) does not trigger it, and
 * short enough that a matter nobody is reading does not go a whole quarter
 * unmentioned. It is a REPORTING cadence, not a verdict: no consequence is
 * attached to crossing it.
 */
export const SILENCE_DAYS = 45;

/**
 * IT1(d) — a newly registered matter is NEVER eligible. No publication yet is
 * the expected initial state and it is already described by EN_VERIFICACION.
 */
export const MIN_AGE_DAYS = SILENCE_DAYS;

export const SILENCIO_ES_NORMAL =
  "Un radicado puede pasar meses sin actuación: los juzgados suelen demorarse en " +
  "admitir, inadmitir o rechazar una demanda. En cambio, TODO proceso debe publicar " +
  "sus estados en publicacionesprocesales.ramajudicial.gov.co (familia CGP) o en " +
  "SAMAI Estados (CPACA); no hay excepción. Si tampoco llegan estados, la ausencia " +
  "apunta a la lectura o al proveedor, nunca a que el despacho no publique. Esto NO " +
  "significa que el expediente esté cerrado, ni que no exista, ni que Andrómeda haya " +
  "dejado de leerlo.";

export const NO_ES_ADVERTENCIA =
  "Este aviso informa; no es una advertencia ni una alerta de riesgo.";

export const DECISION_ES_SUYA =
  "El monitoreo sigue activo y no se detendrá por sí solo. Si usted considera que " +
  "este asunto no requiere seguimiento, puede pausarlo usted mismo desde el detalle " +
  "del asunto. Andrómeda nunca lo pausará por silencio.";

export interface SilenceChannelEvidence {
  /** Human label of the channel: "Actuaciones (CPNU)", "Estados (Publicaciones)". */
  canal: string;
  /** Date of the last row we hold for this channel, ISO, or null. */
  ultimo_dato: string | null;
  /** What the provider last returned, in the ratified vocabulary. */
  ultima_respuesta: string;
  /** When that answer was received, ISO, or null if never read. */
  ultima_lectura: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Judicial silence evaluation (2026-11-01 contrast).
//
// Silence is measured ONLY from the last valid judicial date attributed to the
// matter's own radicado: an actuación date (act_date, providencia) or an estado
// date (fecha_fijacion; fecha_providencia reported apart). Card creation,
// ingestion (detected_at/created_at), sync, access emails and unattributed
// summaries are never a base. Day counts are CALENDAR days between
// America/Bogota civil dates — never a truncated UTC timestamp difference.
// ─────────────────────────────────────────────────────────────────────────────

export const TZ = "America/Bogota";

export const ESTADO_NO_VERIFICABLE = "Estado no verificable; requiere acceso al expediente";
export const SIN_ACTUACIONES_VERIFICABLES = "Sin actuaciones judiciales publicadas verificables";

/** Lifecycle states that never produce a silence notice. */
const EXCLUDED_LIFECYCLE = new Set(["ARCHIVED", "TRASHED", "DELETED", "CLOSED", "PAUSED"]);
/** Act sources that are not judicial publications (access emails, etc.). */
const NON_JUDICIAL_ACT_SOURCES = new Set(["email", "email_import", "correo"]);
/** Publication date provenance that is a sync artefact, not a court date. */
const NON_JUDICIAL_DATE_SOURCES = new Set(["inferred_sync"]);
/** Provider/manual markers meaning we cannot see the file. */
const RESTRICTED_CODES = new Set(["PROCESO_PRIVADO", "ACCESO_RESTRINGIDO", "PRIVATE_PROCESS"]);

/** Civil date (YYYY-MM-DD) in Bogotá for an ISO timestamp or a plain date. */
export function bogotaDate(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${String(value)}`);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d);
}

/** Calendar days between two civil dates (cut - base). Timezone-free. */
export function calendarDaysBetween(baseYmd: string, cutYmd: string): number {
  const toUtc = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(cutYmd) - toUtc(baseYmd)) / 86_400_000);
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** A row is attributed to the matter when it carries no foreign radicado. */
function attributed(sourceRadicado: unknown, radicado: string | null): boolean {
  const src = digits(sourceRadicado);
  if (!src) return true;
  const own = digits(radicado);
  if (!own) return false;
  return src.slice(0, 21) === own.slice(0, 21);
}

export interface SilenceActRow {
  act_date: string | null;
  source: string | null;
  source_radicado?: string | null;
  is_archived?: boolean | null;
  is_future_dated?: boolean | null;
}
export interface SilencePubRow {
  fecha_fijacion: string | null;
  fecha_providencia: string | null;
  date_source?: string | null;
  source?: string | null;
  source_radicado?: string | null;
  is_archived?: boolean | null;
  is_future_dated?: boolean | null;
}
export interface SilenceSourceRow {
  source_input_type?: string | null;
  scrape_status?: string | null;
  last_error_code?: string | null;
  last_synced_at?: string | null;
}

export interface SilenceEvaluationInput {
  radicado: string | null;
  lifecycle_state: string | null;
  monitoring_enabled: boolean | null;
  deleted_at?: string | null;
  /** Card creation; shown with its own label, NEVER a silence base. */
  created_at: string;
  /** Intake/reparto date when known; shown with its own label only. */
  fecha_ingreso?: string | null;
  acts: SilenceActRow[];
  pubs: SilencePubRow[];
  sources: SilenceSourceRow[];
  /** Manual portal findings for this matter (finding_kind). */
  manual_findings?: string[];
}

export type SilenceKind = "EXCLUDED" | "NO_VERIFICABLE" | "SIN_ACTUACIONES" | "SILENCIO";

export interface SilenceEvaluation {
  kind: SilenceKind;
  excluded_reason?: string;
  corte: string;
  /** Most recent valid judicial date, and which one it is. */
  fecha_base: string | null;
  fuente_base: "actuacion" | "estado" | null;
  dias: number | null;
  ultima_actuacion: { fecha: string; fuente: string; dias: number } | null;
  ultimo_estado: { fecha_estado: string; fecha_providencia: string | null; fuente: string; dias: number } | null;
  fecha_ficha: string;
  fecha_ingreso: string | null;
}

export function evaluateSilence(input: SilenceEvaluationInput, now = new Date()): SilenceEvaluation {
  const corte = bogotaDate(now);
  const base: SilenceEvaluation = {
    kind: "EXCLUDED",
    corte,
    fecha_base: null,
    fuente_base: null,
    dias: null,
    ultima_actuacion: null,
    ultimo_estado: null,
    fecha_ficha: bogotaDate(input.created_at),
    fecha_ingreso: input.fecha_ingreso ? bogotaDate(input.fecha_ingreso) : null,
  };

  const state = String(input.lifecycle_state ?? "").toUpperCase();
  if (input.deleted_at) return { ...base, excluded_reason: "DELETED" };
  if (state !== "ACTIVE" || EXCLUDED_LIFECYCLE.has(state)) return { ...base, excluded_reason: state || "UNKNOWN" };
  if (input.monitoring_enabled !== true) return { ...base, excluded_reason: "MONITORING_OFF" };

  const restricted =
    input.sources.some((s) =>
      RESTRICTED_CODES.has(String(s.last_error_code ?? "").toUpperCase()) ||
      RESTRICTED_CODES.has(String(s.scrape_status ?? "").toUpperCase())
    ) ||
    (input.manual_findings ?? []).some((f) => RESTRICTED_CODES.has(String(f).toUpperCase()));

  let lastAct: SilenceEvaluation["ultima_actuacion"] = null;
  for (const a of input.acts) {
    if (!a.act_date || a.is_archived || a.is_future_dated) continue;
    if (NON_JUDICIAL_ACT_SOURCES.has(String(a.source ?? "").toLowerCase())) continue;
    if (!attributed(a.source_radicado, input.radicado)) continue;
    const f = bogotaDate(a.act_date);
    if (f > corte) continue;
    if (!lastAct || f > lastAct.fecha) {
      lastAct = { fecha: f, fuente: String(a.source ?? "desconocida"), dias: calendarDaysBetween(f, corte) };
    }
  }

  let lastPub: SilenceEvaluation["ultimo_estado"] = null;
  for (const p of input.pubs) {
    if (!p.fecha_fijacion || p.is_archived || p.is_future_dated) continue;
    if (NON_JUDICIAL_DATE_SOURCES.has(String(p.date_source ?? "").toLowerCase())) continue;
    if (!attributed(p.source_radicado, input.radicado)) continue;
    const f = bogotaDate(p.fecha_fijacion);
    if (f > corte) continue;
    if (!lastPub || f > lastPub.fecha_estado) {
      lastPub = {
        fecha_estado: f,
        fecha_providencia: p.fecha_providencia ? bogotaDate(p.fecha_providencia) : null,
        fuente: String(p.source ?? "desconocida"),
        dias: calendarDaysBetween(f, corte),
      };
    }
  }

  const out = { ...base, ultima_actuacion: lastAct, ultimo_estado: lastPub };
  if (restricted) return { ...out, kind: "NO_VERIFICABLE" };

  const coverage = input.sources.some((s) =>
    !!s.last_synced_at && !["FAILED", "ERROR", "IN_PROGRESS", "NOT_ATTEMPTED", "PARTIAL_SUCCESS"].includes(String(s.scrape_status ?? "").toUpperCase())
  );
  if (!lastAct && !lastPub) {
    return { ...out, kind: coverage ? "SIN_ACTUACIONES" : "NO_VERIFICABLE" };
  }
  if (!coverage) return { ...out, kind: "NO_VERIFICABLE" };

  const useEstado = !!lastPub && (!lastAct || lastPub.fecha_estado >= lastAct.fecha);
  const fecha_base = useEstado ? lastPub!.fecha_estado : lastAct!.fecha;
  return {
    ...out,
    kind: "SILENCIO",
    fecha_base,
    fuente_base: useEstado ? "estado" : "actuacion",
    dias: calendarDaysBetween(fecha_base, corte),
  };
}

/** Whether the sweep should emit a notice (informational only). */
export function shouldNotify(ev: SilenceEvaluation, silenceDays = SILENCE_DAYS): boolean {
  if (ev.kind === "EXCLUDED") return false;
  if (ev.kind === "SILENCIO") return (ev.dias ?? 0) >= silenceDays;
  // No-verifiable / no-publications: never on a newly registered card.
  return calendarDaysBetween(ev.fecha_ficha, ev.corte) >= MIN_AGE_DAYS;
}

/** One human line with base, source and cut — shared by UI and backend. */
export function describeSilence(ev: SilenceEvaluation): string {
  const ficha = `ficha creada el ${ev.fecha_ficha} (no es una actuación)`;
  const ingreso = ev.fecha_ingreso ? `; fecha de ingreso/reparto ${ev.fecha_ingreso} (no es una actuación)` : "";
  switch (ev.kind) {
    case "EXCLUDED":
      return `Sin aviso: asunto excluido (${ev.excluded_reason}).`;
    case "NO_VERIFICABLE":
      return `${ESTADO_NO_VERIFICABLE}. No se afirma inactividad. Corte ${ev.corte}; ${ficha}${ingreso}.`;
    case "SIN_ACTUACIONES":
      return `${SIN_ACTUACIONES_VERIFICABLES}. Corte ${ev.corte}; ${ficha}${ingreso}.`;
    case "SILENCIO": {
      const parts: string[] = [];
      if (ev.ultima_actuacion) {
        parts.push(`última actuación ${ev.ultima_actuacion.fecha} (${ev.ultima_actuacion.fuente}): ${ev.ultima_actuacion.dias} días`);
      }
      if (ev.ultimo_estado) {
        const prov = ev.ultimo_estado.fecha_providencia ? `, providencia ${ev.ultimo_estado.fecha_providencia}` : "";
        parts.push(`último estado ${ev.ultimo_estado.fecha_estado}${prov} (${ev.ultimo_estado.fuente}): ${ev.ultimo_estado.dias} días`);
      }
      return `Fecha base ${ev.fecha_base} (${ev.fuente_base}); corte ${ev.corte} (America/Bogota, días calendario). ${parts.join("; ")}.`;
    }
  }
}

export interface SilenceNoticeInput {
  radicado: string | null;
  titulo?: string | null;
  evaluation: SilenceEvaluation;
  canales: SilenceChannelEvidence[];
  /** What the despacho profile says about this court, already phrased. */
  perfil_despacho: string;
}

export function buildSilenceNotice(input: SilenceNoticeInput): { title: string; message: string } {
  const ev = input.evaluation;
  const rad = input.radicado ?? "(sin radicado)";
  const canales = input.canales
    .map(
      (c) =>
        `• ${c.canal}: último dato ${c.ultimo_dato ?? "ninguno"}; ` +
        `última respuesta del proveedor: ${c.ultima_respuesta}` +
        (c.ultima_lectura ? ` (leído el ${bogotaDate(c.ultima_lectura)})` : " (sin lectura concluida)"),
    )
    .join("\n");

  let title: string;
  let lead: string;
  if (ev.kind === "SILENCIO") {
    title = `🕰️ Sin novedades hace ${ev.dias} días — ${rad}`;
    lead = `El asunto ${rad}${input.titulo ? ` — ${input.titulo}` : ""} lleva ${ev.dias} días calendario ` +
      `sin actuaciones ni estados judiciales nuevos.`;
  } else if (ev.kind === "NO_VERIFICABLE") {
    title = `${ESTADO_NO_VERIFICABLE} — ${rad}`;
    lead = `El asunto ${rad}${input.titulo ? ` — ${input.titulo}` : ""}: ${ESTADO_NO_VERIFICABLE}.`;
  } else {
    title = `${SIN_ACTUACIONES_VERIFICABLES} — ${rad}`;
    lead = `El asunto ${rad}${input.titulo ? ` — ${input.titulo}` : ""}: ${SIN_ACTUACIONES_VERIFICABLES}.`;
  }

  return {
    title,
    message: [
      lead,
      describeSilence(ev),
      SILENCIO_ES_NORMAL,
      NO_ES_ADVERTENCIA,
      `Lo que sabemos por canal:\n${canales}`,
      `Sobre el despacho: ${input.perfil_despacho}`,
      DECISION_ES_SUYA,
    ].join("\n\n"),
  };
}

/** @deprecated kept for existing callers; use evaluateSilence. */
export interface SilenceCandidate {
  created_at: string;
  last_signal_at: string | null;
  lifecycle_state: string | null;
  monitoring_enabled: boolean | null;
}

/** @deprecated Legacy eligibility; now uses Bogotá calendar days. */
export function isSilenceCandidate(
  wi: SilenceCandidate,
  now = new Date(),
  umbral: { silence_days?: number; min_age_days?: number } = {},
): boolean {
  const silenceDays = umbral.silence_days ?? SILENCE_DAYS;
  const minAgeDays = umbral.min_age_days ?? MIN_AGE_DAYS;
  if ((wi.lifecycle_state ?? "") !== "ACTIVE") return false;
  if (wi.monitoring_enabled !== true) return false;
  if (days(wi.created_at, now) < minAgeDays) return false;
  if (!wi.last_signal_at) return false; // never measure silence from the card date
  return days(wi.last_signal_at, now) >= silenceDays;
}

/** Calendar days in Bogotá between a timestamp/date and `now`. */
export function days(fromIso: string, now: Date): number {
  return calendarDaysBetween(bogotaDate(fromIso), bogotaDate(now));
}
