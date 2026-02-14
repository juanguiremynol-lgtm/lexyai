/**
 * Preclusion Guard Module
 * 
 * Enforces monotonic (non-decreasing) stage progression for Colombian judicial workflows.
 * The only way to regress a stage is via a detected "rollback trigger" (nulidad/retroacción).
 * 
 * This module:
 * 1. Detects rollback triggers (nullity, retroaction) in docket text
 * 2. Parses the target stage from nullity language ("desde la notificación")
 * 3. Provides a decision function: advance, block regression, or allow rollback
 * 4. Creates evidence records for every decision
 */

import {
  CGP_FILING_STAGES,
  CGP_PROCESS_STAGES,
  CPACA_STAGES,
  TUTELA_STAGES,
  LABORAL_STAGES,
  type WorkflowType,
  type CGPPhase,
} from '@/lib/workflow-constants';

// ============================================
// Types
// ============================================

export type PreclisionDecision = 
  | 'ADVANCE_MONOTONIC'      // Normal forward progression
  | 'SAME_STAGE'             // No change
  | 'REGRESSION_BLOCKED'     // Regression attempted but blocked
  | 'ROLLBACK_BY_NULLITY'    // Regression allowed due to nullity
  | 'ROLLBACK_NEEDS_REVIEW'  // Nullity detected but target stage unclear
  | 'TUTELA_FORWARD'         // Tutela-specific forward progression (impugnación → segunda instancia)
  | 'NO_SUGGESTION';         // No stage suggested

export interface RollbackTrigger {
  detected: boolean;
  triggerType: 'NULIDAD' | 'RETROACCION' | 'DEJAR_SIN_EFECTOS' | 'REHACER' | null;
  matchedText: string | null;
  targetStageParsed: string | null;  // e.g., "NOTIFICACION_PERSONAL"
  targetStageRank: number | null;
  parseConfidence: 'HIGH' | 'LOW' | null;
}

export interface PreclisionResult {
  decision: PreclisionDecision;
  currentStageRank: number;
  suggestedStageRank: number;
  rollbackTrigger: RollbackTrigger;
  finalStage: string | null;
  finalCgpPhase: CGPPhase | null;
  evidence: PreclisionEvidence;
}

export interface PreclisionEvidence {
  rule_fired: PreclisionDecision;
  current_stage: string | null;
  current_rank: number;
  suggested_stage: string | null;
  suggested_rank: number;
  rollback_trigger_detected: boolean;
  rollback_trigger_type: string | null;
  rollback_matched_text: string | null;
  rollback_target_stage: string | null;
  matched_docket_text: string;
  timestamp: string;
}

// ============================================
// Rollback Trigger Patterns
// ============================================

interface RollbackPattern {
  regex: RegExp;
  type: RollbackTrigger['triggerType'];
  label: string;
}

const ROLLBACK_PATTERNS: RollbackPattern[] = [
  { regex: /declara\s+(la\s+)?nulidad/i, type: 'NULIDAD', label: 'Declara nulidad' },
  { regex: /nulidad\s+de\s+lo\s+actuado/i, type: 'NULIDAD', label: 'Nulidad de lo actuado' },
  { regex: /nulidad\s+procesal/i, type: 'NULIDAD', label: 'Nulidad procesal' },
  { regex: /anular\s+lo\s+actuado/i, type: 'NULIDAD', label: 'Anular lo actuado' },
  { regex: /dejar\s+sin\s+efecto(s)?/i, type: 'DEJAR_SIN_EFECTOS', label: 'Dejar sin efectos' },
  { regex: /retrotra(e|er)\s+(la\s+)?actuaci[oó]n/i, type: 'RETROACCION', label: 'Retrotraer actuación' },
  { regex: /reponer\s+(la\s+)?actuaci[oó]n/i, type: 'RETROACCION', label: 'Reponer actuación' },
  { regex: /invalidar\s+desde/i, type: 'NULIDAD', label: 'Invalidar desde' },
  { regex: /rehacer\s+(la\s+)?actuaci[oó]n/i, type: 'REHACER', label: 'Rehacer actuación' },
  { regex: /nulidad\s+desde/i, type: 'NULIDAD', label: 'Nulidad desde' },
];

