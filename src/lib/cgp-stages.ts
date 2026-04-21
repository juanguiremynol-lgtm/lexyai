/**
 * CGP Stages - Canonical stage definitions for CGP Kanban
 * 
 * Based on user's actual Dashboard showing 12 stages:
 * RADICACIÓN: Preparación, Radicado, Subsanación (3 stages)
 * PROCESO: Admisión, Cuaderno, Notificación, Contestación, Saneamiento, 
 *          Aud. Inicial, Intervención, Sentencia, Recurso (9 stages)
 * 
 * PHASE DERIVATION RULE:
 * - Stages 1-3 (order <= 3) → RADICACIÓN
 * - Stages 4-12 (order >= 4) → PROCESO
 *
 * @see CGP_FILING_STAGES / CGP_PROCESS_STAGES (workflow-constants.ts) for the
 * granular inference vocabulary that maps into these buckets via
 * `mapInferenceStageToDashboard()` below.
 * Do NOT add keys here that are not Dashboard-visible columns.
 * See `src/lib/__tests__/cgpStageDrift.test.ts` for the drift guard.
 */

export type CGPPhase = 'RADICACION' | 'PROCESO';

export interface CGPStageConfig {
  key: string;
  order: number;
  label: string;
  shortLabel: string;
  phase: CGPPhase;
  color: string;
  description: string;
}

/**
 * The 12 canonical CGP stages matching the Dashboard
 * 
 * RADICACIÓN (pre-admisión):
 * 1. Preparación - Demanda en preparación
 * 2. Radicado - Radicación confirmada  
 * 3. Subsanación - Inadmisión/subsanación
 * 
 * PROCESO (post-admisión):
 * 4. Admisión - Auto admisorio
 * 5. Cuaderno - Medidas cautelares / cuadernos
 * 6. Notificación - Notificación al demandado
 * 7. Contestación - Contestación / excepciones
 * 8. Saneamiento - Saneamiento / fijación litigio
 * 9. Aud. Inicial - Audiencia inicial
 * 10. Intervención - Instrucción / pruebas
 * 11. Sentencia - Sentencia / decisión
 * 12. Recurso - Recursos / segunda instancia
 */
export const CGP_STAGES: Record<string, CGPStageConfig> = {
  // ===== RADICACIÓN (stages 1-3) =====
  PREPARACION: {
    key: 'PREPARACION',
    order: 1,
    label: 'Demanda en preparación',
    shortLabel: 'Preparación',
    phase: 'RADICACION',
    color: 'slate',
    description: 'Demanda creada o importada, pendiente de radicación',
  },
  RADICADO: {
    key: 'RADICADO',
    order: 2,
    label: 'Radicación confirmada',
    shortLabel: 'Radicado',
    phase: 'RADICACION',
    color: 'amber',
    description: 'Radicado 23 dígitos confirmado, pendiente admisión',
  },
  SUBSANACION: {
    key: 'SUBSANACION',
    order: 3,
    label: 'Inadmisión / Subsanación',
    shortLabel: 'Subsanación',
    phase: 'RADICACION',
    color: 'rose',
    description: 'Demanda inadmitida o con requerimiento de subsanación',
  },

  // ===== PROCESO (stages 4-12) =====
  ADMISION: {
    key: 'ADMISION',
    order: 4,
    label: 'Auto admisorio / Mandamiento',
    shortLabel: 'Admisión',
    phase: 'PROCESO',
    color: 'emerald',
    description: 'Auto admisorio, mandamiento de pago o requerimiento',
  },
  CUADERNO: {
    key: 'CUADERNO',
    order: 5,
    label: 'Medidas cautelares / Cuadernos',
    shortLabel: 'Cuaderno',
    phase: 'PROCESO',
    color: 'teal',
    description: 'Embargo, secuestro, medidas cautelares decretadas',
  },
  NOTIFICACION: {
    key: 'NOTIFICACION',
    order: 6,
    label: 'Notificación al demandado',
    shortLabel: 'Notificación',
    phase: 'PROCESO',
    color: 'sky',
    description: 'Gestión de notificación: personal, aviso o emplazamiento',
  },
  CONTESTACION: {
    key: 'CONTESTACION',
    order: 7,
    label: 'Contestación / Excepciones',
    shortLabel: 'Contestación',
    phase: 'PROCESO',
    color: 'cyan',
    description: 'Contestación de demanda, excepciones de mérito u oposición',
  },
  SANEAMIENTO: {
    key: 'SANEAMIENTO',
    order: 8,
    label: 'Saneamiento / Fijación litigio',
    shortLabel: 'Saneamiento',
    phase: 'PROCESO',
    color: 'blue',
    description: 'Excepciones previas, saneamiento, fijación del litigio',
  },
  AUDIENCIA_INICIAL: {
    key: 'AUDIENCIA_INICIAL',
    order: 9,
    label: 'Audiencia inicial',
    shortLabel: 'Aud. Inicial',
    phase: 'PROCESO',
    color: 'indigo',
    description: 'Audiencia inicial, conciliación, decisiones preliminares',
  },
  INTERVENCION: {
    key: 'INTERVENCION',
    order: 10,
    label: 'Instrucción / Pruebas',
    shortLabel: 'Intervención',
    phase: 'PROCESO',
    color: 'violet',
    description: 'Práctica de pruebas, audiencia de instrucción',
  },
  SENTENCIA: {
    key: 'SENTENCIA',
    order: 11,
    label: 'Sentencia / Decisión',
    shortLabel: 'Sentencia',
    phase: 'PROCESO',
    color: 'purple',
    description: 'Proferimiento del fallo o decisión de fondo',
  },
  RECURSO: {
    key: 'RECURSO',
    order: 12,
    label: 'Recursos / Segunda instancia',
    shortLabel: 'Recurso',
    phase: 'PROCESO',
    color: 'fuchsia',
    description: 'Apelación, reposición, nulidades, segunda instancia',
  },
};

