/**
 * Unified Workflow Constants
 * Defines the 6 workflow types and their stages for the unified work item model
 */

// Workflow type enum matching database
export type WorkflowType = 'CGP' | 'PETICION' | 'TUTELA' | 'GOV_PROCEDURE' | 'CPACA' | 'LABORAL' | 'PENAL_906' | 'GENERIC' | 'INDETERMINADO';

// Item source enum matching database
export type ItemSource = 'ICARUS_IMPORT' | 'SCRAPE_API' | 'MANUAL' | 'EMAIL_IMPORT' | 'MIGRATION';

// Item status enum matching database
export type ItemStatus = 'ACTIVE' | 'INACTIVE' | 'CLOSED' | 'ARCHIVED';

// CGP Phase (filing vs process) - only for CGP workflow
export type CGPPhase = 'FILING' | 'PROCESS';

/**
 * Canonical workflow-type normalizer.
 *
 * The database enum has no 'PENAL' value — the canonical criminal type is
 * 'PENAL_906'. 'PENAL' is accepted here as a DEFENSIVE ALIAS for legacy
 * payloads, imports and MCP callers, and is never emitted by our own code.
 */
export const WORKFLOW_TYPE_ALIASES: Record<string, WorkflowType> = {
  PENAL: 'PENAL_906',
  'PENAL906': 'PENAL_906',
  'PENAL_906': 'PENAL_906',
  'LEY_906': 'PENAL_906',
  PROC_ADMIN: 'GOV_PROCEDURE',
  GOV_PROC: 'GOV_PROCEDURE',
};

export function normalizeWorkflowType(raw: string | null | undefined): WorkflowType | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (WORKFLOW_TYPE_ALIASES[key]) return WORKFLOW_TYPE_ALIASES[key];
  return (key in WORKFLOW_TYPES ? (key as WorkflowType) : null);
}

// Workflow definitions with UI metadata
export const WORKFLOW_TYPES: Record<WorkflowType, {
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  icon: string;
  hasPhases: boolean; // Only CGP has filing/process phases
}> = {
  CGP: {
    label: 'Demandas CGP',
    shortLabel: 'CGP',
    description: 'Demandas y procesos bajo Código General del Proceso (civil, comercial, familia)',
    color: 'emerald',
    icon: 'Scale',
    hasPhases: true,
  },
  LABORAL: {
    label: 'Procesos Laborales',
    shortLabel: 'Laboral',
    description: 'Procesos judiciales laborales bajo Código Procesal del Trabajo (CPTSS)',
    color: 'rose',
    icon: 'Briefcase',
    hasPhases: false,
  },
  PETICION: {
    label: 'Peticiones',
    shortLabel: 'Petición',
    description: 'Derechos de petición ante entidades públicas y privadas',
    color: 'blue',
    icon: 'Send',
    hasPhases: false,
  },
  TUTELA: {
    label: 'Tutelas',
    shortLabel: 'Tutela',
    description: 'Acciones de tutela para protección de derechos fundamentales',
    color: 'purple',
    icon: 'Gavel',
    hasPhases: false,
  },
  GOV_PROCEDURE: {
    label: 'Vía Gubernativa',
    shortLabel: 'Gubernativa',
    description: 'Procedimientos ante autoridades administrativas (policivos, disciplinarios, SIC, etc.)',
    color: 'orange',
    icon: 'Building2',
    hasPhases: false,
  },
  CPACA: {
    label: 'CPACA',
    shortLabel: 'CPACA',
    description: 'Procesos contencioso administrativos ante jurisdicción administrativa',
    color: 'indigo',
    icon: 'Landmark',
    hasPhases: false,
  },
  PENAL_906: {
    label: 'Penal (Ley 906)',
    shortLabel: 'Penal',
    description: 'Procesos penales bajo el sistema acusatorio (Ley 906 de 2004)',
    color: 'red',
    icon: 'Shield',
    hasPhases: false,
  },
  INDETERMINADO: {
    label: 'Por clasificar',
    shortLabel: 'Por clasificar',
    description: 'Asuntos cuya materia aún no ha sido determinada (despacho de competencia mixta o sin clase de proceso)',
    color: 'amber',
    icon: 'HelpCircle',
    hasPhases: false,
  },
  GENERIC: {
    label: 'Genérico',
    shortLabel: 'Genérico',
    description: 'Asuntos importados sin clasificación de flujo específico',
    color: 'gray',
    icon: 'FileText',
    hasPhases: false,
  },
};

// Ordered list of workflow types for UI rendering
export const WORKFLOW_TYPES_ORDER: WorkflowType[] = [
  'CGP',
  'LABORAL',
  'PETICION',
  'TUTELA',
  'GOV_PROCEDURE',
  'CPACA',
  'PENAL_906',
  'GENERIC',
];

// ============================================
// CGP Stages (Filing phase + Process phase)
// ============================================

