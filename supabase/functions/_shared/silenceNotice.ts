/**
 * silenceNotice.ts — IT1. The response to silence is an ALERT, never a pause.
 *
 * Domain truth established by the lawyer against the Rama Judicial portals
 * (2026-08-28):
 *   - A radicado can sit for MONTHS with no actuación and no estado. Courts
 *     routinely take a long time to admit, inadmit or reject a demanda.
 *   - Some despachos do not publish estados online AT ALL.
 * Therefore silence is NORMAL. It is information for him, never a conclusion
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
  "El silencio es NORMAL y esperado. Un radicado puede pasar meses sin actuación " +
  "ni estado: los juzgados suelen demorarse en admitir, inadmitir o rechazar una " +
  "demanda, y algunos despachos no publican estados en línea. Esto NO significa que " +
  "el expediente esté cerrado, ni que no exista, ni que Andrómeda haya dejado de leerlo.";

export const NO_ES_ADVERTENCIA =
  "Este aviso informa; no es una advertencia ni una alerta de riesgo.";

export const DECISION_ES_SUYA =
  "El monitoreo sigue activo y no se detendrá por sí solo. Si usted sabe que este " +
  "despacho no publica por estos canales, puede pausar el asunto usted mismo desde " +
  "el detalle del asunto. Andrómeda nunca lo pausará por silencio.";

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

export interface SilenceNoticeInput {
  radicado: string | null;
  titulo?: string | null;
  dias_en_silencio: number;
  registrado_hace_dias: number;
  canales: SilenceChannelEvidence[];
  /** What the despacho profile says about this court, already phrased. */
  perfil_despacho: string;
}

export function buildSilenceNotice(input: SilenceNoticeInput): { title: string; message: string } {
  const canales = input.canales
    .map(
      (c) =>
        `• ${c.canal}: último dato ${c.ultimo_dato ? fecha(c.ultimo_dato) : "ninguno"}; ` +
        `última respuesta del proveedor: ${c.ultima_respuesta}` +
        (c.ultima_lectura ? ` (leído el ${fecha(c.ultima_lectura)})` : " (sin lectura concluida)"),
    )
    .join("\n");

  return {
    title: `🕰️ Sin novedades hace ${input.dias_en_silencio} días — ${input.radicado ?? "(sin radicado)"}`,
    message: [
      `El asunto ${input.radicado ?? "(sin radicado)"}${input.titulo ? ` — ${input.titulo}` : ""} ` +
        `lleva ${input.dias_en_silencio} días sin actuaciones ni estados nuevos ` +
        `(inscrito hace ${input.registrado_hace_dias} días).`,
      SILENCIO_ES_NORMAL,
      NO_ES_ADVERTENCIA,
      `Lo que sabemos por canal:\n${canales}`,
      `Sobre el despacho: ${input.perfil_despacho}`,
      DECISION_ES_SUYA,
    ].join("\n\n"),
  };
}

function fecha(iso: string): string {
  return iso.slice(0, 10);
}

export interface SilenceCandidate {
  created_at: string;
  last_signal_at: string | null;
  lifecycle_state: string | null;
  monitoring_enabled: boolean | null;
}

/** Pure eligibility. Informational only — no caller may derive an action from it. */
export function isSilenceCandidate(wi: SilenceCandidate, now = new Date()): boolean {
  if ((wi.lifecycle_state ?? "") !== "ACTIVE") return false;
  if (wi.monitoring_enabled === false) return false;
  const ageDays = days(wi.created_at, now);
  // IT1(d) — never on a newly registered matter.
  if (ageDays < MIN_AGE_DAYS) return false;
  const silentDays = wi.last_signal_at ? days(wi.last_signal_at, now) : ageDays;
  return silentDays >= SILENCE_DAYS;
}

export function days(fromIso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(fromIso).getTime()) / 86_400_000);
}
