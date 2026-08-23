/**
 * PETICION catalog — TypeScript mirror of the DB catalog (Phase 1).
 *
 * The database is the single source of truth (`workflow_stages_global`,
 * `workflow_stage_transitions`, `workflow_event_catalog`, `peticion_subtypes`).
 * This module exists so the FE has typed, testable constants and so a drift
 * test can compare the mirror against the live rows.
 *
 * Structural rule (Phase 1):
 *   PROCEDURAL STAGE = where the petition is
 *   EVENT            = what happened
 *   DEADLINE         = which term runs
 *   DEADLINE STATUS  = vigente | próximo | vencido | suspendido | supersedido
 *   LEGAL EFFECT     = deemed acceptance, negative silence, ...
 *   ATTENTION STATUS = what the firm must act on
 *   LIFECYCLE STATE  = active | finished | archived
 *
 * "Overdue", "negative silence" and "extension" are NOT stages.
 */
import type { TermRegime } from "@/lib/term-calculator";

export type TermClass = "JUDICIAL" | "ADMINISTRATIVO";

/** Maps the DB term class onto the existing FE business-day regime. */
export function termClassToRegime(termClass: TermClass): TermRegime {
  return termClass === "ADMINISTRATIVO" ? "ADMIN" : "JUDICIAL";
}

// ---------------------------------------------------------------- subtypes

export type PeticionSubtypeCode =
  | "GENERAL"
  | "DOCUMENTOS_INFORMACION"
  | "CONSULTA"
  | "ENTRE_AUTORIDADES_INFO_DOCUMENTOS"
  | "NORMA_ESPECIAL";

export interface PeticionSubtypeDef {
  code: PeticionSubtypeCode;
  label: string;
  durationValue: number | null;
  durationUnit: "BUSINESS_DAYS" | "CALENDAR_DAYS" | "MONTHS";
  termClass: TermClass;
  legalBasis: string;
  requiresUserTerm: boolean;
  defaultSilenceEffect: SilenceEffect;
  /** Legal terms are never organization-configurable. */
  allowsOrgDurationOverride: false;
}

export type SilenceEffect =
  | "NEGATIVE_GENERAL"
  | "POSITIVE_SPECIAL"
  | "NEGATIVE_SPECIAL"
  | "NONE"
  | "MANUAL_REVIEW";

export const PETICION_SUBTYPES: Record<PeticionSubtypeCode, PeticionSubtypeDef> = {
  GENERAL: {
    code: "GENERAL",
    label: "Petición en interés general o particular",
    durationValue: 15,
    durationUnit: "BUSINESS_DAYS",
    termClass: "ADMINISTRATIVO",
    legalBasis: "Ley 1755 de 2015, art. 14 inc. 1 (días hábiles: Ley 4 de 1913, art. 62)",
    requiresUserTerm: false,
    defaultSilenceEffect: "NEGATIVE_GENERAL",
    allowsOrgDurationOverride: false,
  },
  DOCUMENTOS_INFORMACION: {
    code: "DOCUMENTOS_INFORMACION",
    label: "Petición de documentos e información",
    durationValue: 10,
    durationUnit: "BUSINESS_DAYS",
    termClass: "ADMINISTRATIVO",
    legalBasis: "Ley 1755 de 2015, art. 14 num. 1",
    requiresUserTerm: false,
    defaultSilenceEffect: "POSITIVE_SPECIAL",
    allowsOrgDurationOverride: false,
  },
  CONSULTA: {
    code: "CONSULTA",
    label: "Consulta a las autoridades",
    durationValue: 30,
    durationUnit: "BUSINESS_DAYS",
    termClass: "ADMINISTRATIVO",
    legalBasis: "Ley 1755 de 2015, art. 14 num. 2",
    requiresUserTerm: false,
    defaultSilenceEffect: "NEGATIVE_GENERAL",
    allowsOrgDurationOverride: false,
  },
  ENTRE_AUTORIDADES_INFO_DOCUMENTOS: {
    code: "ENTRE_AUTORIDADES_INFO_DOCUMENTOS",
    label: "Petición entre autoridades — información o documentos",
    durationValue: 10,
    durationUnit: "BUSINESS_DAYS",
    termClass: "ADMINISTRATIVO",
    legalBasis:
      "Ley 1755 de 2015, art. 30 — 10 días para información o documentos; en los demás casos rigen los plazos del art. 14",
    requiresUserTerm: false,
    defaultSilenceEffect: "NEGATIVE_GENERAL",
    allowsOrgDurationOverride: false,
  },
  NORMA_ESPECIAL: {
    code: "NORMA_ESPECIAL",
    label: "Petición sujeta a norma legal especial",
    durationValue: null,
    durationUnit: "BUSINESS_DAYS",
    termClass: "ADMINISTRATIVO",
    legalBasis:
      'Ley 1755 de 2015, art. 14 inc. 1 — "salvo norma legal especial"; exige norma, cantidad, unidad y efecto del silencio',
    requiresUserTerm: true,
    defaultSilenceEffect: "MANUAL_REVIEW",
    allowsOrgDurationOverride: false,
  },
};

