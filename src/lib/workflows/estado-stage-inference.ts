/**
 * Estado → Stage Inference Engine
 * 
 * Deterministic mapping from ICARUS Estados content to work_item stages.
 * Supports CGP, CPACA, and TUTELA workflows.
 * 
 * RULES:
 * - Never automatically regress a work_item to an earlier stage
 * - Only auto-advance if confidence is HIGH
 * - Always record inference result for audit trail
 */

import {
  CGP_FILING_STAGES,
  CGP_PROCESS_STAGES,
  CPACA_STAGES,
  TUTELA_STAGES,
  type WorkflowType,
  type CGPPhase,
} from '@/lib/workflow-constants';

export type StageConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type EstadoCategory = 
  | 'RADICACION'
  | 'ADMISSION'
  | 'INADMISSION'
  | 'REQUIREMENT'
  | 'TRANSFER'
  | 'HEARING'
  | 'RULING'
  | 'APPEAL'
  | 'ENFORCEMENT'
  | 'EMBARGO'
  | 'NOTIFICATION'
  | 'ARCHIVE'
  | 'OTHER';

export interface StageInferenceResult {
  suggestedStage: string | null;
  suggestedCgpPhase: CGPPhase | null;
  confidence: StageConfidence;
  category: EstadoCategory;
  reasoning: string;
  matchedPattern: string | null;
  triggersMilestone: boolean;
  milestoneType: string | null;
}

export interface StageInferenceInput {
  workflowType: WorkflowType;
  currentStage: string | null;
  currentCgpPhase: CGPPhase | null;
  actuacion: string;
  anotacion?: string;
  iniciaTermino?: string | null;
  despacho?: string;
}

// ============================================
// Pattern Definitions (Ordered by Priority)
// ============================================

interface PatternRule {
  patterns: string[];
  category: EstadoCategory;
  cgpStage?: string;
  cgpPhase?: CGPPhase;
  cpacaStage?: string;
  tutelaStage?: string;
  confidence: StageConfidence;
  milestoneType?: string;
  triggersMilestone?: boolean;
}

/**
 * Pattern rules ordered by priority (first match wins)
 * More specific patterns should come before generic ones
 */
