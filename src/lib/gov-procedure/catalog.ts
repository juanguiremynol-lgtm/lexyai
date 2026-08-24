/**
 * GOV_PROCEDURE catalog — TypeScript mirror of the DB catalog (Phase 2).
 *
 * GOV_PROCEDURE models the GENERAL and CONFIGURABLE administrative sanctioning
 * procedure of CPACA arts. 47–52 (Ley 1437 de 2011), which applies wherever no
 * special regime displaces it (arts. 34 and 47 inc. 1). A traffic ticket is one
 * profile among many — never the model.
 *
 * The database is the single source of truth
 * (`workflow_stages_global`, `workflow_stage_transitions`,
 *  `workflow_event_catalog`, `gov_procedure_regimes`,
 *  `gov_procedure_regime_terms`). This mirror exists so the FE has typed,
 * testable constants and so drift can be asserted.
 *
 * Structural rule (unchanged from Phase 1):
 *   STAGE = where the expediente is   ·  EVENT = what happened
 *   DEADLINE = which term runs        ·  DEADLINE STATUS = vigente/vencido/...
 *   LEGAL EFFECT = caducidad, fallo a favor por vencimiento, ...
 *   ATTENTION STATUS = what the firm must act on
 * Overdue, caducidad and "recurso ganado por silencio" are legal effects that
 * a lawyer confirms; only the confirmed outcome is a terminal stage.
 */
import type { TermClass } from "@/lib/peticion/catalog";

export type { TermClass };

// ------------------------------------------------------------------ stages

export type GovStageCode =
  | "INDAGACION_PRELIMINAR"
  | "MERITOS_COMUNICADOS"
  | "CARGOS_FORMULADOS"
  | "CARGOS_NOTIFICADOS"
  | "TERMINO_DESCARGOS"
  | "DESCARGOS_PRESENTADOS"
  | "PRUEBAS_DECRETADAS"
  | "PERIODO_PROBATORIO"
  | "TRASLADO_ALEGATOS"
  | "ALEGATOS_PRESENTADOS"
  | "PENDIENTE_DECISION"
  | "SANCION_IMPUESTA"
  | "EXONERACION_ARCHIVO"
  | "DECISION_NOTIFICADA"
  | "RECURSO_INTERPUESTO"
  | "RECURSO_RESUELTO"
  | "SILENCIO_POSITIVO_RECURSO"
  | "ACTO_EN_FIRME"
  | "CADUCIDAD_FACULTAD_SANCIONATORIA"
  | "SUSPENDIDO";

export interface GovStageDef {
  code: GovStageCode;
  label: string;
  order: number;
  isTerminal: boolean;
  legalBasis: string;
}

