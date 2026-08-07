/**
 * phase-palette.ts — ITER42.
 *
 * Every board must read as the same object. The bespoke CGP pipeline paints its
 * columns with a progression of hues; the generic phase board used to paint all
 * of its columns with a single workflow colour, which made EJECUTIVO (and any
 * other generic board) look like a different product.
 *
 * This module is the single presentational source for column colour, so a board
 * cannot drift again: colour is a function of the canonical phase, not of the
 * workflow that happens to own it.
 */

/** Canonical phase key → hue, aligned with CGP_STAGES so boards match. */
const PHASE_COLOR: Record<string, string> = {
  PREPARACION: "slate",
  PRECONTENCIOSO: "slate",
  INDAGACION: "slate",
  RADICACION: "amber",
  IMPUTACION: "amber",
  SUBSANACION: "rose",
  ADMISION: "emerald",
  MANDAMIENTO_PAGO: "emerald",
  MEDIDA_ASEGURAMIENTO: "teal",
  CUADERNO: "teal",
  NOTIFICACION: "sky",
  NOTIFICACION_MANDAMIENTO: "sky",
  ESCRITO_ACUSACION: "sky",
  CONTESTACION: "cyan",
  EXCEPCIONES_MERITO: "cyan",
  AUDIENCIA_ACUSACION: "cyan",
  SANEAMIENTO: "blue",
  TRASLADO_EXCEPCIONES: "blue",
  PREPARATORIA: "blue",
  AUDIENCIAS: "indigo",
  AUDIENCIA_INICIAL: "indigo",
  JUICIO_ORAL: "indigo",
  SEGUIR_ADELANTE: "violet",
  INTERVENCION: "violet",
  SENTENCIA: "purple",
  LIQUIDACION_CREDITO: "purple",
  RECURSOS: "fuchsia",
  RECURSO: "fuchsia",
  AVALUO_REMATE: "pink",
  CUMPLIMIENTO: "pink",
  EJECUCION: "pink",
};

/** Ordered fallback so an unlisted phase still progresses, never repeats flat. */
const FALLBACK_SEQUENCE = [
  "slate", "amber", "emerald", "teal", "sky", "cyan",
  "blue", "indigo", "violet", "purple", "fuchsia", "pink",
];

/** Terminal / parallel outcome branches read as neutral on every board. */
const BRANCH_COLOR = "stone";

export function phaseColor(
  key: string,
  index: number,
  options?: { branch?: boolean },
): string {
  if (options?.branch) return BRANCH_COLOR;
  return PHASE_COLOR[key] ?? FALLBACK_SEQUENCE[index % FALLBACK_SEQUENCE.length];
}