// Stage keywords for parsing "desde qué actuación" targets
const STAGE_TARGET_KEYWORDS: Array<{ 
  patterns: RegExp[]; 
  stageByWorkflow: Partial<Record<WorkflowType, string>>;
  rank_hint: number;
}> = [
  {
    patterns: [/desde\s+(la\s+)?notificaci[oó]n/i, /hasta\s+(la\s+)?notificaci[oó]n/i, /a\s+partir\s+de(l\s+)?.*notificaci[oó]n/i],
    stageByWorkflow: { CGP: 'NOTIFICACION_PERSONAL', CPACA: 'AUTO_ADMISORIO', LABORAL: 'AUDIENCIA_INICIAL', TUTELA: 'TUTELA_ADMITIDA' },
    rank_hint: 1,
  },
  {
    patterns: [/desde\s+(el\s+)?auto\s+admisorio/i, /a\s+partir\s+de(l\s+)?auto\s+admisorio/i],
    stageByWorkflow: { CGP: 'AUTO_ADMISORIO', CPACA: 'AUTO_ADMISORIO', LABORAL: 'ADMISION_PENDIENTE', TUTELA: 'TUTELA_ADMITIDA' },
    rank_hint: 0,
  },
  {
    patterns: [/desde\s+(la\s+)?audiencia\s+inicial/i, /a\s+partir\s+de(l\s+)?.*audiencia\s+inicial/i],
    stageByWorkflow: { CGP: 'AUDIENCIA_INICIAL', CPACA: 'AUDIENCIA_INICIAL', LABORAL: 'AUDIENCIA_INICIAL' },
    rank_hint: 5,
  },
  {
    patterns: [/desde\s+(el\s+)?traslado/i, /a\s+partir\s+de(l\s+)?.*traslado/i],
    stageByWorkflow: { CGP: 'NOTIFICACION_PERSONAL', CPACA: 'TRASLADO_DEMANDA', LABORAL: 'AUDIENCIA_INICIAL' },
    rank_hint: 3,
  },
  {
    patterns: [/desde\s+(la\s+)?contestaci[oó]n/i, /a\s+partir\s+de(l\s+)?.*contestaci[oó]n/i],
    stageByWorkflow: { CGP: 'EXCEPCIONES_PREVIAS', CPACA: 'TRASLADO_DEMANDA', LABORAL: 'AUDIENCIA_INICIAL' },
    rank_hint: 3,
  },
  {
    patterns: [/desde\s+(la\s+)?admisi[oó]n/i, /a\s+partir\s+de(l\s+)?.*admisi[oó]n/i],
    stageByWorkflow: { CGP: 'AUTO_ADMISORIO', CPACA: 'AUTO_ADMISORIO', LABORAL: 'ADMISION_PENDIENTE', TUTELA: 'TUTELA_ADMITIDA' },
    rank_hint: 0,
  },
  {
    patterns: [/desde\s+(la\s+)?radicaci[oó]n/i],
    stageByWorkflow: { CGP: 'RADICADO_CONFIRMED', CPACA: 'DEMANDA_RADICADA', LABORAL: 'RADICACION', TUTELA: 'TUTELA_RADICADA' },
    rank_hint: 0,
  },
];

// ============================================
// Stage Rank Resolution
// ============================================

export function getStageRank(
  workflowType: WorkflowType,
  stage: string | null,
  cgpPhase?: CGPPhase | null
): number {
  if (!stage) return -1;
  
  let stages: Record<string, { order: number }>;
  
  switch (workflowType) {
    case 'CGP':
      if (cgpPhase === 'PROCESS') {
        stages = CGP_PROCESS_STAGES;
        // Process stages have higher effective rank than filing stages
        const processOrder = stages[stage as keyof typeof stages]?.order;
        return processOrder !== undefined ? processOrder + 100 : -1;
      }
      stages = CGP_FILING_STAGES;
      break;
    case 'CPACA':
      stages = CPACA_STAGES;
      break;
    case 'TUTELA':
      stages = TUTELA_STAGES;
      break;
    case 'LABORAL':
      stages = LABORAL_STAGES;
      break;
    default:
      return -1;
  }
  
  return stages[stage as keyof typeof stages]?.order ?? -1;
}

// ============================================
// Rollback Detection
// ============================================

