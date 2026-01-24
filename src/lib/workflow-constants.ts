/**
 * Unified Workflow Constants
 * Defines the 6 workflow types and their stages for the unified work item model
 */

// Workflow type enum matching database
export type WorkflowType = 'CGP' | 'PETICION' | 'TUTELA' | 'GOV_PROCEDURE' | 'CPACA' | 'LABORAL';

// Item source enum matching database
export type ItemSource = 'ICARUS_IMPORT' | 'SCRAPE_API' | 'MANUAL' | 'EMAIL_IMPORT' | 'MIGRATION';

// Item status enum matching database
export type ItemStatus = 'ACTIVE' | 'INACTIVE' | 'CLOSED' | 'ARCHIVED';

// CGP Phase (filing vs process) - only for CGP workflow
export type CGPPhase = 'FILING' | 'PROCESS';

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
};

// Ordered list of workflow types for UI rendering
export const WORKFLOW_TYPES_ORDER: WorkflowType[] = [
  'CGP',
  'LABORAL',
  'PETICION',
  'TUTELA',
  'GOV_PROCEDURE',
  'CPACA',
];

// ============================================
// CGP Stages (Filing phase + Process phase)
// ============================================

// CGP Filing stages (before auto admisorio)
export const CGP_FILING_STAGES = {
  DRAFTED: { label: 'Borrador', order: 0 },
  SENT_TO_REPARTO: { label: 'Enviado a Reparto', order: 1 },
  ACTA_PENDING: { label: 'Acta Pendiente', order: 2 },
  ACTA_RECEIVED: { label: 'Acta Recibida', order: 3 },
  RADICADO_PENDING: { label: 'Radicado Pendiente', order: 4 },
  RADICADO_CONFIRMED: { label: 'Radicado Confirmado', order: 5 },
  PENDING_AUTO_ADMISORIO: { label: 'Pendiente Auto Admisorio', order: 6 },
} as const;

// CGP Process stages (after auto admisorio)
export const CGP_PROCESS_STAGES = {
  AUTO_ADMISORIO: { label: 'Auto Admisorio', order: 0 },
  NOTIFICACION_PERSONAL: { label: 'Notificación Personal', order: 1 },
  NOTIFICACION_AVISO: { label: 'Notificación por Aviso', order: 2 },
  EXCEPCIONES_PREVIAS: { label: 'Excepciones Previas', order: 3 },
  PRONUNCIARSE_EXCEPCIONES: { label: 'Pronunciarse Excepciones', order: 4 },
  AUDIENCIA_INICIAL: { label: 'Audiencia Inicial', order: 5 },
  AUDIENCIA_INSTRUCCION: { label: 'Audiencia Instrucción', order: 6 },
  ALEGATOS_SENTENCIA: { label: 'Alegatos y Sentencia', order: 7 },
  APELACION: { label: 'Apelación', order: 8 },
} as const;

export type CGPFilingStage = keyof typeof CGP_FILING_STAGES;
export type CGPProcessStage = keyof typeof CGP_PROCESS_STAGES;

// ============================================
// Petición Stages
// ============================================
export const PETICION_STAGES = {
  PETICION_RADICADA: { label: 'Petición Radicada', order: 0 },
  CONSTANCIA_RADICACION: { label: 'Constancia de Radicación', order: 1 },
  RESPUESTA: { label: 'Respuesta', order: 2 },
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
  NOTIFICACION_TRASLADOS: { label: 'Notificación', order: 4 },
  TRASLADO_DEMANDA: { label: 'Traslado Demanda', order: 5 },
  REFORMA_DEMANDA: { label: 'Reforma Demanda', order: 6 },
  TRASLADO_EXCEPCIONES: { label: 'Traslado Excepciones', order: 7 },
  AUDIENCIA_INICIAL: { label: 'Audiencia Inicial', order: 8 },
  AUDIENCIA_PRUEBAS: { label: 'Audiencia Pruebas', order: 9 },
  ALEGATOS_SENTENCIA: { label: 'Alegatos y Sentencia', order: 10 },
  RECURSOS: { label: 'Recursos', order: 11 },
  EJECUCION_CUMPLIMIENTO: { label: 'Ejecución / Cumplimiento', order: 12 },
  ARCHIVADO: { label: 'Archivado', order: 13 },
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
  return workflowType === 'CGP' || workflowType === 'CPACA' || workflowType === 'TUTELA' || workflowType === 'LABORAL';
}