/**
 * CGP Filing stages (granular, pre-auto-admisorio inference vocabulary).
 *
 * @see CGP_STAGES (cgp-stages.ts) for the Dashboard bucket vocabulary.
 * Every key here must map to a CGP_STAGES bucket via
 * `mapInferenceStageToDashboard()` in cgp-stages.ts.
 * See `src/lib/__tests__/cgpStageDrift.test.ts` for the drift guard.
 */
export const CGP_FILING_STAGES = {
  DRAFTED: { label: 'Borrador', order: 0 },
  SENT_TO_REPARTO: { label: 'Enviado a Reparto', order: 1 },
  ACTA_PENDING: { label: 'Acta Pendiente', order: 2 },
  ACTA_RECEIVED: { label: 'Acta Recibida', order: 3 },
  SUBSANACION: { label: 'Subsanación', order: 4 },
  RADICADO_PENDING: { label: 'Radicado Pendiente', order: 5 },
  RADICADO_CONFIRMED: { label: 'Radicado Confirmado', order: 6 },
  PENDING_AUTO_ADMISORIO: { label: 'Pendiente Auto Admisorio', order: 7 },
} as const;

/**
 * CGP Process stages (granular, post-auto-admisorio inference vocabulary).
 *
 * @see CGP_STAGES (cgp-stages.ts) for the Dashboard bucket vocabulary.
 * Every key here must map to a CGP_STAGES bucket via
 * `mapInferenceStageToDashboard()` in cgp-stages.ts.
 * See `src/lib/__tests__/cgpStageDrift.test.ts` for the drift guard.
 */
export const CGP_PROCESS_STAGES = {
  AUTO_ADMISORIO: { label: 'Auto Admisorio', order: 0 },
  CUADERNO: { label: 'Cuaderno de medidas', order: 1 },
  NOTIFICACION_PERSONAL: { label: 'Notificación Personal', order: 2 },
  NOTIFICACION_AVISO: { label: 'Notificación por Aviso', order: 3 },
  EXCEPCIONES_PREVIAS: { label: 'Excepciones Previas', order: 4 },
  PRONUNCIARSE_EXCEPCIONES: { label: 'Pronunciarse Excepciones', order: 5 },
  AUDIENCIA_INICIAL: { label: 'Audiencia Inicial', order: 6 },
  AUDIENCIA_INSTRUCCION: { label: 'Audiencia Instrucción', order: 7 },
  ALEGATOS_SENTENCIA: { label: 'Alegatos y Sentencia', order: 8 },
  APELACION: { label: 'Apelación', order: 9 },
} as const;

export type CGPFilingStage = keyof typeof CGP_FILING_STAGES;
export type CGPProcessStage = keyof typeof CGP_PROCESS_STAGES;

// ============================================
// Petición Stages
// ============================================
export const PETICION_STAGES = {
  PETICION_RADICADA: { label: 'Petición Radicada', order: 0 },
  CONSTANCIA_RADICACION: { label: 'Constancia de Radicación', order: 1 },
  PRORROGA: { label: 'Prórroga', order: 2 },
  RESPUESTA: { label: 'Respuesta', order: 3 },
} as const;

export type PeticionStage = keyof typeof PETICION_STAGES;

// ============================================
// Tutela Stages
// ============================================
export const TUTELA_STAGES = {
  TUTELA_RADICADA: { label: 'Tutela Radicada', order: 0 },
  TUTELA_ADMITIDA: { label: 'Tutela Admitida', order: 1 },
  FALLO_PRIMERA_INSTANCIA: { label: 'Fallo Primera Instancia', order: 2 },
  FALLO_SEGUNDA_INSTANCIA: { label: 'Fallo Segunda Instancia', order: 3 },
  ARCHIVADO: { label: 'Archivado', order: 4 },
} as const;

export type TutelaStage = keyof typeof TUTELA_STAGES;

// ============================================
// Vía Gubernativa Stages
// ============================================
export const GOV_PROCEDURE_STAGES = {
  INICIO_APERTURA: { label: 'Inicio / Apertura', order: 0 },
  REQUERIMIENTOS_TRASLADOS: { label: 'Requerimientos / Traslados', order: 1 },
  DESCARGOS: { label: 'Descargos', order: 2 },
  PRUEBAS: { label: 'Pruebas', order: 3 },
  ALEGATOS_INFORME: { label: 'Alegatos / Informe', order: 4 },
  DECISION_PRIMERA: { label: 'Decisión (1ª Instancia)', order: 5 },
  RECURSOS: { label: 'Recursos', order: 6 },
  EJECUCION_CUMPLIMIENTO: { label: 'Ejecución / Cumplimiento', order: 7 },
  ARCHIVADO: { label: 'Archivado', order: 8 },
} as const;

export type GovProcedureStage = keyof typeof GOV_PROCEDURE_STAGES;

