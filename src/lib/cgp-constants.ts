/**
 * CGP (Código General del Proceso) Constants
 * Based on Ley 1564 de 2012 - Colombian Civil Procedure Code
 * 
 * This is the SINGLE SOURCE OF TRUTH for CGP stages and process types.
 * 
 * PHASE DERIVATION RULE (NON-NEGOTIABLE):
 * - Stages 01-03 = RADICACIÓN (demanda sin auto admisorio)
 * - Stages 04-13 = PROCESO (asunto con vida procesal activa)
 */

// ============================================
// PROCESS TYPE CLASSIFICATION (CGP)
// ============================================

export type CGPClass = 'DECLARATIVO' | 'EJECUTIVO' | 'LIQUIDACION' | 'ESPECIAL';

export type CGPVariant =
  // Declarativos
  | 'DECLARATIVO_VERBAL'
  | 'DECLARATIVO_VERBAL_SUMARIO'
  | 'DECLARATIVO_ESPECIAL_EXPROPIACION'
  | 'DECLARATIVO_ESPECIAL_DESLINDE_AMOJONAMIENTO'
  | 'DECLARATIVO_ESPECIAL_DIVISORIO'
  | 'DECLARATIVO_ESPECIAL_MONITORIO'
  // Ejecutivos
  | 'EJECUTIVO_SINGULAR'
  | 'EJECUTIVO_HIPOTECARIO_PRENDARIO'
  // Liquidaciones
  | 'LIQUIDACION_SUCESION'
  | 'LIQUIDACION_SOCIEDAD_CONYUGAL'
  | 'LIQUIDACION_SOCIEDADES'
  | 'LIQUIDACION_INSOLVENCIA_PN_NO_COMERCIANTE'
  // Otros
  | 'NO_ESPECIFICADO';

export type CGPCuantia = 'MINIMA' | 'MENOR' | 'MAYOR' | 'INDETERMINADA';
export type CGPInstancia = 'UNICA' | 'DOBLE' | 'DESCONOCIDA';

export const CGP_CLASS_CONFIG: Record<CGPClass, { label: string; color: string }> = {
  DECLARATIVO: { label: 'Declarativo', color: 'emerald' },
  EJECUTIVO: { label: 'Ejecutivo', color: 'blue' },
  LIQUIDACION: { label: 'Liquidación', color: 'amber' },
  ESPECIAL: { label: 'Especial', color: 'purple' },
};

export const CGP_VARIANT_CONFIG: Record<CGPVariant, { label: string; class: CGPClass }> = {
  DECLARATIVO_VERBAL: { label: 'Verbal (ordinario)', class: 'DECLARATIVO' },
  DECLARATIVO_VERBAL_SUMARIO: { label: 'Verbal sumario', class: 'DECLARATIVO' },
  DECLARATIVO_ESPECIAL_EXPROPIACION: { label: 'Expropiación', class: 'DECLARATIVO' },
  DECLARATIVO_ESPECIAL_DESLINDE_AMOJONAMIENTO: { label: 'Deslinde y amojonamiento', class: 'DECLARATIVO' },
  DECLARATIVO_ESPECIAL_DIVISORIO: { label: 'Divisorio', class: 'DECLARATIVO' },
  DECLARATIVO_ESPECIAL_MONITORIO: { label: 'Monitorio', class: 'DECLARATIVO' },
  EJECUTIVO_SINGULAR: { label: 'Ejecutivo singular', class: 'EJECUTIVO' },
  EJECUTIVO_HIPOTECARIO_PRENDARIO: { label: 'Ejecutivo hipotecario/prendario', class: 'EJECUTIVO' },
  LIQUIDACION_SUCESION: { label: 'Sucesión', class: 'LIQUIDACION' },
  LIQUIDACION_SOCIEDAD_CONYUGAL: { label: 'Sociedad conyugal', class: 'LIQUIDACION' },
  LIQUIDACION_SOCIEDADES: { label: 'Liquidación de sociedades', class: 'LIQUIDACION' },
  LIQUIDACION_INSOLVENCIA_PN_NO_COMERCIANTE: { label: 'Insolvencia P.N. no comerciante', class: 'LIQUIDACION' },
  NO_ESPECIFICADO: { label: 'No especificado', class: 'DECLARATIVO' },
};

export const CGP_CUANTIA_CONFIG: Record<CGPCuantia, { label: string; description: string }> = {
  MINIMA: { label: 'Mínima', description: 'Hasta 40 SMLMV - Única instancia, pequeñas causas' },
  MENOR: { label: 'Menor', description: '40-150 SMLMV - Doble instancia' },
  MAYOR: { label: 'Mayor', description: 'Más de 150 SMLMV - Doble instancia' },
  INDETERMINADA: { label: 'Indeterminada', description: 'Cuantía no determinable' },
};

// ============================================
// CGP STAGES (13 columnas - Ley 1564 de 2012)
// ============================================

export type CGPPhase = 'RADICACION' | 'PROCESO';