/**
 * "Entre autoridades" is a descriptive attribute, not a generic 10-day subtype.
 * Only requests for information/documents get the art. 30 term; anything else
 * must resolve to an art. 14 subtype.
 */
export function resolveInterAuthoritySubtype(
  objectIsInfoOrDocuments: boolean,
  fallback: PeticionSubtypeCode | null,
): PeticionSubtypeCode | null {
  if (objectIsInfoOrDocuments) return "ENTRE_AUTORIDADES_INFO_DOCUMENTOS";
  return fallback;
}

// ------------------------------------------------------------------ stages

export type PeticionStageCode =
  | "BORRADOR"
  | "RADICADA"
  | "PENDIENTE_RESPUESTA"
  | "AWAITING_PETITIONER_COMPLETION"
  | "TRASLADO_POR_COMPETENCIA"
  | "RESPUESTA_PARCIAL"
  | "RESPUESTA_DE_FONDO"
  | "DEVUELTA_PARA_ACLARACION"
  | "DESISTIMIENTO_DECRETADO"
  | "DESISTIMIENTO_EXPRESO"
  | "RECHAZADA";

export interface PeticionStageDef {
  code: PeticionStageCode;
  label: string;
  order: number;
  isTerminal: boolean;
  legalBasis: string;
}

export const PETICION_STAGES: PeticionStageDef[] = [
  { code: "BORRADOR", label: "Borrador", order: 10, isTerminal: false, legalBasis: "Etapa operativa previa a la radicación" },
  { code: "RADICADA", label: "Radicada", order: 20, isTerminal: false, legalBasis: "Ley 1755 de 2015, art. 14" },
  { code: "PENDIENTE_RESPUESTA", label: "Pendiente de respuesta", order: 30, isTerminal: false, legalBasis: "Ley 1755 de 2015, art. 14" },
  { code: "AWAITING_PETITIONER_COMPLETION", label: "En espera de complementación del peticionario", order: 40, isTerminal: false, legalBasis: "Ley 1755 de 2015, art. 17" },
  { code: "TRASLADO_POR_COMPETENCIA", label: "Trasladada por competencia", order: 50, isTerminal: false, legalBasis: "Ley 1755 de 2015, art. 21" },
  { code: "RESPUESTA_PARCIAL", label: "Respuesta parcial", order: 60, isTerminal: false, legalBasis: "Ley 1755 de 2015, art. 14" },
  { code: "RESPUESTA_DE_FONDO", label: "Respuesta de fondo", order: 70, isTerminal: true, legalBasis: "Ley 1755 de 2015, art. 14; doctrina constitucional" },
  { code: "DEVUELTA_PARA_ACLARACION", label: "Devuelta para aclaración", order: 80, isTerminal: false, legalBasis: "Ley 1755 de 2015, art. 19" },
  { code: "DESISTIMIENTO_DECRETADO", label: "Desistimiento decretado y archivo", order: 90, isTerminal: true, legalBasis: "Ley 1755 de 2015, art. 17" },
  { code: "DESISTIMIENTO_EXPRESO", label: "Desistimiento expreso", order: 100, isTerminal: true, legalBasis: "Ley 1755 de 2015, art. 18" },
  { code: "RECHAZADA", label: "Rechazada", order: 110, isTerminal: true, legalBasis: "Ley 1755 de 2015, art. 19" },
];