const PATTERN_RULES: PatternRule[] = [
  // ============= RADICACION =============
  {
    patterns: ['radicación de proceso', 'radicacion de proceso', 'radicacion demanda'],
    category: 'RADICACION',
    cgpStage: 'RADICADO_CONFIRMED',
    cgpPhase: 'FILING',
    cpacaStage: 'DEMANDA_RADICADA',
    tutelaStage: 'TUTELA_RADICADA',
    confidence: 'HIGH',
    milestoneType: 'RADICACION',
    triggersMilestone: true,
  },

  // ============= AUTO ADMISORIO (CRITICAL) =============
  {
    patterns: [
      'auto admisorio',
      'auto que admite la demanda',
      'admite demanda',
      'admite la demanda',
      'admítese demanda',
      'admitese la demanda',
      'auto admite demanda',
      'se admite la demanda',
    ],
    category: 'ADMISSION',
    cgpStage: 'AUTO_ADMISORIO',
    cgpPhase: 'PROCESS',
    cpacaStage: 'AUTO_ADMISORIO',
    tutelaStage: 'TUTELA_ADMITIDA',
    confidence: 'HIGH',
    milestoneType: 'AUTO_ADMISORIO',
    triggersMilestone: true,
  },
  {
    patterns: ['auto admite', 'se admite'],
    category: 'ADMISSION',
    cgpStage: 'AUTO_ADMISORIO',
    cgpPhase: 'PROCESS',
    cpacaStage: 'AUTO_ADMISORIO',
    tutelaStage: 'TUTELA_ADMITIDA',
    confidence: 'MEDIUM',
    milestoneType: 'AUTO_ADMISORIO',
    triggersMilestone: true,
  },

  // ============= INADMISION / RECHAZO =============
  {
    patterns: [
      'auto inadmisorio',
      'inadmite la demanda',
      'inadmite demanda',
      'auto que inadmite',
      'se inadmite',
    ],
    category: 'INADMISSION',
    cgpStage: 'PENDING_AUTO_ADMISORIO',
    cgpPhase: 'FILING',
    cpacaStage: 'DEMANDA_RADICADA',
    tutelaStage: 'TUTELA_RADICADA',
    confidence: 'HIGH',
    milestoneType: 'INADMISION',
    triggersMilestone: true,
  },
  {
    patterns: ['rechaza la demanda', 'rechaza demanda', 'auto de rechazo'],
    category: 'INADMISSION',
    cgpStage: 'PENDING_AUTO_ADMISORIO',
    cgpPhase: 'FILING',
    cpacaStage: 'DEMANDA_RADICADA',
    tutelaStage: 'TUTELA_RADICADA',
    confidence: 'HIGH',
    milestoneType: 'RECHAZO',
    triggersMilestone: true,
  },

  // ============= REQUERIMIENTO =============
  {
    patterns: [
      'auto requiere',
      'auto que requiere',
      'requerimiento',
      'requiere a la parte',
      'se requiere',
      'ordena requerir',
    ],
    category: 'REQUIREMENT',
    cgpStage: 'PENDING_AUTO_ADMISORIO',
    cgpPhase: 'FILING',
    cpacaStage: 'DEMANDA_RADICADA',
    tutelaStage: 'TUTELA_RADICADA',
    confidence: 'HIGH',
    milestoneType: 'REQUERIMIENTO',
    triggersMilestone: true,
  },

  // ============= NOTIFICACION =============
  {
    patterns: [
      'notificación personal',
      'notificacion personal',
      'se notifica personalmente',
    ],
    category: 'NOTIFICATION',
    cgpStage: 'NOTIFICACION_PERSONAL',
    cgpPhase: 'PROCESS',
    cpacaStage: 'NOTIFICACION_TRASLADOS',
    tutelaStage: 'TUTELA_ADMITIDA',
    confidence: 'HIGH',
    milestoneType: 'NOTIFICACION_PERSONAL',
    triggersMilestone: true,
  },
  {
    patterns: ['notificación por aviso', 'notificacion por aviso', 'fijación de aviso'],
    category: 'NOTIFICATION',
    cgpStage: 'NOTIFICACION_AVISO',
    cgpPhase: 'PROCESS',
    cpacaStage: 'NOTIFICACION_TRASLADOS',
    tutelaStage: 'TUTELA_ADMITIDA',
    confidence: 'HIGH',
    milestoneType: 'NOTIFICACION_AVISO',
    triggersMilestone: true,
  },
  {
    patterns: ['pone en conocimiento', 'da traslado', 'corre traslado', 'notifica'],
    category: 'NOTIFICATION',
    cgpStage: null,
    cpacaStage: 'TRASLADO_DEMANDA',
    tutelaStage: null,
    confidence: 'MEDIUM',
    milestoneType: 'NOTIFICACION',
    triggersMilestone: false,
  },

  // ============= TRASLADOS / EXCEPCIONES =============
  {
    patterns: [
      'traslado de las excepciones',
      'traslado de excepciones',
      'traslado excepciones',
    ],
    category: 'TRANSFER',
    cgpStage: 'EXCEPCIONES_PREVIAS',
    cgpPhase: 'PROCESS',
    cpacaStage: 'TRASLADO_EXCEPCIONES',
    tutelaStage: null,
    confidence: 'HIGH',
    milestoneType: 'TRASLADO_EXCEPCIONES',
    triggersMilestone: true,
  },
  {
    patterns: ['traslado de la demanda', 'traslado demanda'],
    category: 'TRANSFER',
    cgpStage: 'NOTIFICACION_PERSONAL',
    cgpPhase: 'PROCESS',
    cpacaStage: 'TRASLADO_DEMANDA',
    tutelaStage: 'TUTELA_ADMITIDA',
    confidence: 'HIGH',
    milestoneType: 'TRASLADO_DEMANDA',
    triggersMilestone: true,
  },
  {
    patterns: ['traslado'],
    category: 'TRANSFER',
    cgpStage: null,
    cpacaStage: 'TRASLADO_DEMANDA',
    tutelaStage: null,
    confidence: 'LOW',
    triggersMilestone: false,
  },

  // ============= AUDIENCIAS =============
  {
    patterns: [
      'audiencia inicial',
      'fija fecha para audiencia inicial',
      'señala fecha audiencia inicial',
    ],
    category: 'HEARING',
    cgpStage: 'AUDIENCIA_INICIAL',
    cgpPhase: 'PROCESS',
    cpacaStage: 'AUDIENCIA_INICIAL',
    tutelaStage: null,
    confidence: 'HIGH',
    milestoneType: 'AUDIENCIA_INICIAL',
    triggersMilestone: true,
  },
  {
    patterns: [
      'audiencia de instrucción',
      'audiencia de instruccion',
      'audiencia instruccion',
      'audiencia de pruebas',
    ],
    category: 'HEARING',
    cgpStage: 'AUDIENCIA_INSTRUCCION',
    cgpPhase: 'PROCESS',
    cpacaStage: 'AUDIENCIA_PRUEBAS',
    tutelaStage: null,
    confidence: 'HIGH',
    milestoneType: 'AUDIENCIA_INSTRUCCION',
    triggersMilestone: true,
  },
  {
    patterns: [
      'fija fecha para audiencia',
      'fija fecha audiencia',
      'señala fecha para audiencia',
      'señala fecha audiencia',
      'fija audiencia',
    ],
    category: 'HEARING',
    cgpStage: null,
    cpacaStage: null,
    tutelaStage: null,
    confidence: 'MEDIUM',
    milestoneType: 'AUDIENCIA_PROGRAMADA',
    triggersMilestone: true,
  },
  {
    patterns: ['celebración de audiencia', 'se realiza audiencia', 'acta de audiencia'],
    category: 'HEARING',
    cgpStage: null,
    cpacaStage: null,
    tutelaStage: null,
    confidence: 'MEDIUM',
    milestoneType: 'AUDIENCIA_CELEBRADA',
    triggersMilestone: true,
  },

  // ============= ALEGATOS =============
  {
    patterns: ['traslado para alegatos', 'correr traslado para alegatos', 'alegatos de conclusión'],
    category: 'HEARING',
    cgpStage: 'ALEGATOS_SENTENCIA',
    cgpPhase: 'PROCESS',
    cpacaStage: 'ALEGATOS_SENTENCIA',
    tutelaStage: null,
    confidence: 'HIGH',
    milestoneType: 'ALEGATOS',
    triggersMilestone: true,
  },

  // ============= SENTENCIA / FALLO =============
  {
    patterns: [
      'sentencia',
      'fallo',
      'se profiere sentencia',
      'decisión de fondo',
    ],
    category: 'RULING',
    cgpStage: 'ALEGATOS_SENTENCIA',
    cgpPhase: 'PROCESS',
    cpacaStage: 'ALEGATOS_SENTENCIA',
    tutelaStage: 'FALLO_PRIMERA_INSTANCIA',
    confidence: 'HIGH',
    milestoneType: 'SENTENCIA',
    triggersMilestone: true,
  },
  {
    patterns: ['fallo de primera instancia', 'sentencia primera instancia'],
    category: 'RULING',
    cgpStage: 'ALEGATOS_SENTENCIA',
    cgpPhase: 'PROCESS',
    cpacaStage: 'ALEGATOS_SENTENCIA',
    tutelaStage: 'FALLO_PRIMERA_INSTANCIA',
    confidence: 'HIGH',
    milestoneType: 'FALLO_PRIMERA_INSTANCIA',
    triggersMilestone: true,
  },
  {
    patterns: ['fallo de segunda instancia', 'sentencia segunda instancia'],
    category: 'RULING',
    cgpStage: 'APELACION',
    cgpPhase: 'PROCESS',
    cpacaStage: 'RECURSOS',
    tutelaStage: 'FALLO_SEGUNDA_INSTANCIA',
    confidence: 'HIGH',
    milestoneType: 'FALLO_SEGUNDA_INSTANCIA',
    triggersMilestone: true,
  },

  // ============= APELACION / RECURSOS =============
  {
    patterns: [
      'admite recurso de apelación',
      'admite recurso de apelacion',
      'admitiendo recurso',
      'concede apelación',
      'concede apelacion',
    ],
    category: 'APPEAL',
    cgpStage: 'APELACION',
    cgpPhase: 'PROCESS',
    cpacaStage: 'RECURSOS',
    tutelaStage: 'FALLO_SEGUNDA_INSTANCIA',
    confidence: 'HIGH',
    milestoneType: 'APELACION_ADMITIDA',
    triggersMilestone: true,
  },
  {
    patterns: ['recurso de apelación', 'recurso de apelacion', 'apelación', 'apelacion'],
    category: 'APPEAL',
    cgpStage: 'APELACION',
    cgpPhase: 'PROCESS',
    cpacaStage: 'RECURSOS',
    tutelaStage: null,
    confidence: 'MEDIUM',
    milestoneType: 'APELACION',
    triggersMilestone: false,
  },
  {
    patterns: ['impugnación', 'impugnacion'],
    category: 'APPEAL',
    cgpStage: null,
    cpacaStage: null,
    tutelaStage: 'FALLO_SEGUNDA_INSTANCIA',
    confidence: 'HIGH',
    milestoneType: 'IMPUGNACION',
    triggersMilestone: true,
  },

  // ============= MEDIDAS CAUTELARES =============
  {
    patterns: [
      'decreto de embargo',
      'embargo y secuestro',
      'medidas cautelares',
      'práctica de embargo',
      'practica de embargo',
    ],
    category: 'EMBARGO',
    cgpStage: null,
    cpacaStage: null,
    tutelaStage: null,
    confidence: 'HIGH',
    milestoneType: 'EMBARGO',
    triggersMilestone: true,
  },
  {
    patterns: ['niega medidas cautelares', 'niega medida cautelar'],
    category: 'EMBARGO',
    cgpStage: null,
    cpacaStage: null,
    tutelaStage: null,
    confidence: 'HIGH',
    milestoneType: 'MEDIDAS_CAUTELARES_NEGADAS',
    triggersMilestone: true,
  },

  // ============= DESACATO (TUTELA) =============
  {
    patterns: ['desacato', 'incidente de desacato', 'trámite desacato'],
    category: 'ENFORCEMENT',
    cgpStage: null,
    cpacaStage: null,
    tutelaStage: 'FALLO_PRIMERA_INSTANCIA',
    confidence: 'HIGH',
    milestoneType: 'DESACATO',
    triggersMilestone: true,
  },

  // ============= ARCHIVO =============
  {
    patterns: ['auto de archivo', 'archivar proceso', 'archivo del proceso', 'ordena archivar'],
    category: 'ARCHIVE',
    cgpStage: null,
    cpacaStage: 'ARCHIVADO',
    tutelaStage: 'ARCHIVADO',
    confidence: 'HIGH',
    milestoneType: 'ARCHIVO',
    triggersMilestone: true,
  },

  // ============= EJECUCION / CUMPLIMIENTO =============
  {
    patterns: ['mandamiento de pago', 'libra mandamiento', 'mandamiento ejecutivo'],
    category: 'ENFORCEMENT',
    cgpStage: null,
    cpacaStage: 'EJECUCION_CUMPLIMIENTO',
    tutelaStage: null,
    confidence: 'HIGH',
    milestoneType: 'MANDAMIENTO_PAGO',
    triggersMilestone: true,
  },
  {
    patterns: ['cumplimiento del fallo', 'cumplimiento de la sentencia', 'ejecución de sentencia'],
    category: 'ENFORCEMENT',
    cgpStage: null,
    cpacaStage: 'EJECUCION_CUMPLIMIENTO',
    tutelaStage: 'FALLO_PRIMERA_INSTANCIA',
    confidence: 'HIGH',
    milestoneType: 'CUMPLIMIENTO',
    triggersMilestone: true,
  },

  // ============= CPACA SPECIFIC =============
  {
    patterns: ['precontencioso', 'conciliación prejudicial', 'conciliacion prejudicial'],
    category: 'OTHER',
    cgpStage: null,
    cpacaStage: 'PRECONTENCIOSO',
    tutelaStage: null,
    confidence: 'HIGH',
    triggersMilestone: false,
  },
  {
    patterns: ['reforma de la demanda', 'reforma demanda', 'admite reforma'],
    category: 'OTHER',
    cgpStage: null,
    cpacaStage: 'REFORMA_DEMANDA',
    tutelaStage: null,
    confidence: 'HIGH',
    milestoneType: 'REFORMA_DEMANDA',
    triggersMilestone: true,
  },
];