export interface CGPStageConfig {
  key: string;
  order: number;
  label: string;
  shortLabel: string;
  phase: CGPPhase;
  color: string;
  description: string;
  isTerminal: boolean;
  // Notification sub-status only for stage 06
  allowedSubstatus?: string[];
}

/**
 * CGP_STAGES: The 13 canonical stages for CGP Kanban
 * 
 * PHASE RULE:
 * - order 1-3 → RADICACIÓN
 * - order 4-13 → PROCESO
 */
export const CGP_STAGES: Record<string, CGPStageConfig> = {
  // ===== FASE RADICACIÓN (etapas 1-3) =====
  DEMANDA_PREPARACION: {
    key: 'DEMANDA_PREPARACION',
    order: 1,
    label: 'Demanda en preparación',
    shortLabel: 'Preparación',
    phase: 'RADICACION',
    color: 'slate',
    description: 'Demanda creada o importada, pendiente de radicación final',
    isTerminal: false,
  },
  RADICACION_CONFIRMADA: {
    key: 'RADICACION_CONFIRMADA',
    order: 2,
    label: 'Radicación confirmada',
    shortLabel: 'Radicado',
    phase: 'RADICACION',
    color: 'amber',
    description: 'Radicado de 23 dígitos confirmado, pendiente de admisión',
    isTerminal: false,
  },
  INADMISION_SUBSANACION: {
    key: 'INADMISION_SUBSANACION',
    order: 3,
    label: 'Inadmisión / Subsanación',
    shortLabel: 'Subsanación',
    phase: 'RADICACION',
    color: 'rose',
    description: 'Demanda inadmitida o con requerimiento de subsanación',
    isTerminal: false,
  },

  // ===== FASE PROCESO (etapas 4-13) =====
  AUTO_ADMISORIO: {
    key: 'AUTO_ADMISORIO',
    order: 4,
    label: 'Auto admisorio / Mandamiento',
    shortLabel: 'Admisión',
    phase: 'PROCESO',
    color: 'emerald',
    description: 'Auto admisorio (declarativo), mandamiento de pago (ejecutivo), o requerimiento (monitorio)',
    isTerminal: false,
  },
  MEDIDAS_CAUTELARES: {
    key: 'MEDIDAS_CAUTELARES',
    order: 5,
    label: 'Medidas cautelares',
    shortLabel: 'Cautelares',
    phase: 'PROCESO',
    color: 'teal',
    description: 'Embargo, secuestro, medidas previas o cautelares decretadas',
    isTerminal: false,
  },
  NOTIFICACION: {
    key: 'NOTIFICACION',
    order: 6,
    label: 'Notificación demandado',
    shortLabel: 'Notificación',
    phase: 'PROCESO',
    color: 'sky',
    description: 'Gestión de notificación: personal, aviso o emplazamiento',
    isTerminal: false,
    allowedSubstatus: ['PERSONAL', 'AVISO', 'EMPLAZAMIENTO', 'PENDIENTE'],
  },
  CONTESTACION_EXCEPCIONES: {
    key: 'CONTESTACION_EXCEPCIONES',
    order: 7,
    label: 'Contestación / Excepciones',
    shortLabel: 'Contestación',
    phase: 'PROCESO',
    color: 'cyan',
    description: 'Contestación de demanda, excepciones de mérito u oposición',
    isTerminal: false,
  },
  EXCEPCIONES_SANEAMIENTO: {
    key: 'EXCEPCIONES_SANEAMIENTO',
    order: 8,
    label: 'Excepciones previas / Saneamiento',
    shortLabel: 'Saneamiento',
    phase: 'PROCESO',
    color: 'blue',
    description: 'Excepciones previas, saneamiento procesal, fijación del litigio',
    isTerminal: false,
  },
  AUDIENCIA_INICIAL: {
    key: 'AUDIENCIA_INICIAL',
    order: 9,
    label: 'Audiencia inicial',
    shortLabel: 'Aud. Inicial',
    phase: 'PROCESO',
    color: 'indigo',
    description: 'Audiencia inicial, conciliación, decisiones preliminares',
    isTerminal: false,
  },
  INSTRUCCION_PRUEBAS: {
    key: 'INSTRUCCION_PRUEBAS',
    order: 10,
    label: 'Instrucción / Pruebas',
    shortLabel: 'Instrucción',
    phase: 'PROCESO',
    color: 'violet',
    description: 'Práctica de pruebas, audiencia de instrucción y juzgamiento',
    isTerminal: false,
  },
  SENTENCIA: {
    key: 'SENTENCIA',
    order: 11,
    label: 'Sentencia / Decisión',
    shortLabel: 'Sentencia',
    phase: 'PROCESO',
    color: 'purple',
    description: 'Proferimiento del fallo o decisión de fondo',
    isTerminal: false,
  },
  RECURSOS: {
    key: 'RECURSOS',
    order: 12,
    label: 'Recursos / Segunda instancia',
    shortLabel: 'Recursos',
    phase: 'PROCESO',
    color: 'fuchsia',
    description: 'Apelación, reposición, nulidades, segunda instancia',
    isTerminal: false,
  },
  EJECUCION_ARCHIVO: {
    key: 'EJECUCION_ARCHIVO',
    order: 13,
    label: 'Ejecución / Archivo',
    shortLabel: 'Archivo',
    phase: 'PROCESO',
    color: 'stone',
    description: 'Cumplimiento, pago, remate, liquidación final o cierre',
    isTerminal: true,
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

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
  return getOrderedCGPStages().filter(s => s.phase === phase);
}

/**
 * DETERMINISTIC PHASE DERIVATION
 * This is the CANONICAL function - never set phase independently
 * 
 * Rule: stages 1-3 = RADICACION, stages 4-13 = PROCESO
 */
export function derivePhaseFromStage(stageKey: string): CGPPhase {
  const stage = CGP_STAGES[stageKey];
  if (!stage) {
    console.warn(`Unknown CGP stage: ${stageKey}, defaulting to RADICACION`);
    return 'RADICACION';
  }
  return stage.order <= 3 ? 'RADICACION' : 'PROCESO';
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
 * Check if moving between stages changes phase
 */
export function wouldChangePhase(fromStage: string, toStage: string): boolean {
  return derivePhaseFromStage(fromStage) !== derivePhaseFromStage(toStage);
}

/**
 * Get variants grouped by class
 */
export function getVariantsByClass(): Record<CGPClass, { key: CGPVariant; label: string }[]> {
  const result: Record<CGPClass, { key: CGPVariant; label: string }[]> = {
    DECLARATIVO: [],
    EJECUTIVO: [],
    LIQUIDACION: [],
    ESPECIAL: [],
  };

  Object.entries(CGP_VARIANT_CONFIG).forEach(([key, config]) => {
    result[config.class].push({ key: key as CGPVariant, label: config.label });
  });

  return result;
}

// ============================================
// DEADLINE RULES (defaults, configurable)
// ============================================

export interface CGPDeadlineRule {
  id: string;
  variant: CGPVariant | '*';  // * means applies to all
  triggerEvent: string;
  deadlineDays: number;
  deadlineType: 'HABILES' | 'CALENDARIO';
  description: string;
  isDefault: boolean;
}

/**
 * Default deadline rules based on CGP
 * These can be overridden by user configuration
 */
export const CGP_DEFAULT_DEADLINE_RULES: CGPDeadlineRule[] = [
  // Contestación demanda
  {
    id: 'CONTESTACION_VERBAL',
    variant: 'DECLARATIVO_VERBAL',
    triggerEvent: 'NOTIFICACION_EFECTIVA',
    deadlineDays: 20,
    deadlineType: 'HABILES',
    description: 'Contestación demanda verbal ordinario',
    isDefault: true,
  },
  {
    id: 'CONTESTACION_VERBAL_SUMARIO',
    variant: 'DECLARATIVO_VERBAL_SUMARIO',
    triggerEvent: 'NOTIFICACION_EFECTIVA',
    deadlineDays: 10,
    deadlineType: 'HABILES',
    description: 'Contestación demanda verbal sumario',
    isDefault: true,
  },
  {
    id: 'EXCEPCIONES_EJECUTIVO',
    variant: 'EJECUTIVO_SINGULAR',
    triggerEvent: 'NOTIFICACION_MANDAMIENTO',
    deadlineDays: 10,
    deadlineType: 'HABILES',
    description: 'Excepciones ejecutivo singular',
    isDefault: true,
  },
  {
    id: 'PAGO_EJECUTIVO',
    variant: 'EJECUTIVO_SINGULAR',
    triggerEvent: 'NOTIFICACION_MANDAMIENTO',
    deadlineDays: 5,
    deadlineType: 'HABILES',
    description: 'Pago ejecutivo (evitar costas)',
    isDefault: true,
  },
  {
    id: 'OPOSICION_MONITORIO',
    variant: 'DECLARATIVO_ESPECIAL_MONITORIO',
    triggerEvent: 'NOTIFICACION_REQUERIMIENTO',
    deadlineDays: 10,
    deadlineType: 'HABILES',
    description: 'Oposición proceso monitorio',
    isDefault: true,
  },
  // Generic fallback
  {
    id: 'CONTESTACION_GENERICA',
    variant: '*',
    triggerEvent: 'NOTIFICACION_EFECTIVA',
    deadlineDays: 20,
    deadlineType: 'HABILES',
    description: 'Contestación demanda (genérico)',
    isDefault: true,
  },
];

/**
 * Notification substatus for stage 06
 */
export const NOTIFICATION_SUBSTATUS = {
  PENDIENTE: { label: 'Pendiente', color: 'slate' },
  PERSONAL: { label: 'Personal', color: 'emerald' },
  AVISO: { label: 'Por aviso', color: 'amber' },
  EMPLAZAMIENTO: { label: 'Emplazamiento', color: 'rose' },
} as const;

export type NotificationSubstatus = keyof typeof NOTIFICATION_SUBSTATUS;