/** Codes that must NEVER be procedural stages — they live in other dimensions. */
export const FORBIDDEN_AS_STAGE = [
  "PRORROGA",
  "PRORROGA_INFORMADA",
  "VENCIDO_SIN_RESPUESTA",
  "SILENCIO_NEGATIVO",
  "ARCHIVADA",
  "VENCIDA",
  "REQUIERE_REVISION",
] as const;

// ------------------------------------------------ parallel state dimensions

export type PeticionDeadlineStatus =
  | "VIGENTE"
  | "PROXIMO"
  | "OVERDUE"
  | "SUSPENDIDO"
  | "SUPERSEDED_BY_EXTENSION"
  | "SUPERSEDED_BY_REANCHOR"
  | "CUMPLIDO";

export type PeticionLegalEffect =
  | "REQUEST_DEEMED_ACCEPTED"
  | "SILENCIO_NEGATIVO"
  | "SILENCIO_POSITIVO"
  | "NINGUNO";

export type PeticionAttentionStatus = "NONE" | "MONITORING" | "ACTION_REQUIRED" | "MANUAL_REVIEW";

export type ExtensionValidity = "VALID" | "LATE" | "EXCEEDS_CAP" | "INCOMPLETE" | "MANUAL_REVIEW";

/**
 * Art. 14 parágrafo: the authority must notify before expiry and the extended
 * term may not exceed double the original one.
 */
export function classifyExtension(params: {
  originalTermDays: number;
  extendedTermDays: number | null;
  notifiedOn: string | null;
  originalDueDate: string | null;
}): ExtensionValidity {
  const { originalTermDays, extendedTermDays, notifiedOn, originalDueDate } = params;
  if (!extendedTermDays || !notifiedOn || !originalDueDate) return "INCOMPLETE";
  if (originalTermDays <= 0) return "MANUAL_REVIEW";
  if (extendedTermDays > originalTermDays * 2) return "EXCEEDS_CAP";
  if (notifiedOn > originalDueDate) return "LATE";
  return "VALID";
}

/**
 * CPACA art. 83. Ordinary rule: 3 calendar months from presentation.
 * The "one month after it was due" rule applies ONLY when a statute grants the
 * authority a term longer than 3 months.
 */
export function resolveNegativeSilenceDate(params: {
  presentationDate: string;
  dueDate: string | null;
  specialTermMonths: number | null;
  silenceEffect: SilenceEffect;
}): { date: string | null; requiresManualReview: boolean } {
  const { presentationDate, dueDate, specialTermMonths, silenceEffect } = params;
  if (silenceEffect === "POSITIVE_SPECIAL" || silenceEffect === "NONE") {
    return { date: null, requiresManualReview: false };
  }
  if (silenceEffect === "MANUAL_REVIEW") {
    return { date: null, requiresManualReview: true };
  }
  const addMonths = (iso: string, months: number) => {
    const d = new Date(iso + "T00:00:00");
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  };
  if (specialTermMonths !== null && specialTermMonths > 3) {
    if (!dueDate) return { date: null, requiresManualReview: true };
    return { date: addMonths(dueDate, 1), requiresManualReview: false };
  }
  return { date: addMonths(presentationDate, 3), requiresManualReview: false };
}