/**
 * Normalize text for pattern matching
 * - Lowercase
 * - Remove accents
 * - Collapse multiple spaces
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if current stage order is later than suggested stage order
 */
function getStageOrder(
  workflowType: WorkflowType,
  stage: string,
  cgpPhase?: CGPPhase | null
): number {
  let stages: Record<string, { order: number }>;
  
  switch (workflowType) {
    case 'CGP':
      stages = cgpPhase === 'PROCESS' ? CGP_PROCESS_STAGES : CGP_FILING_STAGES;
      break;
    case 'CPACA':
      stages = CPACA_STAGES;
      break;
    case 'TUTELA':
      stages = TUTELA_STAGES;
      break;
    default:
      return -1;
  }
  
  return stages[stage as keyof typeof stages]?.order ?? -1;
}

/**
 * Main inference function
 * 
 * Takes estado content and returns suggested stage with confidence
 */
export function inferWorkItemStageFromEstado(
  input: StageInferenceInput
): StageInferenceResult {
  const { workflowType, currentStage, currentCgpPhase, actuacion, anotacion, despacho } = input;
  
  // Combine actuacion + anotacion for matching
  const combinedText = normalizeText(`${actuacion || ''} ${anotacion || ''}`);
  
  // Check for CPACA-specific despacho detection
  const despachoLower = normalizeText(despacho || '');
  const isCpacaDespacho = despachoLower.includes('tribunal') || 
                          despachoLower.includes('contencioso') ||
                          despachoLower.includes('administrativo');
  
  // Find matching pattern
  for (const rule of PATTERN_RULES) {
    const matchedPattern = rule.patterns.find(pattern => 
      combinedText.includes(normalizeText(pattern))
    );
    
    if (matchedPattern) {
      // Determine suggested stage based on workflow type
      let suggestedStage: string | null = null;
      let suggestedCgpPhase: CGPPhase | null = null;
      
      switch (workflowType) {
        case 'CGP':
          suggestedStage = rule.cgpStage || null;
          suggestedCgpPhase = rule.cgpPhase || null;
          break;
        case 'CPACA':
          suggestedStage = rule.cpacaStage || null;
          break;
        case 'TUTELA':
          suggestedStage = rule.tutelaStage || null;
          break;
        default:
          // For non-judicial workflows, no stage inference
          return {
            suggestedStage: null,
            suggestedCgpPhase: null,
            confidence: 'LOW',
            category: rule.category,
            reasoning: `Pattern "${matchedPattern}" detected but workflow ${workflowType} not supported`,
            matchedPattern,
            triggersMilestone: rule.triggersMilestone || false,
            milestoneType: rule.milestoneType || null,
          };
      }
      
      // Check if this would be a regression
      if (suggestedStage && currentStage) {
        const currentOrder = getStageOrder(workflowType, currentStage, currentCgpPhase);
        const suggestedOrder = getStageOrder(workflowType, suggestedStage, suggestedCgpPhase);
        
        if (suggestedOrder >= 0 && currentOrder >= 0 && suggestedOrder < currentOrder) {
          // Would regress - don't suggest stage change, but still report milestone
          return {
            suggestedStage: null,
            suggestedCgpPhase: null,
            confidence: rule.confidence,
            category: rule.category,
            reasoning: `Pattern "${matchedPattern}" → ${suggestedStage}, pero etapa actual (${currentStage}) es más avanzada`,
            matchedPattern,
            triggersMilestone: rule.triggersMilestone || false,
            milestoneType: rule.milestoneType || null,
          };
        }
      }
      
      // For CGP, check phase transition
      if (workflowType === 'CGP' && suggestedCgpPhase && currentCgpPhase !== suggestedCgpPhase) {
        // Phase change detected
        return {
          suggestedStage,
          suggestedCgpPhase,
          confidence: rule.confidence,
          category: rule.category,
          reasoning: `Pattern "${matchedPattern}" → Fase ${suggestedCgpPhase}, Etapa ${suggestedStage}`,
          matchedPattern,
          triggersMilestone: rule.triggersMilestone || false,
          milestoneType: rule.milestoneType || null,
        };
      }
      
      return {
        suggestedStage,
        suggestedCgpPhase,
        confidence: rule.confidence,
        category: rule.category,
        reasoning: `Matched keyword: "${matchedPattern}"`,
        matchedPattern,
        triggersMilestone: rule.triggersMilestone || false,
        milestoneType: rule.milestoneType || null,
      };
    }
  }
  
  // No pattern matched
  return {
    suggestedStage: null,
    suggestedCgpPhase: null,
    confidence: 'LOW',
    category: 'OTHER',
    reasoning: 'No se detectó un patrón conocido',
    matchedPattern: null,
    triggersMilestone: false,
    milestoneType: null,
  };
}