/**
 * Get all stages as an ordered array
 */
export function getOrderedCGPStages(): CGPStageConfig[] {
  return Object.values(CGP_STAGES).sort((a, b) => a.order - b.order);
}

/**
 * Get stages for a specific phase
 */
export function getStagesForPhase(phase: CGPPhase): CGPStageConfig[] {
  return getOrderedCGPStages().filter((s) => s.phase === phase);
}

/**
 * DETERMINISTIC PHASE DERIVATION
 * 
 * This is the CANONICAL function for determining phase from stage.
 * Rule: stages 1-3 = RADICACION, stages 4-12 = PROCESO
 * 
 * The boundary is between Subsanación (3) and Admisión (4)
 */
export function derivePhaseFromStage(stageKey: string): CGPPhase {
  const stage = CGP_STAGES[stageKey];
  
  // If unknown stage, try legacy mapping or default to RADICACION
  if (!stage) {
    // Handle legacy stage names from old constants
    const legacyMapping: Record<string, CGPPhase> = {
      'DEMANDA_PREPARACION': 'RADICACION',
      'RADICACION_CONFIRMADA': 'RADICACION', 
      'INADMISION_SUBSANACION': 'RADICACION',
      'AUTO_ADMISORIO': 'PROCESO',
      'MEDIDAS_CAUTELARES': 'PROCESO',
      'CONTESTACION_EXCEPCIONES': 'PROCESO',
      'EXCEPCIONES_SANEAMIENTO': 'PROCESO',
      'AUDIENCIA_INICIAL': 'PROCESO',
      'INSTRUCCION_PRUEBAS': 'PROCESO',
      'RECURSOS': 'PROCESO',
      'EJECUCION_ARCHIVO': 'PROCESO',
    };
    
    if (legacyMapping[stageKey]) {
      return legacyMapping[stageKey];
    }
    
    console.warn(`Unknown CGP stage: ${stageKey}, defaulting to RADICACION`);
    return 'RADICACION';
  }
  
  // Deterministic rule: order 1-3 = RADICACION, 4+ = PROCESO
  return stage.order <= 3 ? 'RADICACION' : 'PROCESO';
}

/**
 * Check if moving between stages would change the phase
 */
export function wouldChangePhase(fromStage: string, toStage: string): boolean {
  return derivePhaseFromStage(fromStage) !== derivePhaseFromStage(toStage);
}

/**
 * Get stage config by key
 */
export function getStageConfig(stageKey: string): CGPStageConfig | null {
  return CGP_STAGES[stageKey] || null;
}

/**
 * Get stage label
 */
export function getStageLabel(stageKey: string): string {
  return CGP_STAGES[stageKey]?.label || stageKey;
}

/**
 * Get stage short label
 */
export function getStageShortLabel(stageKey: string): string {
  return CGP_STAGES[stageKey]?.shortLabel || stageKey;
}

/**
 * Get stage order number
 */
export function getStageOrder(stageKey: string): number {
  return CGP_STAGES[stageKey]?.order ?? 0;
}

/**
 * Get all stage keys in order
 */
export function getStageKeys(): string[] {
  return getOrderedCGPStages().map((s) => s.key);
}

/**
 * Map legacy stage to new stage key
 * Used for migration/compatibility
 */
export function mapLegacyStage(legacyStage: string): string {
  const mapping: Record<string, string> = {
    // From 13-stage constants to 12-stage
    'DEMANDA_PREPARACION': 'PREPARACION',
    'RADICACION_CONFIRMADA': 'RADICADO',
    'INADMISION_SUBSANACION': 'SUBSANACION',
    'AUTO_ADMISORIO': 'ADMISION',
    'MEDIDAS_CAUTELARES': 'CUADERNO',
    'NOTIFICACION': 'NOTIFICACION',
    'CONTESTACION_EXCEPCIONES': 'CONTESTACION',
    'EXCEPCIONES_SANEAMIENTO': 'SANEAMIENTO',
    'AUDIENCIA_INICIAL': 'AUDIENCIA_INICIAL',
    'INSTRUCCION_PRUEBAS': 'INTERVENCION',
    'SENTENCIA': 'SENTENCIA',
    'RECURSOS': 'RECURSO',
    'EJECUCION_ARCHIVO': 'RECURSO', // Archive maps to last stage
  };
  
  const mapped = mapping[legacyStage] || legacyStage;
  
  // Ensure the result is a valid CGP stage key — fallback to PREPARACION
  // to prevent items from "oscillating" when their stage doesn't match any column
  if (!CGP_STAGES[mapped]) {
    console.warn(`[CGP] Unknown stage "${legacyStage}" (mapped: "${mapped}"), defaulting to PREPARACION`);
    return 'PREPARACION';
  }
  
  return mapped;
}
