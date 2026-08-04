/**
 * Canonical procedural phases ("Línea procesal")
 *
 * Display-only catalog. Legacy stage values (RADICADO / RADICACION /
 * DEMANDA_RADICADA / RADICADO_CONFIRMED / TUTELA_RADICADA ...) coexist in the
 * database across workflows; we do NOT migrate them — we map them onto a
 * canonical ordered phase at render time.
 */
import type { WorkflowType } from "@/lib/workflow-constants";

export interface CanonicalPhase {
  key: string;
  label: string;
  /**
   * Parallel/terminal outcome branch (e.g. Preclusión in Ley 906). Rendered
   * apart from the linear sequence and never counted as "completed".
   */
  branch?: boolean;
}

export const WORKFLOW_PHASES: Record<WorkflowType, CanonicalPhase[]> = {
  CGP: [
    { key: "PREPARACION", label: "Preparación" },
    { key: "RADICACION", label: "Radicación" },
    { key: "ADMISION", label: "Admisión" },
    { key: "NOTIFICACION", label: "Notificación" },
    { key: "CONTESTACION", label: "Contestación / Excepciones" },
    { key: "AUDIENCIAS", label: "Audiencias" },
    { key: "SENTENCIA", label: "Sentencia" },
    { key: "RECURSOS", label: "Recursos" },
  ],
  CPACA: [
    { key: "PRECONTENCIOSO", label: "Precontencioso" },
    { key: "RADICACION", label: "Radicación" },
    { key: "ADMISION", label: "Admisión" },
    { key: "NOTIFICACION", label: "Notificación y traslados" },
    { key: "CONTESTACION", label: "Contestación / Excepciones" },
    { key: "AUDIENCIAS", label: "Audiencias" },
    { key: "SENTENCIA", label: "Alegatos y sentencia" },
    { key: "RECURSOS", label: "Recursos" },
  ],
  TUTELA: [
    { key: "PREPARACION", label: "Preparación" },
    { key: "RADICACION", label: "Radicación" },
    { key: "ADMISION", label: "Admisión" },
    { key: "SENTENCIA", label: "Fallo" },
    { key: "RECURSOS", label: "Impugnación" },
    { key: "CUMPLIMIENTO", label: "Cumplimiento" },
  ],
  LABORAL: [
    { key: "PREPARACION", label: "Preparación" },
    { key: "RADICACION", label: "Radicación" },
    { key: "ADMISION", label: "Admisión" },
    { key: "NOTIFICACION", label: "Notificación" },
    { key: "CONTESTACION", label: "Contestación" },
    { key: "AUDIENCIAS", label: "Audiencias" },
    { key: "SENTENCIA", label: "Sentencia" },
    { key: "RECURSOS", label: "Recursos" },
  ],
  PENAL_906: [
    { key: "INDAGACION", label: "Indagación" },
    { key: "IMPUTACION", label: "Formulación de imputación" },
    { key: "MEDIDA_ASEGURAMIENTO", label: "Medida de aseguramiento" },
    { key: "ESCRITO_ACUSACION", label: "Escrito de acusación" },
    { key: "AUDIENCIA_ACUSACION", label: "Audiencia de formulación de acusación" },
    { key: "PREPARATORIA", label: "Audiencia preparatoria" },
    { key: "JUICIO_ORAL", label: "Juicio oral" },
    { key: "SENTENCIA", label: "Sentencia" },
    { key: "RECURSOS", label: "Recursos" },
    { key: "PRECLUSION", label: "Preclusión", branch: true },
  ],
  PETICION: [
    { key: "RADICACION", label: "Radicada" },
    { key: "NOTIFICACION", label: "Constancia" },
    { key: "CONTESTACION", label: "Prórroga" },
    { key: "SENTENCIA", label: "Respuesta" },
  ],
  GOV_PROCEDURE: [
    { key: "PREPARACION", label: "Preparación" },
    { key: "RADICACION", label: "Radicación" },
    { key: "CONTESTACION", label: "Trámite" },
    { key: "SENTENCIA", label: "Decisión" },
    { key: "RECURSOS", label: "Recursos" },
  ],
  INDETERMINADO: [],
  GENERIC: [
    { key: "PREPARACION", label: "Preparación" },
    { key: "RADICACION", label: "Radicación" },
    { key: "CONTESTACION", label: "Trámite" },
    { key: "SENTENCIA", label: "Decisión" },
  ],
};

/**
 * Legacy/raw stage value -> canonical phase key. Matching is case-insensitive
 * and falls back to keyword heuristics so new stage strings degrade gracefully.
 */