export const GOV_STAGES: GovStageDef[] = [
  { code: "INDAGACION_PRELIMINAR", label: "Averiguación preliminar", order: 10, isTerminal: false, legalBasis: "CPACA art. 47 inc. 2 (facultativa)" },
  { code: "MERITOS_COMUNICADOS", label: "Mérito comunicado al interesado", order: 20, isTerminal: false, legalBasis: "CPACA art. 47" },
  { code: "CARGOS_FORMULADOS", label: "Cargos formulados", order: 30, isTerminal: false, legalBasis: "CPACA art. 47" },
  { code: "CARGOS_NOTIFICADOS", label: "Cargos notificados", order: 40, isTerminal: false, legalBasis: "CPACA art. 47" },
  { code: "TERMINO_DESCARGOS", label: "En término de descargos", order: 50, isTerminal: false, legalBasis: "CPACA art. 47" },
  { code: "DESCARGOS_PRESENTADOS", label: "Descargos presentados", order: 60, isTerminal: false, legalBasis: "CPACA art. 47" },
  { code: "PRUEBAS_DECRETADAS", label: "Pruebas decretadas", order: 70, isTerminal: false, legalBasis: "CPACA art. 48" },
  { code: "PERIODO_PROBATORIO", label: "Período probatorio", order: 80, isTerminal: false, legalBasis: "CPACA art. 48" },
  { code: "TRASLADO_ALEGATOS", label: "Traslado para alegatos", order: 90, isTerminal: false, legalBasis: "CPACA art. 48 inc. 2" },
  { code: "ALEGATOS_PRESENTADOS", label: "Alegatos presentados", order: 100, isTerminal: false, legalBasis: "CPACA art. 48 inc. 2" },
  { code: "PENDIENTE_DECISION", label: "Pendiente de decisión de fondo", order: 110, isTerminal: false, legalBasis: "CPACA art. 49" },
  { code: "SANCION_IMPUESTA", label: "Sanción impuesta", order: 120, isTerminal: false, legalBasis: "CPACA art. 49" },
  { code: "EXONERACION_ARCHIVO", label: "Exoneración y archivo", order: 130, isTerminal: true, legalBasis: "CPACA art. 49" },
  { code: "DECISION_NOTIFICADA", label: "Decisión notificada", order: 140, isTerminal: false, legalBasis: "CPACA arts. 56, 67, 69" },
  { code: "RECURSO_INTERPUESTO", label: "Recurso interpuesto", order: 150, isTerminal: false, legalBasis: "CPACA arts. 74, 76" },
  { code: "RECURSO_RESUELTO", label: "Recurso resuelto", order: 160, isTerminal: false, legalBasis: "CPACA art. 74" },
  { code: "SILENCIO_POSITIVO_RECURSO", label: "Recurso fallado a favor por vencimiento", order: 170, isTerminal: true, legalBasis: "CPACA art. 52 inc. 2" },
  { code: "ACTO_EN_FIRME", label: "Acto administrativo en firme", order: 180, isTerminal: true, legalBasis: "CPACA art. 87" },
  { code: "CADUCIDAD_FACULTAD_SANCIONATORIA", label: "Caducidad de la facultad sancionatoria", order: 190, isTerminal: true, legalBasis: "CPACA art. 52" },
  { code: "SUSPENDIDO", label: "Suspendido", order: 200, isTerminal: false, legalBasis: "Suspensión del trámite" },
];

export const GOV_STAGE_CODES: readonly GovStageCode[] = GOV_STAGES.map((s) => s.code);

export function isGovStageCode(v: unknown): v is GovStageCode {
  return typeof v === "string" && (GOV_STAGE_CODES as readonly string[]).includes(v);
}

/** Alegatos exist only when a probatory period was actually opened (art. 48 inc. 2). */
export const STAGES_CONDITIONAL_ON_PROBATORIO: readonly GovStageCode[] = [
  "TRASLADO_ALEGATOS",
  "ALEGATOS_PRESENTADOS",
];

// ------------------------------------------------------------------ regimes

export type GovRegimeCode = "CPACA_GENERAL" | "SANCIONATORIO_FISCAL" | "AMBIENTAL" | "TRANSITO";

export interface GovRegimeDef {
  code: GovRegimeCode;
  label: string;
  legalBasis: string;
  /** Verified article by article. Unverified regimes carry no computable terms. */
  verified: boolean;
  requiresManualReview: boolean;
  notes: string;
}

export const GOV_REGIMES: Record<GovRegimeCode, GovRegimeDef> = {
  CPACA_GENERAL: {
    code: "CPACA_GENERAL",
    label: "Procedimiento administrativo sancionatorio general",
    legalBasis: "Ley 1437 de 2011, arts. 47–52",
    verified: true,
    requiresManualReview: false,
    notes: "Régimen supletorio por defecto (arts. 34 y 47 inc. 1).",
  },
  SANCIONATORIO_FISCAL: {
    code: "SANCIONATORIO_FISCAL",
    label: "Sancionatorio fiscal",
    legalBasis: "Ley 2080 de 2021",
    verified: false,
    requiresManualReview: true,
    notes: "Desviaciones declaradas y no verificadas; sin plazos calculables.",
  },
  AMBIENTAL: {
    code: "AMBIENTAL",
    label: "Sancionatorio ambiental",
    legalBasis: "Ley 1333 de 2009",
    verified: false,
    requiresManualReview: true,
    notes: "Procedimiento propio; CPACA supletorio.",
  },
  TRANSITO: {
    code: "TRANSITO",
    label: "Contravencional de tránsito",
    legalBasis: "Ley 769 de 2002 / Ley 1383 de 2010",
    verified: false,
    requiresManualReview: true,
    notes: "Un comparendo es un perfil más, nunca el modelo.",
  },
};

// -------------------------------------------------------------------- terms

export type GovDeadlineType =
  | "GOV_DESCARGOS"
  | "GOV_PERIODO_PROBATORIO"
  | "GOV_TRASLADO_ALEGATOS"
  | "GOV_DECISION_FONDO"
  | "GOV_RECURSOS"
  | "GOV_CADUCIDAD_SANCIONATORIA"
  | "GOV_RECURSO_UN_ANO";