/**
 * Determine if stage change should be auto-applied
 * 
 * Only auto-apply for HIGH confidence that would advance the stage
 */
export function shouldAutoApplyStageChange(
  inference: StageInferenceResult,
  workflowType: WorkflowType,
  currentStage: string | null,
  currentCgpPhase: CGPPhase | null
): boolean {
  // Only auto-apply HIGH confidence
  if (inference.confidence !== 'HIGH') {
    return false;
  }
  
  // Must have a suggested stage
  if (!inference.suggestedStage) {
    return false;
  }
  
  // For CGP, check phase transition (always apply phase advancement)
  if (workflowType === 'CGP' && inference.suggestedCgpPhase === 'PROCESS' && currentCgpPhase === 'FILING') {
    return true;
  }
  
  // Check stage ordering
  const currentOrder = getStageOrder(workflowType, currentStage || '', currentCgpPhase);
  const suggestedOrder = getStageOrder(workflowType, inference.suggestedStage, inference.suggestedCgpPhase);
  
  // Only auto-apply if advancing
  return suggestedOrder > currentOrder;
}

/**
 * Get human-readable label for stage
 */
export function getStageLabelForInference(
  workflowType: WorkflowType,
  stage: string,
  cgpPhase?: CGPPhase | null
): string {
  let stages: Record<string, { label: string }>;
  
  switch (workflowType) {
    case 'CGP':
      stages = cgpPhase === 'PROCESS' ? CGP_PROCESS_STAGES : CGP_FILING_STAGES;
      break;
    case 'CPACA':
      stages = CPACA_STAGES;
      break;
    case 'TUTELA':
      stages = TUTELA_STAGES;
      break;
    default:
      return stage;
  }
  
  return stages[stage as keyof typeof stages]?.label || stage;
}

/**
 * Export pattern count for extensibility tracking
 */
export const PATTERN_RULES_COUNT = PATTERN_RULES.length;

/**
 * Export category list for UI
 */
export const ESTADO_CATEGORIES: EstadoCategory[] = [
  'RADICACION',
  'ADMISSION',
  'INADMISSION',
  'REQUIREMENT',
  'TRANSFER',
  'HEARING',
  'RULING',
  'APPEAL',
  'ENFORCEMENT',
  'EMBARGO',
  'NOTIFICATION',
  'ARCHIVE',
  'OTHER',
];