// ============================================
// CPACA Stages
// ============================================
export const CPACA_STAGES = {
  PRECONTENCIOSO: { label: 'Precontencioso', order: 0 },
  DEMANDA_POR_RADICAR: { label: 'Demanda por Radicar', order: 1 },
  DEMANDA_RADICADA: { label: 'Demanda Radicada', order: 2 },
  AUTO_ADMISORIO: { label: 'Auto Admisorio', order: 3 },
  TRASLADO_DEMANDA: { label: 'Traslado Demanda', order: 4 },
  TRASLADO_EXCEPCIONES: { label: 'Traslado Excepciones', order: 5 },
  AUDIENCIA_INICIAL: { label: 'Audiencia Inicial', order: 6 },
  AUDIENCIA_PRUEBAS: { label: 'Audiencia Pruebas', order: 7 },
  ALEGATOS_SENTENCIA: { label: 'Alegatos y Sentencia', order: 8 },
  RECURSOS: { label: 'Recursos', order: 9 },
  EJECUCION_CUMPLIMIENTO: { label: 'Ejecución / Cumplimiento', order: 10 },
} as const;

export type CpacaStage = keyof typeof CPACA_STAGES;

// ============================================
// LABORAL Stages (Labor Judicial)
// ============================================
export const LABORAL_STAGES = {
  BORRADOR: { label: 'Borrador', order: 0 },
  RADICACION: { label: 'Radicación', order: 1 },
  REPARTO: { label: 'Reparto', order: 2 },
  ADMISION_PENDIENTE: { label: 'Admisión Pendiente', order: 3 },
  AUDIENCIA_INICIAL: { label: 'Audiencia Inicial', order: 4 },
  AUDIENCIA_JUZGAMIENTO: { label: 'Aud. Juzgamiento', order: 5 },
  SENTENCIA_1A_INSTANCIA: { label: 'Sentencia 1ª', order: 6 },
  APELACION: { label: 'Apelación', order: 7 },
  EJECUCION: { label: 'Ejecución', order: 8 },
  ARCHIVADO: { label: 'Archivado', order: 9 },
} as const;

export type LaboralStage = keyof typeof LABORAL_STAGES;

// ============================================
// PENAL_906 Stages (Ley 906/2004 — sistema acusatorio)
//
// Canonical display order. Preclusión and Archivo are terminal OUTCOME
// BRANCHES, not anomalies: a preclusión hearing is an ordinary event in these
// matters. They are listed last so the linear sequence renders untouched.
// ============================================
export const PENAL_906_STAGES = {
  INDAGACION: { label: 'Indagación', order: 0 },
  IMPUTACION: { label: 'Formulación de imputación', order: 1 },
  MEDIDA_ASEGURAMIENTO: { label: 'Medida de aseguramiento', order: 2 },
  ESCRITO_ACUSACION: { label: 'Escrito de acusación', order: 3 },
  AUDIENCIA_ACUSACION: { label: 'Audiencia de formulación de acusación', order: 4 },
  PREPARATORIA: { label: 'Audiencia preparatoria', order: 5 },
  JUICIO_ORAL: { label: 'Juicio oral', order: 6 },
  SENTENCIA: { label: 'Sentencia', order: 7 },
  RECURSOS: { label: 'Recursos', order: 8 },
  PRECLUSION: { label: 'Preclusión', order: 9 },
  ARCHIVO: { label: 'Archivo', order: 10 },
} as const;

export type Penal906Stage = keyof typeof PENAL_906_STAGES;

// ============================================
// Helper functions
// ============================================

/**
 * Get stages for a given workflow type
 */
export function getStagesForWorkflow(workflowType: WorkflowType, cgpPhase?: CGPPhase): Record<string, { label: string; order: number }> {
  switch (workflowType) {
    case 'CGP':
      return cgpPhase === 'PROCESS' ? CGP_PROCESS_STAGES : CGP_FILING_STAGES;
    case 'PETICION':
      return PETICION_STAGES;
    case 'TUTELA':
      return TUTELA_STAGES;
    case 'GOV_PROCEDURE':
      return GOV_PROCEDURE_STAGES;
    case 'CPACA':
      return CPACA_STAGES;
    case 'LABORAL':
      return LABORAL_STAGES;
    case 'PENAL_906':
      return PENAL_906_STAGES;
    default:
      return {};
  }
}

/**
 * Get ordered stage keys for a workflow
 */
export function getStageOrderForWorkflow(workflowType: WorkflowType, cgpPhase?: CGPPhase): string[] {
  const stages = getStagesForWorkflow(workflowType, cgpPhase);
  return Object.entries(stages)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key]) => key);
}

/**
 * Get default initial stage for a workflow
 */
export function getDefaultStage(workflowType: WorkflowType, cgpPhase?: CGPPhase): string {
  const stages = getStageOrderForWorkflow(workflowType, cgpPhase);
  return stages[0] || '';
}

/**
 * Get stage label
 */
export function getStageLabel(workflowType: WorkflowType, stage: string, cgpPhase?: CGPPhase): string {
  const stages = getStagesForWorkflow(workflowType, cgpPhase);
  return stages[stage]?.label || stage;
}

/**
 * Check if a workflow type uses 23-digit radicado
 */
export function workflowUsesRadicado(workflowType: WorkflowType): boolean {
  return workflowType === 'CGP' || workflowType === 'CPACA' || workflowType === 'TUTELA' || workflowType === 'LABORAL' || workflowType === 'PENAL_906';
}