export type AnchorKind = "ISSUANCE" | "NOTIFICATION" | "TERM_EXPIRY" | "FACT_DATE" | "FILING_DATE";

export interface GovTermDef {
  deadlineType: GovDeadlineType;
  label: string;
  /** null = declared but not verified; nothing may be computed from it. */
  durationValue: number | null;
  dayType: "BUSINESS" | "CALENDAR" | "MONTHS" | "YEARS";
  termClass: TermClass;
  anchorKind: AnchorKind;
  maxExtensionValue: number | null;
  extensionCondition: string | null;
  norma: string;
  requiresManualReview: boolean;
  isBackgroundTimer: boolean;
}

/** Verified default regime. Legal terms are never organization-configurable. */
export const CPACA_GENERAL_TERMS: Record<GovDeadlineType, GovTermDef> = {
  GOV_DESCARGOS: {
    deadlineType: "GOV_DESCARGOS", label: "Término de descargos", durationValue: 15,
    dayType: "BUSINESS", termClass: "ADMINISTRATIVO", anchorKind: "NOTIFICATION",
    maxExtensionValue: null, extensionCondition: null, norma: "CPACA art. 47",
    requiresManualReview: false, isBackgroundTimer: false,
  },
  GOV_PERIODO_PROBATORIO: {
    deadlineType: "GOV_PERIODO_PROBATORIO", label: "Período probatorio", durationValue: 30,
    dayType: "BUSINESS", termClass: "ADMINISTRATIVO", anchorKind: "ISSUANCE",
    maxExtensionValue: 60,
    extensionCondition: "Tres o más investigados o prueba que deba practicarse en el exterior",
    norma: "CPACA art. 48", requiresManualReview: false, isBackgroundTimer: false,
  },
  GOV_TRASLADO_ALEGATOS: {
    deadlineType: "GOV_TRASLADO_ALEGATOS", label: "Traslado para alegatos", durationValue: 10,
    dayType: "BUSINESS", termClass: "ADMINISTRATIVO", anchorKind: "TERM_EXPIRY",
    maxExtensionValue: null, extensionCondition: null, norma: "CPACA art. 48 inc. 2",
    requiresManualReview: false, isBackgroundTimer: false,
  },
  GOV_DECISION_FONDO: {
    deadlineType: "GOV_DECISION_FONDO", label: "Decisión de fondo", durationValue: 30,
    dayType: "BUSINESS", termClass: "ADMINISTRATIVO", anchorKind: "FILING_DATE",
    maxExtensionValue: null, extensionCondition: null, norma: "CPACA art. 49",
    requiresManualReview: false, isBackgroundTimer: false,
  },
  GOV_RECURSOS: {
    deadlineType: "GOV_RECURSOS", label: "Término para interponer recursos", durationValue: 10,
    dayType: "BUSINESS", termClass: "ADMINISTRATIVO", anchorKind: "NOTIFICATION",
    maxExtensionValue: null, extensionCondition: null, norma: "CPACA arts. 74 y 76",
    requiresManualReview: false, isBackgroundTimer: false,
  },
  GOV_CADUCIDAD_SANCIONATORIA: {
    deadlineType: "GOV_CADUCIDAD_SANCIONATORIA", label: "Caducidad de la facultad sancionatoria",
    durationValue: 3, dayType: "YEARS", termClass: "ADMINISTRATIVO", anchorKind: "FACT_DATE",
    maxExtensionValue: null, extensionCondition: null, norma: "CPACA art. 52",
    requiresManualReview: false, isBackgroundTimer: true,
  },
  GOV_RECURSO_UN_ANO: {
    deadlineType: "GOV_RECURSO_UN_ANO", label: "Un año para decidir el recurso",
    durationValue: 1, dayType: "YEARS", termClass: "ADMINISTRATIVO", anchorKind: "FILING_DATE",
    maxExtensionValue: null, extensionCondition: null, norma: "CPACA art. 52 inc. 2",
    requiresManualReview: false, isBackgroundTimer: true,
  },
};

/**
 * Term resolution: an unverified regime never yields a computable term — it
 * falls through to manual review instead of silently borrowing CPACA's days.
 */