function normalizeForRollback(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect rollback triggers in docket text
 */
export function detectRollbackTrigger(
  rawText: string,
  workflowType: WorkflowType
): RollbackTrigger {
  const textNorm = normalizeForRollback(rawText);
  
  for (const pattern of ROLLBACK_PATTERNS) {
    const match = textNorm.match(pattern.regex);
    if (match) {
      // Try to parse target stage
      const target = parseRollbackTarget(textNorm, workflowType);
      
      return {
        detected: true,
        triggerType: pattern.type,
        matchedText: match[0],
        targetStageParsed: target.stage,
        targetStageRank: target.rank,
        parseConfidence: target.stage ? 'HIGH' : 'LOW',
      };
    }
  }
  
  return {
    detected: false,
    triggerType: null,
    matchedText: null,
    targetStageParsed: null,
    targetStageRank: null,
    parseConfidence: null,
  };
}

/**
 * Parse "desde qué actuación" from nullity text
 */
function parseRollbackTarget(
  textNorm: string,
  workflowType: WorkflowType
): { stage: string | null; rank: number | null } {
  for (const target of STAGE_TARGET_KEYWORDS) {
    for (const pattern of target.patterns) {
      if (pattern.test(textNorm)) {
        const stage = target.stageByWorkflow[workflowType] || null;
        if (stage) {
          const rank = getStageRank(workflowType, stage);
          return { stage, rank };
        }
      }
    }
  }
  
  return { stage: null, rank: null };
}

// ============================================
// Main Preclusion Guard
// ============================================

/**
 * Evaluate a stage suggestion against the preclusion guard.
 * 
 * Returns whether the suggestion should be applied, blocked, or allowed as rollback.
 */
export function evaluatePreclusion(params: {
  workflowType: WorkflowType;
  currentStage: string | null;
  currentCgpPhase: CGPPhase | null;
  suggestedStage: string | null;
  suggestedCgpPhase: CGPPhase | null;
  docketText: string;
}): PreclisionResult {
  const { workflowType, currentStage, currentCgpPhase, suggestedStage, suggestedCgpPhase, docketText } = params;
  
  const currentRank = getStageRank(workflowType, currentStage, currentCgpPhase);
  const suggestedRank = getStageRank(workflowType, suggestedStage, suggestedCgpPhase);
  
  // Detect rollback trigger
  const rollbackTrigger = detectRollbackTrigger(docketText, workflowType);
  
  const buildEvidence = (decision: PreclisionDecision, finalStage: string | null): PreclisionEvidence => ({
    rule_fired: decision,
    current_stage: currentStage,
    current_rank: currentRank,
    suggested_stage: suggestedStage,
    suggested_rank: suggestedRank,
    rollback_trigger_detected: rollbackTrigger.detected,
    rollback_trigger_type: rollbackTrigger.triggerType,
    rollback_matched_text: rollbackTrigger.matchedText,
    rollback_target_stage: rollbackTrigger.targetStageParsed,
    matched_docket_text: docketText.substring(0, 200),
    timestamp: new Date().toISOString(),
  });
  
  // No suggestion
  if (!suggestedStage) {
    return {
      decision: 'NO_SUGGESTION',
      currentStageRank: currentRank,
      suggestedStageRank: suggestedRank,
      rollbackTrigger,
      finalStage: null,
      finalCgpPhase: null,
      evidence: buildEvidence('NO_SUGGESTION', null),
    };
  }
  
  // Same stage
  if (suggestedStage === currentStage && suggestedCgpPhase === currentCgpPhase) {
    return {
      decision: 'SAME_STAGE',
      currentStageRank: currentRank,
      suggestedStageRank: suggestedRank,
      rollbackTrigger,
      finalStage: suggestedStage,
      finalCgpPhase: suggestedCgpPhase,
      evidence: buildEvidence('SAME_STAGE', suggestedStage),
    };
  }
  
  // Tutela-specific: impugnación and fallo segunda instancia are ALWAYS forward
  if (workflowType === 'TUTELA') {
    const tutelaForwardStages = ['FALLO_SEGUNDA_INSTANCIA', 'ARCHIVADO'];
    if (suggestedStage && tutelaForwardStages.includes(suggestedStage) && suggestedRank > currentRank) {
      return {
        decision: 'TUTELA_FORWARD',
        currentStageRank: currentRank,
        suggestedStageRank: suggestedRank,
        rollbackTrigger,
        finalStage: suggestedStage,
        finalCgpPhase: null,
        evidence: buildEvidence('TUTELA_FORWARD', suggestedStage),
      };
    }
  }
  
  // Forward progression (monotonic advance)
  if (suggestedRank > currentRank || currentRank < 0 || suggestedRank < 0) {
    // CGP phase transition from FILING to PROCESS is always an advance
    if (workflowType === 'CGP' && suggestedCgpPhase === 'PROCESS' && currentCgpPhase === 'FILING') {
      return {
        decision: 'ADVANCE_MONOTONIC',
        currentStageRank: currentRank,
        suggestedStageRank: suggestedRank,
        rollbackTrigger,
        finalStage: suggestedStage,
        finalCgpPhase: suggestedCgpPhase,
        evidence: buildEvidence('ADVANCE_MONOTONIC', suggestedStage),
      };
    }
    
    return {
      decision: 'ADVANCE_MONOTONIC',
      currentStageRank: currentRank,
      suggestedStageRank: suggestedRank,
      rollbackTrigger,
      finalStage: suggestedStage,
      finalCgpPhase: suggestedCgpPhase,
      evidence: buildEvidence('ADVANCE_MONOTONIC', suggestedStage),
    };
  }
  
  // =====================
  // REGRESSION DETECTED
  // =====================
  
  // Check for rollback trigger
  if (rollbackTrigger.detected) {
    if (rollbackTrigger.targetStageParsed && rollbackTrigger.parseConfidence === 'HIGH') {
      // Rollback allowed to the parsed target stage
      return {
        decision: 'ROLLBACK_BY_NULLITY',
        currentStageRank: currentRank,
        suggestedStageRank: rollbackTrigger.targetStageRank ?? suggestedRank,
        rollbackTrigger,
        finalStage: rollbackTrigger.targetStageParsed,
        finalCgpPhase: suggestedCgpPhase,
        evidence: buildEvidence('ROLLBACK_BY_NULLITY', rollbackTrigger.targetStageParsed),
      };
    } else {
      // Nullity detected but can't determine target → needs review
      return {
        decision: 'ROLLBACK_NEEDS_REVIEW',
        currentStageRank: currentRank,
        suggestedStageRank: suggestedRank,
        rollbackTrigger,
        finalStage: null, // Don't auto-regress
        finalCgpPhase: null,
        evidence: buildEvidence('ROLLBACK_NEEDS_REVIEW', null),
      };
    }
  }
  
  // No rollback trigger → block the regression
  return {
    decision: 'REGRESSION_BLOCKED',
    currentStageRank: currentRank,
    suggestedStageRank: suggestedRank,
    rollbackTrigger,
    finalStage: null, // Keep current stage
    finalCgpPhase: null,
    evidence: buildEvidence('REGRESSION_BLOCKED', null),
  };
}

/**
 * Human-readable label for preclusion decisions
 */
export function getDecisionLabel(decision: PreclisionDecision): string {
  switch (decision) {
    case 'ADVANCE_MONOTONIC': return 'Avance monotónico';
    case 'SAME_STAGE': return 'Misma etapa';
    case 'REGRESSION_BLOCKED': return 'Regresión bloqueada';
    case 'ROLLBACK_BY_NULLITY': return 'Retroceso por nulidad';
    case 'ROLLBACK_NEEDS_REVIEW': return 'Nulidad detectada — requiere revisión';
    case 'TUTELA_FORWARD': return 'Avance tutela (impugnación/revisión)';
    case 'NO_SUGGESTION': return 'Sin sugerencia';
    default: return decision;
  }
}

/**
 * Color code for preclusion decisions
 */
export function getDecisionColor(decision: PreclisionDecision): string {
  switch (decision) {
    case 'ADVANCE_MONOTONIC': return 'text-green-600 dark:text-green-400';
    case 'TUTELA_FORWARD': return 'text-green-600 dark:text-green-400';
    case 'SAME_STAGE': return 'text-muted-foreground';
    case 'REGRESSION_BLOCKED': return 'text-red-600 dark:text-red-400';
    case 'ROLLBACK_BY_NULLITY': return 'text-amber-600 dark:text-amber-400';
    case 'ROLLBACK_NEEDS_REVIEW': return 'text-amber-600 dark:text-amber-400';
    case 'NO_SUGGESTION': return 'text-muted-foreground';
    default: return '';
  }
}

/**
 * Badge variant for decisions
 */
export function getDecisionBadgeVariant(decision: PreclisionDecision): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (decision) {
    case 'ADVANCE_MONOTONIC':
    case 'TUTELA_FORWARD':
      return 'default';
    case 'REGRESSION_BLOCKED':
      return 'destructive';
    case 'ROLLBACK_BY_NULLITY':
    case 'ROLLBACK_NEEDS_REVIEW':
      return 'secondary';
    default:
      return 'outline';
  }
}