const STAGE_TO_PHASE: Record<string, string> = {
  // Preparación
  DRAFTED: "PREPARACION",
  BORRADOR: "PREPARACION",
  PRECONTENCIOSO: "PRECONTENCIOSO",
  DEMANDA_POR_RADICAR: "PREPARACION",
  SENT_PENDING: "PREPARACION",
  SENT_TO_REPARTO: "PREPARACION",
  // Radicación
  RADICADO: "RADICACION",
  RADICACION: "RADICACION",
  DEMANDA_RADICADA: "RADICACION",
  RADICADO_CONFIRMED: "RADICACION",
  RADICADO_PENDING: "RADICACION",
  TUTELA_RADICADA: "RADICACION",
  PETICION_RADICADA: "RADICACION",
  ACTA_RECEIVED: "RADICACION",
  // Admisión
  PENDING_AUTO_ADMISORIO: "ADMISION",
  AUTO_ADMISORIO: "ADMISION",
  ADMISION: "ADMISION",
  TUTELA_ADMITIDA: "ADMISION",
  SUBSANACION: "ADMISION",
  // Notificación
  NOTIFICACION_PERSONAL: "NOTIFICACION",
  NOTIFICACION_AVISO: "NOTIFICACION",
  NOTIFICACION_TRASLADOS: "NOTIFICACION",
  CONSTANCIA_RADICACION: "NOTIFICACION",
  // Contestación
  TRASLADO_DEMANDA: "CONTESTACION",
  TRASLADO_EXCEPCIONES: "CONTESTACION",
  EXCEPCIONES_PREVIAS: "CONTESTACION",
  CONTESTACION: "CONTESTACION",
  REFORMA_DEMANDA: "CONTESTACION",
  PRORROGA: "CONTESTACION",
  SANEAMIENTO: "CONTESTACION",
  CUADERNO: "CONTESTACION",
  REQUERIMIENTOS_TRASLADOS: "CONTESTACION",
  TRAMITE: "CONTESTACION",
  // Audiencias
  AUDIENCIA_INICIAL: "AUDIENCIAS",
  AUDIENCIA_PRUEBAS: "AUDIENCIAS",
  AUDIENCIA_INSTRUCCION: "AUDIENCIAS",
  // Sentencia
  ALEGATOS_SENTENCIA: "SENTENCIA",
  SENTENCIA: "SENTENCIA",
  FALLO_PRIMERA_INSTANCIA: "SENTENCIA",
  RESPUESTA: "SENTENCIA",
  // Recursos
  APELACION: "RECURSOS",
  RECURSOS: "RECURSOS",
  IMPUGNACION: "RECURSOS",
  SEGUNDA_INSTANCIA: "RECURSOS",
  // Cumplimiento
  EJECUCION_CUMPLIMIENTO: "CUMPLIMIENTO",
  CUMPLIMIENTO: "CUMPLIMIENTO",
  ARCHIVADO: "CUMPLIMIENTO",
};

/**
 * Stages that exist in production but precede admission: they must resolve to
 * "Radicación", not to "Admisión" (the /ADMIS/ heuristic would misfire).
 */
const PRE_ADMISSION_STAGES: Record<string, string> = {
  ADMISION_PENDIENTE: "RADICACION",
  PENDING_ADMISION: "RADICACION",
};

const PHASE_HEURISTICS: Array<[RegExp, string]> = [
  [/SANEAMIENTO|CUADERNO/, "CONTESTACION"],
  [/RADICA/, "RADICACION"],
  [/ADMIS|ADMIT|SUBSAN|INADMIT/, "ADMISION"],
  [/NOTIFIC|EMPLAZ|CURADOR/, "NOTIFICACION"],
  [/CONTEST|TRASLADO|EXCEPCION|REQUERIMIENTO/, "CONTESTACION"],
  [/AUDIENCIA/, "AUDIENCIAS"],
  [/SENTENCIA|FALLO|ALEGATOS/, "SENTENCIA"],
  [/APEL|RECURSO|IMPUGNA|SEGUNDA\s*INSTANCIA|REPOSICI/, "RECURSOS"],
  [/CUMPLIMIENTO|EJECUCION|EJECUTORIA|ARCHIV|TERMINACION/, "CUMPLIMIENTO"],
];

/**
 * Ley 906/2004 (sistema penal acusatorio) vocabulary. Penal matters do not
 * share the civil "radicación / admisión / traslado" sequence, so they get
 * their own stage map and heuristics, evaluated before the generic ones.
 */
