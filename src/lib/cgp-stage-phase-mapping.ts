/**
 * CGP Stage-to-Phase Mapping
 * 
 * Defines the deterministic relationship between Kanban stages and CGP phases.
 * This is the SINGLE SOURCE OF TRUTH for phase derivation.
 * 
 * Rule: 
 * - Stages 1-3 (filing stages) = FILING phase
 * - Stages 4+ (process stages) = PROCESS phase
 */

// All CGP stages in order (combined filing + process for unified kanban)
export const CGP_UNIFIED_STAGES = {
  // Filing stages (1-7) → phase = FILING
  DRAFTED: { order: 0, label: 'Borrador', shortLabel: 'Borrador', phase: 'FILING' as const, color: 'slate' },
  SENT_TO_REPARTO: { order: 1, label: 'Enviado a Reparto', shortLabel: 'Enviado', phase: 'FILING' as const, color: 'amber' },
  ACTA_PENDING: { order: 2, label: 'Acta Pendiente', shortLabel: 'Acta Pend.', phase: 'FILING' as const, color: 'amber' },
  ACTA_RECEIVED: { order: 3, label: 'Acta Recibida', shortLabel: 'Acta Rec.', phase: 'FILING' as const, color: 'sky' },
  RADICADO_PENDING: { order: 4, label: 'Radicado Pendiente', shortLabel: 'Rad. Pend.', phase: 'FILING' as const, color: 'sky' },
  RADICADO_CONFIRMED: { order: 5, label: 'Radicado Confirmado', shortLabel: 'Radicado', phase: 'FILING' as const, color: 'indigo' },
  PENDING_AUTO_ADMISORIO: { order: 6, label: 'Pendiente Auto Admisorio', shortLabel: 'Pend. Auto', phase: 'FILING' as const, color: 'indigo' },
  
  // Process stages (8+) → phase = PROCESS
  AUTO_ADMISORIO: { order: 7, label: 'Auto Admisorio', shortLabel: 'Auto Adm.', phase: 'PROCESS' as const, color: 'emerald' },
  NOTIFICACION_PERSONAL: { order: 8, label: 'Notificación Personal', shortLabel: 'Not. Personal', phase: 'PROCESS' as const, color: 'emerald' },
  NOTIFICACION_AVISO: { order: 9, label: 'Notificación por Aviso', shortLabel: 'Aviso/Emplaz.', phase: 'PROCESS' as const, color: 'teal' },
  EXCEPCIONES_PREVIAS: { order: 10, label: 'Excepciones Previas', shortLabel: 'Exc. Previas', phase: 'PROCESS' as const, color: 'teal' },
  PRONUNCIARSE_EXCEPCIONES: { order: 11, label: 'Pronunciarse Excepciones', shortLabel: 'Pron. Exc.', phase: 'PROCESS' as const, color: 'cyan' },
  AUDIENCIA_INICIAL: { order: 12, label: 'Audiencia Inicial', shortLabel: 'Aud. Inicial', phase: 'PROCESS' as const, color: 'cyan' },
  AUDIENCIA_INSTRUCCION: { order: 13, label: 'Audiencia Instrucción', shortLabel: 'Aud. Instruc.', phase: 'PROCESS' as const, color: 'blue' },
  ALEGATOS_SENTENCIA: { order: 14, label: 'Alegatos y Sentencia', shortLabel: 'Alegatos', phase: 'PROCESS' as const, color: 'blue' },
  APELACION: { order: 15, label: 'Apelación', shortLabel: 'Apelación', phase: 'PROCESS' as const, color: 'violet' },
} as const;

export type CGPUnifiedStage = keyof typeof CGP_UNIFIED_STAGES;
export type CGPPhase = 'FILING' | 'PROCESS';

// Stage order threshold - stages with order < 7 are FILING, >= 7 are PROCESS
const PROCESS_PHASE_THRESHOLD = 7;

/**
 * Derive phase deterministically from stage
 * THIS IS THE CANONICAL FUNCTION - always use this, never set phase manually
 */
export function derivePhaseFromStage(stage: string): CGPPhase {
  const stageConfig = CGP_UNIFIED_STAGES[stage as CGPUnifiedStage];
  if (!stageConfig) {
    // Unknown stage - default to FILING for safety
    console.warn(`Unknown CGP stage: ${stage}, defaulting to FILING`);
    return 'FILING';
  }
  return stageConfig.phase;
}

/**
 * Get the order number for a stage
 */
export function getStageOrder(stage: string): number {
  const stageConfig = CGP_UNIFIED_STAGES[stage as CGPUnifiedStage];
  return stageConfig?.order ?? 0;
}

/**
 * Get ordered array of stages for unified CGP kanban
 */
export function getOrderedCGPStages(): CGPUnifiedStage[] {
  return Object.entries(CGP_UNIFIED_STAGES)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key]) => key as CGPUnifiedStage);
}

/**
 * Get stages for a specific phase
 */
export function getStagesForPhase(phase: CGPPhase): CGPUnifiedStage[] {
  return Object.entries(CGP_UNIFIED_STAGES)
    .filter(([, config]) => config.phase === phase)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key]) => key as CGPUnifiedStage);
}

/**
 * Get stage label
 */
export function getStageLabel(stage: string): string {
  const stageConfig = CGP_UNIFIED_STAGES[stage as CGPUnifiedStage];
  return stageConfig?.label ?? stage;
}

