/**
 * pauseNotices.ts — Spanish copy for automatic monitoring pauses (IQ5).
 *
 * Two lines carry the whole lesson of the ghost defect and MUST survive editing:
 *   - NO_SIGNIFICA
 *   - ESCALATION_MEANING
 *
 * Invariant (IQ1b): no code path may pause a matter for emptiness under any
 * label. These strings exist for pauses that come from a provider assertion or
 * from the lawyer, and for telling him — loudly — when the system changed
 * state on its own.
 */

/** The line that must never be edited away. */
export const NO_SIGNIFICA =
  "Lo que esto NO significa: que el expediente esté cerrado ni que no exista. " +
  "El proveedor no lo afirmó; el sistema lo dedujo de la ausencia de filas.";

/** The line that must never be edited away. */
export const ESCALATION_MEANING =
  "el sistema está revirtiendo su decisión de forma repetida y eso indica un " +
  "defecto de nuestro lado o una limitación real del proveedor, no una conclusión " +
  "sobre el expediente.";

/** IQ3(b): the initial state, stated so it never reads as a problem. */
export const RECIEN_INSCRITO =
  "Recién inscrito — todavía no hay actuaciones ni estados publicados. " +
  "Esto es lo normal en un proceso nuevo.";

/** IQ3(a): the three states, never collapsed. */
export const ESTADO_LECTURA_COPY: Record<string, string> = {
  EN_VERIFICACION:
    "Nunca leído: todavía no hay una consulta concluida para este asunto. No hay conclusión sobre el expediente.",
  SIN_FILAS:
    "Leído y vacío: el proveedor respondió y no reporta filas. Es un estado normal en procesos nuevos y permanente en despachos que no alimentan el expediente digital.",
  SILENCIO_CONOCIDO:
    "Silencio conocido: este despacho no publica por este canal. La ausencia está explicada.",
  PENDING_UPSTREAM:
    "Consulta sin resolver: el proveedor aceptó la solicitud y nunca la completó. No afirma nada sobre el expediente.",
};

export interface PauseNoticeInput {
  radicado: string | null;
  title?: string | null;
  reason: string;
  evidence: string;
  actor: "SYSTEM" | "AI" | "USER";
}

/** IQ5(a) — alert raised when an automatic rule stops monitoring a matter. */
export function buildAutoPauseAlert(input: PauseNoticeInput): { title: string; message: string } {
  return {
    title: "⛔ El sistema DEJÓ DE MONITOREAR un asunto",
    message: [
      `Andrómeda detuvo automáticamente el monitoreo de ${input.radicado ?? "(sin radicado)"}` +
        (input.title ? ` — ${input.title}` : "") + ".",
      `Motivo registrado: ${input.reason}.`,
      `Evidencia que lo produjo: ${input.evidence}.`,
      NO_SIGNIFICA,
      "Mientras el monitoreo esté detenido, este asunto NO se consulta con ningún proveedor y no aparecerá en el resumen diario. Reactívelo cuando lo considere.",
    ].join("\n\n"),
  };
}

/** IQ5(b) — digest section, alongside the suspended-matters one. */
export const DIGEST_AUTO_PAUSE_SECTION = {
  heading: "Asuntos que el sistema dejó de monitorear",
  intro:
    "Estos asuntos fueron pausados por una regla automática, no por usted. Mientras estén así, no se consultan con ningún proveedor.",
  footer: NO_SIGNIFICA,
};

/** IQ5(c) — escalation when a matter the lawyer reactivated is paused again. */
export function buildRePauseEscalation(input: {
  radicado: string | null;
  reason: string;
  reactivations: number;
}): { title: string; message: string } {
  return {
    title: "🔁 Un asunto que usted reactivó volvió a ser pausado",
    message: [
      `${input.radicado ?? "(sin radicado)"} fue pausado nuevamente por la misma regla (${input.reason}) ` +
        `después de ${input.reactivations} reactivación(es) suyas.`,
      `Esto no se repetirá en silencio: ${ESCALATION_MEANING}`,
      "La regla automática queda congelada para este asunto: ningún proceso automático volverá a cambiarle el estado sin avisarle. La decisión es suya.",
    ].join("\n\n"),
  };
}

/**
 * IQ5(b) escalation freeze scope: applies to ANY future automatic pause, not
 * only the ghost one. A matter with a prior user reactivation may not be
 * re-paused automatically without raising buildRePauseEscalation().
 */
export function automaticPauseIsFrozen(userReactivations: number): boolean {
  return userReactivations > 0;
}