const PENAL_STAGE_TO_PHASE: Record<string, string> = {
  PENDIENTE_CLASIFICACION: "INDAGACION",
  NOTICIA_CRIMINAL_INDAGACION: "INDAGACION",
  INDAGACION: "INDAGACION",
  IMPUTACION_INVESTIGACION: "IMPUTACION",
  IMPUTACION: "IMPUTACION",
  MEDIDA_ASEGURAMIENTO: "MEDIDA_ASEGURAMIENTO",
  ESCRITO_ACUSACION: "ESCRITO_ACUSACION",
  ACUSACION: "AUDIENCIA_ACUSACION",
  AUDIENCIA_ACUSACION: "AUDIENCIA_ACUSACION",
  PREPARATORIA: "PREPARATORIA",
  AUDIENCIA_PREPARATORIA: "PREPARATORIA",
  JUICIO_ORAL: "JUICIO_ORAL",
  SENTENCIA_TRAMITE: "SENTENCIA",
  SENTENCIA: "SENTENCIA",
  FINALIZADO_ABSUELTO: "SENTENCIA",
  FINALIZADO_CONDENADO: "SENTENCIA",
  SEGUNDA_INSTANCIA: "RECURSOS",
  RECURSOS: "RECURSOS",
  APELACION: "RECURSOS",
  EJECUTORIA: "SENTENCIA",
  PRECLUSION_TRAMITE: "PRECLUSION",
  PRECLUSION: "PRECLUSION",
  PRECLUIDO_ARCHIVADO: "PRECLUSION",
};

const PENAL_HEURISTICS: Array<[RegExp, string]> = [
  [/PRECLUS/, "PRECLUSION"],
  [/MEDIDA\s*DE?\s*ASEGURAMIENTO|DETENCION\s*PREVENTIVA/, "MEDIDA_ASEGURAMIENTO"],
  [/ESCRITO\s*DE?\s*ACUSACION|TRASLADO\s*(DEL?\s*)?ESCRITO\s*DE?\s*ACUSACION/, "ESCRITO_ACUSACION"],
  [/(AUDIENCIA|FORMULACION)[^.]{0,30}ACUSACION|ACUSACION/, "AUDIENCIA_ACUSACION"],
  [/PREPARATORIA/, "PREPARATORIA"],
  [/JUICIO\s*ORAL|AUDIENCIA\s*CONCENTRADA|JUICIO/, "JUICIO_ORAL"],
  [/IMPUTACION|LEGALIZACION\s*DE?\s*CAPTURA/, "IMPUTACION"],
  [/INDAGACION|NOTICIA\s*CRIMINAL|QUERELLA|DENUNCIA/, "INDAGACION"],
  [/SENTENCIA|FALLO|CONDENA|ABSOLU/, "SENTENCIA"],
  [/APEL|RECURSO|CASACION|SEGUNDA\s*INSTANCIA/, "RECURSOS"],
];

export function mapStageToCanonicalPhase(
  workflowType: WorkflowType,
  stage: string | null | undefined,
): string | null {
  if (!stage) return null;
  const phases = WORKFLOW_PHASES[workflowType] ?? WORKFLOW_PHASES.GENERIC;
  const keys = new Set(phases.map((p) => p.key));
  const raw = stage.toUpperCase();

  if (workflowType === "PENAL_906") {
    const penal = PENAL_STAGE_TO_PHASE[raw];
    if (penal && keys.has(penal)) return penal;
    for (const [re, key] of PENAL_HEURISTICS) {
      if (re.test(raw) && keys.has(key)) return key;
    }
    return null;
  }

  const preAdmission = PRE_ADMISSION_STAGES[raw];
  if (preAdmission && keys.has(preAdmission)) return preAdmission;

  const direct = STAGE_TO_PHASE[raw];
  if (direct && keys.has(direct)) return direct;
  if (keys.has(raw)) return raw;

  for (const [re, key] of PHASE_HEURISTICS) {
    if (re.test(raw) && keys.has(key)) return key;
  }
  return null;
}

/**
 * Infer a display phase from free procedural text (latest actuación / estado)
 * when the stored stage is null or unmappable. Purely presentational — callers
 * must label the result as "(inferida)".
 */
export function inferPhaseFromText(
  workflowType: WorkflowType,
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const phases = WORKFLOW_PHASES[workflowType] ?? WORKFLOW_PHASES.GENERIC;
  const keys = new Set(phases.map((p) => p.key));
  const raw = text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const rules = workflowType === "PENAL_906" ? PENAL_HEURISTICS : PHASE_HEURISTICS;
  for (const [re, key] of rules) {
    if (re.test(raw) && keys.has(key)) return key;
  }
  return null;
}

export function getWorkflowPhases(workflowType: WorkflowType): CanonicalPhase[] {
  return WORKFLOW_PHASES[workflowType] ?? WORKFLOW_PHASES.GENERIC;
}