export function resolveGovTerm(
  regime: GovRegimeCode,
  deadlineType: GovDeadlineType,
): { term: GovTermDef; computable: boolean; reason?: string } {
  const base = CPACA_GENERAL_TERMS[deadlineType];
  if (regime === "CPACA_GENERAL") return { term: base, computable: true };
  return {
    term: { ...base, durationValue: null, requiresManualReview: true },
    computable: false,
    reason: `El régimen ${GOV_REGIMES[regime].label} no está verificado artículo por artículo: el término debe fijarse manualmente.`,
  };
}

/** Caducidad anchor: the fact, or the cessation date when the conduct is continued. */
export function caducidadAnchor(state: {
  factDate: string | null;
  conductaContinuada: boolean;
  cessationDate: string | null;
}): { anchor: string | null; note: string } {
  if (state.conductaContinuada) {
    return {
      anchor: state.cessationDate,
      note: "Conducta continuada: se cuenta desde el día siguiente a la cesación (CPACA art. 52).",
    };
  }
  return {
    anchor: state.factDate,
    note: "Se cuenta desde el día de ocurrencia del hecho (CPACA art. 52).",
  };
}

/** The sanctioning power is exercised only when the act is NOTIFIED, not issued. */
export function caducidadSatisfied(notifiedAt: string | null, deadlineDate: string): boolean {
  return notifiedAt !== null && notifiedAt <= deadlineDate;
}

// ------------------------------------------------------------------- events

export type GovEventKind = "PROCEDURAL" | "SYSTEM" | "ADMINISTRATIVE" | "NOISE";

export interface GovEventDef {
  code: string;
  label: string;
  kind: GovEventKind;
  excludedFromInference: boolean;
}

export const GOV_EVENTS: GovEventDef[] = [
  { code: "APERTURA_INDAGACION", label: "Apertura de averiguación preliminar", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "COMUNICACION_MERITOS", label: "Comunicación de méritos al interesado", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "FORMULACION_CARGOS", label: "Formulación de cargos", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "NOTIFICACION_PERSONAL", label: "Notificación personal", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "NOTIFICACION_AVISO", label: "Notificación por aviso", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "NOTIFICACION_ELECTRONICA", label: "Notificación electrónica", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "NOTIFICACION_CONDUCTA_CONCLUYENTE", label: "Notificación por conducta concluyente", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "DESCARGOS_PRESENTADOS", label: "Presentación de descargos", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "SOLICITUD_PRUEBAS", label: "Solicitud de pruebas", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "DECRETO_PRUEBAS", label: "Auto que decreta pruebas", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "PRORROGA_PROBATORIO", label: "Prórroga del período probatorio", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "CIERRE_PROBATORIO", label: "Cierre del período probatorio", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "TRASLADO_ALEGATOS", label: "Traslado para alegatos", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "ALEGATOS_PRESENTADOS", label: "Presentación de alegatos", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "RESOLUCION_SANCION", label: "Resolución que impone sanción", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "RESOLUCION_EXONERACION", label: "Resolución de exoneración y archivo", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "RECURSO_REPOSICION", label: "Interposición de recurso de reposición", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "RECURSO_APELACION", label: "Interposición de recurso de apelación", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "RECURSO_QUEJA", label: "Interposición de recurso de queja", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "RESOLUCION_RECURSO", label: "Resolución que decide el recurso", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "CONSTANCIA_EJECUTORIA", label: "Constancia de ejecutoria / firmeza", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "RENUENCIA_INFORMACION", label: "Renuencia a suministrar información", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "SUSPENSION_PROVISIONAL", label: "Suspensión provisional del servidor", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "COBRO_COACTIVO_INICIADO", label: "Inicio de cobro coactivo", kind: "PROCEDURAL", excludedFromInference: false },
  { code: "ACUSE_RECIBO", label: "Acuse de recibo automático", kind: "NOISE", excludedFromInference: true },
  { code: "FUERA_DE_OFICINA", label: "Respuesta automática de ausencia", kind: "NOISE", excludedFromInference: true },
  { code: "CONFIRMACION_LECTURA", label: "Confirmación de lectura", kind: "NOISE", excludedFromInference: true },
];

/** Cobro coactivo and the medio de control are separate matters: link, never merge. */
export const GOV_SUCCESSION_RELATIONS = ["COBRO_COACTIVO", "MEDIO_DE_CONTROL"] as const;
