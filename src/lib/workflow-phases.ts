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
    { key: "PREPARACION", label: "Indagación" },
    { key: "RADICACION", label: "Imputación" },
    { key: "AUDIENCIAS", label: "Audiencias" },
    { key: "SENTENCIA", label: "Sentencia" },
    { key: "RECURSOS", label: "Recursos" },
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

export function mapStageToCanonicalPhase(
  workflowType: WorkflowType,
  stage: string | null | undefined,
): string | null {
  if (!stage) return null;
  const phases = WORKFLOW_PHASES[workflowType] ?? WORKFLOW_PHASES.GENERIC;
  const keys = new Set(phases.map((p) => p.key));
  const raw = stage.toUpperCase();

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
  for (const [re, key] of PHASE_HEURISTICS) {
    if (re.test(raw) && keys.has(key)) return key;
  }
  return null;
}

export function getWorkflowPhases(workflowType: WorkflowType): CanonicalPhase[] {
  return WORKFLOW_PHASES[workflowType] ?? WORKFLOW_PHASES.GENERIC;
}
