/**
 * CGP (Código General del Proceso) Constants
 * 
 * This file re-exports from cgp-stages.ts for backwards compatibility
 * and adds additional configuration for process types, cuantía, etc.
 */

// Re-export all stage-related items from the canonical source
export {
  CGP_STAGES,
  getOrderedCGPStages,
  getStagesForPhase,
  derivePhaseFromStage,
  getStageConfig,
  getStageLabel,
  getStageShortLabel,
  getStageOrder,
  getStageKeys,
  mapLegacyStage,
  wouldChangePhase,
  type CGPPhase,
  type CGPStageConfig,
} from './cgp-stages';

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
 * Notification substatus for stage NOTIFICACION
 */
export const NOTIFICATION_SUBSTATUS = {
  PENDIENTE: { label: 'Pendiente', color: 'slate' },
  PERSONAL: { label: 'Personal', color: 'emerald' },
  AVISO: { label: 'Por aviso', color: 'amber' },
  EMPLAZAMIENTO: { label: 'Emplazamiento', color: 'rose' },
} as const;

export type NotificationSubstatus = keyof typeof NOTIFICATION_SUBSTATUS;

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