/**
 * Get stage short label
 */
export function getStageShortLabel(stage: string): string {
  const stageConfig = CGP_UNIFIED_STAGES[stage as CGPUnifiedStage];
  return stageConfig?.shortLabel ?? stage;
}

/**
 * Check if a stage transition is valid
 */
export function isValidStageTransition(fromStage: string, toStage: string): boolean {
  const fromConfig = CGP_UNIFIED_STAGES[fromStage as CGPUnifiedStage];
  const toConfig = CGP_UNIFIED_STAGES[toStage as CGPUnifiedStage];
  
  if (!fromConfig || !toConfig) return false;
  
  // Allow any transition for now (can be restricted later if needed)
  return true;
}

/**
 * Check if moving to a stage would trigger phase change
 */
export function wouldChangePhase(fromStage: string, toStage: string): boolean {
  const fromPhase = derivePhaseFromStage(fromStage);
  const toPhase = derivePhaseFromStage(toStage);
  return fromPhase !== toPhase;
}

/**
 * Merged stages for kanban display (to reduce columns)
 * Returns array of stage groups with display info
 */
export interface MergedStageConfig {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  phase: CGPPhase;
  stages: CGPUnifiedStage[];
  order: number;
}

export function getMergedKanbanStages(): MergedStageConfig[] {
  return [
    // Filing stages - merged for cleaner display
    {
      id: 'filing:SENT_TO_REPARTO,ACTA_PENDING',
      label: 'Enviado / Acta Pendiente',
      shortLabel: 'Enviado/Acta',
      color: 'amber',
      phase: 'FILING',
      stages: ['SENT_TO_REPARTO', 'ACTA_PENDING'],
      order: 1,
    },
    {
      id: 'filing:ACTA_RECEIVED,RADICADO_PENDING',
      label: 'Acta Recibida / Radicado Pend.',
      shortLabel: 'Acta/Rad.',
      color: 'sky',
      phase: 'FILING',
      stages: ['ACTA_RECEIVED', 'RADICADO_PENDING'],
      order: 2,
    },
    {
      id: 'filing:RADICADO_CONFIRMED,PENDING_AUTO_ADMISORIO',
      label: 'Radicado / Pend. Auto',
      shortLabel: 'Rad./Auto',
      color: 'indigo',
      phase: 'FILING',
      stages: ['RADICADO_CONFIRMED', 'PENDING_AUTO_ADMISORIO'],
      order: 3,
    },
    // Process stages - threshold crossing
    {
      id: 'process:AUTO_ADMISORIO',
      label: 'Auto Admisorio',
      shortLabel: 'Auto Adm.',
      color: 'emerald',
      phase: 'PROCESS',
      stages: ['AUTO_ADMISORIO'],
      order: 4,
    },
    {
      id: 'process:NOTIFICACION_PERSONAL,NOTIFICACION_AVISO',
      label: 'Notificación',
      shortLabel: 'Notificación',
      color: 'emerald',
      phase: 'PROCESS',
      stages: ['NOTIFICACION_PERSONAL', 'NOTIFICACION_AVISO'],
      order: 5,
    },
    {
      id: 'process:EXCEPCIONES_PREVIAS,PRONUNCIARSE_EXCEPCIONES',
      label: 'Excepciones',
      shortLabel: 'Excepciones',
      color: 'teal',
      phase: 'PROCESS',
      stages: ['EXCEPCIONES_PREVIAS', 'PRONUNCIARSE_EXCEPCIONES'],
      order: 6,
    },
    {
      id: 'process:AUDIENCIA_INICIAL',
      label: 'Audiencia Inicial',
      shortLabel: 'Aud. Inicial',
      color: 'cyan',
      phase: 'PROCESS',
      stages: ['AUDIENCIA_INICIAL'],
      order: 7,
    },
    {
      id: 'process:AUDIENCIA_INSTRUCCION',
      label: 'Audiencia Instrucción',
      shortLabel: 'Aud. Instruc.',
      color: 'blue',
      phase: 'PROCESS',
      stages: ['AUDIENCIA_INSTRUCCION'],
      order: 8,
    },
    {
      id: 'process:ALEGATOS_SENTENCIA',
      label: 'Alegatos y Sentencia',
      shortLabel: 'Alegatos',
      color: 'blue',
      phase: 'PROCESS',
      stages: ['ALEGATOS_SENTENCIA'],
      order: 9,
    },
    {
      id: 'process:APELACION',
      label: 'Apelación',
      shortLabel: 'Apelación',
      color: 'violet',
      phase: 'PROCESS',
      stages: ['APELACION'],
      order: 10,
    },
  ];
}

/**
 * Find which merged column a stage belongs to
 */
export function findMergedColumnForStage(stage: string): MergedStageConfig | null {
  const mergedStages = getMergedKanbanStages();
  return mergedStages.find(col => col.stages.includes(stage as CGPUnifiedStage)) || null;
}

/**
 * Get the first stage of a merged column (for drops)
 */
export function getFirstStageOfMergedColumn(mergedColumnId: string): CGPUnifiedStage | null {
  const mergedStages = getMergedKanbanStages();
  const column = mergedStages.find(col => col.id === mergedColumnId);
  return column?.stages[0] || null;
}
