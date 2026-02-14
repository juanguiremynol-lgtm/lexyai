/**
 * Inference Orchestrator
 * 
 * Unified module for workflow type and stage inference.
 * Reuses existing engines (estado-stage-inference, cpaca-stage-inference, penal906-classifier)
 * and provides a single interface for all ingestion sources.
 * 
 * Features:
 * - Normalized input type for all inference sources
 * - Workflow type detection for new items
 * - Stage inference from any event type (Estado, Actuación, Publicación, Tutela)
 * - Confidence-based auto-apply rules
 * - Preclusion guard: monotonic stage enforcement with rollback detection
 */

import {
  inferWorkItemStageFromEstado,
  type StageInferenceResult,
  type StageConfidence,
} from './estado-stage-inference';
import { classifyCpacaActuacion } from '@/lib/cpaca/cpaca-stage-inference';
import { classifyActuacion as classifyPenal906 } from '@/lib/penal906/penal906-classifier';
import { type WorkflowType, type CGPPhase } from '@/lib/workflow-constants';
import type { CpacaPhase } from '@/lib/cpaca-constants';
import { 
  evaluatePreclusion, 
  type PreclisionDecision, 
  type PreclisionEvidence,
  type RollbackTrigger,
} from './preclusion-guard';

// ============================================
// Normalized Input Types
// ============================================

export type EventSourceType = 'ESTADO' | 'ACTUACION' | 'PUBLICACION' | 'TUTELA_EXPEDIENTE';

export interface NormalizedInferenceInput {
  source_type: EventSourceType;
  // Text fields - any of these can be used for inference
  title?: string | null;
  actuacion?: string | null;
  anotacion?: string | null;
  descripcion?: string | null;
  // Dates
  event_date?: string | null;
  published_at?: string | null;
  inicia_termino?: string | null;
  // Identifiers
  work_item_id?: string | null;
  workflow_type?: WorkflowType | null;
  radicado?: string | null;
  tutela_code?: string | null;
  // Authority info (for workflow detection)
  despacho?: string | null;
  authority_name?: string | null;
}

export interface WorkflowTypeInferenceResult {
  suggested_workflow: WorkflowType | null;
  confidence: StageConfidence;
  reason: string;
  matched_patterns: string[];
}

export interface StageInferenceOrchestrationResult {
  suggested_stage: string | null;
  suggested_cgp_phase: CGPPhase | null;
  suggested_pipeline_stage: number | null; // For PENAL_906
  confidence: StageConfidence;
  reasoning: string;
  category: string;
  milestone_type: string | null;
  triggers_milestone: boolean;
  should_auto_apply: boolean;
  source_type: EventSourceType;
  // Preclusion guard fields
  preclusion_decision: PreclisionDecision;
  preclusion_evidence: PreclisionEvidence | null;
  rollback_trigger: RollbackTrigger | null;
  final_stage: string | null; // After preclusion guard evaluation
  final_cgp_phase: CGPPhase | null;
}

// ============================================
// Workflow Type Detection
// ============================================

const WORKFLOW_DETECTION_PATTERNS: Array<{
  workflow: WorkflowType;
  patterns: RegExp[];
  priority: number;
}> = [
  // CPACA - highest priority for administrative jurisdiction
  {
    workflow: 'CPACA',
    patterns: [
      /contencioso\s+administrativo/i,
      /nulidad\s+y\s+restablecimiento/i,
      /reparacion\s+directa/i,
      /nulidad\s+simple/i,
      /tribunal\s+administrativo/i,
      /consejo\s+de\s+estado/i,
      /juzgado\s+administrativo/i,
      /medio\s+de\s+control/i,
      /ley\s+1437/i,
    ],
    priority: 100,
  },
  // TUTELA
  {
    workflow: 'TUTELA',
    patterns: [
      /tutela/i,
      /accion\s+de\s+tutela/i,
      /derechos\s+fundamentales/i,
      /amparo\s+constitucional/i,
      /T-\d+/i, // T-code pattern
    ],
    priority: 95,
  },
  // PENAL_906
  {
    workflow: 'PENAL_906',
    patterns: [
      /penal/i,
      /ley\s+906/i,
      /fiscalia/i,
      /imputacion/i,
      /acusacion/i,
      /juicio\s+oral/i,
      /medida\s+de\s+aseguramiento/i,
      /formulacion\s+de\s+cargos/i,
      /delito/i,
      /proceso\s+penal/i,
    ],
    priority: 90,
  },
  // LABORAL
  {
    workflow: 'LABORAL',
    patterns: [
      /laboral/i,
      /sala\s+laboral/i,
      /juzgado\s+laboral/i,
      /ordinario\s+laboral/i,
      /codigo\s+procesal\s+del\s+trabajo/i,
      /cptss/i,
      /pension/i,
      /despido/i,
      /prestaciones\s+sociales/i,
    ],
    priority: 85,
  },
  // CGP - default for civil/family/commercial
  {
    workflow: 'CGP',
    patterns: [
      /civil/i,
      /familia/i,
      /comercial/i,
      /codigo\s+general\s+del\s+proceso/i,
      /juzgado\s+civil/i,
      /juzgado\s+de\s+familia/i,
      /proceso\s+ejecutivo/i,
      /proceso\s+declarativo/i,
      /sucesion/i,
      /divorcio/i,
    ],
    priority: 80,
  },
  // PETICION - administrative procedures
  {
    workflow: 'PETICION',
    patterns: [
      /derecho\s+de\s+peticion/i,
      /peticion/i,
      /queja/i,
      /reclamo/i,
      /solicitud\s+administrativa/i,
    ],
    priority: 70,
  },
  // GOV_PROCEDURE
  {
    workflow: 'GOV_PROCEDURE',
    patterns: [
      /procedimiento\s+administrativo/i,
      /actuacion\s+administrativa/i,
      /sancionatorio/i,
      /disciplinario/i,
      /licencia/i,
      /permiso/i,
      /autorizacion\s+administrativa/i,
    ],
    priority: 65,
  },
];

/**
 * Infer workflow type from a normalized snapshot
 * Used when creating new work items from external sources
 */
export function inferWorkflowTypeFromSnapshot(
  input: NormalizedInferenceInput
): WorkflowTypeInferenceResult {
  // Combine all text fields for analysis
  const textFields = [
    input.title,
    input.actuacion,
    input.anotacion,
    input.descripcion,
    input.despacho,
    input.authority_name,
  ].filter(Boolean).join(' ');
  
  const textNorm = textFields.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (!textNorm) {
    return {
      suggested_workflow: null,
      confidence: 'LOW',
      reason: 'No text available for inference',
      matched_patterns: [],
    };
  }
  
  // Sort by priority descending
  const sortedPatterns = [...WORKFLOW_DETECTION_PATTERNS].sort((a, b) => b.priority - a.priority);
  const matchedPatterns: string[] = [];
  
  for (const rule of sortedPatterns) {
    for (const pattern of rule.patterns) {
      const match = textNorm.match(pattern);
      if (match) {
        matchedPatterns.push(match[0]);
        
        // Multiple matches = higher confidence
        const confidence: StageConfidence = matchedPatterns.length >= 2 ? 'HIGH' : 'MEDIUM';
        
        return {
          suggested_workflow: rule.workflow,
          confidence,
          reason: `Matched ${matchedPatterns.length} pattern(s) for ${rule.workflow}`,
          matched_patterns: matchedPatterns,
        };
      }
    }
  }
  
  // Default to CGP if no specific match
  return {
    suggested_workflow: 'CGP',
    confidence: 'LOW',
    reason: 'No specific workflow patterns matched, defaulting to CGP',
    matched_patterns: [],
  };
}

// ============================================
// Default preclusion fields helper
// ============================================

const DEFAULT_PRECLUSION_FIELDS = {
  preclusion_decision: 'NO_SUGGESTION' as PreclisionDecision,
  preclusion_evidence: null,
  rollback_trigger: null,
  final_stage: null,
  final_cgp_phase: null,
};

function buildNoSuggestionResult(sourceType: EventSourceType, reasoning: string): StageInferenceOrchestrationResult {
  return {
    suggested_stage: null,
    suggested_cgp_phase: null,
    suggested_pipeline_stage: null,
    confidence: 'LOW',
    reasoning,
    category: 'OTHER',
    milestone_type: null,
    triggers_milestone: false,
    should_auto_apply: false,
    source_type: sourceType,
    ...DEFAULT_PRECLUSION_FIELDS,
  };
}

// ============================================
// Stage Inference Orchestration
// ============================================

/**
 * Infer stage from a new event for any workflow type
 * Delegates to the appropriate engine based on workflow_type
 * Now includes preclusion guard evaluation
 */
export function inferStageFromNewEvent(
  workflowType: WorkflowType,
  currentStage: string | null,
  currentCgpPhase: CGPPhase | null,
  currentPipelineStage: number | null,
  input: NormalizedInferenceInput
): StageInferenceOrchestrationResult {
  // Combine text fields
  const primaryText = input.actuacion || input.descripcion || input.title || input.anotacion || '';
  
  if (!primaryText.trim()) {
    return buildNoSuggestionResult(input.source_type, 'No text available for stage inference');
  }
  
  // Route to appropriate engine
  let rawResult: StageInferenceOrchestrationResult;
  
  switch (workflowType) {
    case 'PENAL_906':
      rawResult = inferPenal906Stage(primaryText, currentPipelineStage, input);
      break;
    case 'CPACA':
      rawResult = inferCpacaStage(primaryText, currentStage, input);
      break;
    case 'CGP':
    case 'LABORAL':
    case 'TUTELA':
      rawResult = inferEstadoStage(workflowType, currentStage, currentCgpPhase, primaryText, input);
      break;
    default:
      return buildNoSuggestionResult(input.source_type, `Workflow ${workflowType} does not support automated stage inference`);
  }
  
  // Apply preclusion guard (skip for PENAL_906 which has its own retroceso handling)
  if (workflowType !== 'PENAL_906' && rawResult.suggested_stage) {
    const preclusionResult = evaluatePreclusion({
      workflowType,
      currentStage,
      currentCgpPhase,
      suggestedStage: rawResult.suggested_stage,
      suggestedCgpPhase: rawResult.suggested_cgp_phase,
      docketText: primaryText,
    });
    
    rawResult.preclusion_decision = preclusionResult.decision;
    rawResult.preclusion_evidence = preclusionResult.evidence;
    rawResult.rollback_trigger = preclusionResult.rollbackTrigger;
    rawResult.final_stage = preclusionResult.finalStage;
    rawResult.final_cgp_phase = preclusionResult.finalCgpPhase;
    
    // Update auto-apply based on preclusion decision
    if (preclusionResult.decision === 'REGRESSION_BLOCKED' || 
        preclusionResult.decision === 'ROLLBACK_NEEDS_REVIEW') {
      rawResult.should_auto_apply = false;
    }
    
    // For rollback by nullity, use the rollback target as the final suggestion
    if (preclusionResult.decision === 'ROLLBACK_BY_NULLITY' && preclusionResult.finalStage) {
      rawResult.final_stage = preclusionResult.finalStage;
      rawResult.reasoning += ` | ROLLBACK: ${preclusionResult.rollbackTrigger.matchedText} → ${preclusionResult.finalStage}`;
    }
  }
  
  return rawResult;
}

/**
 * Infer stage for CGP/LABORAL/TUTELA using estado-stage-inference engine
 */
function inferEstadoStage(
  workflowType: WorkflowType,
  currentStage: string | null,
  currentCgpPhase: CGPPhase | null,
  text: string,
  input: NormalizedInferenceInput
): StageInferenceOrchestrationResult {
  const result = inferWorkItemStageFromEstado({
    workflowType,
    currentStage: currentStage || '',
    currentCgpPhase: currentCgpPhase,
    actuacion: text,
    anotacion: input.anotacion || undefined,
    iniciaTermino: input.inicia_termino,
    despacho: input.despacho || input.authority_name || undefined,
  });
  
  return {
    suggested_stage: result.suggestedStage,
    suggested_cgp_phase: result.suggestedCgpPhase,
    suggested_pipeline_stage: null,
    confidence: result.confidence,
    reasoning: result.reasoning,
    category: result.category,
    milestone_type: result.milestoneType,
    triggers_milestone: result.triggersMilestone,
    should_auto_apply: shouldAutoApplyStageChange(result.confidence, result.suggestedStage, currentStage),
    source_type: input.source_type,
    ...DEFAULT_PRECLUSION_FIELDS,
  };
}

/**
 * Infer stage for CPACA using cpaca-stage-inference engine
 */
function inferCpacaStage(
  text: string,
  currentStage: string | null,
  input: NormalizedInferenceInput
): StageInferenceOrchestrationResult {
  const result = classifyCpacaActuacion(text, (currentStage as CpacaPhase) || 'DEMANDA_RADICADA');
  
  const confidence: StageConfidence = result.confidence_level as StageConfidence;
  const isDifferent = result.stage_inferred !== currentStage;
  
  return {
    suggested_stage: result.stage_inferred,
    suggested_cgp_phase: null,
    suggested_pipeline_stage: null,
    confidence,
    reasoning: `CPACA classifier matched: ${result.keywords_matched.join(', ') || 'no keywords'}`,
    category: result.is_terminal ? 'ARCHIVE' : 'OTHER',
    milestone_type: null,
    triggers_milestone: false,
    should_auto_apply: isDifferent && confidence === 'HIGH',
    source_type: input.source_type,
    ...DEFAULT_PRECLUSION_FIELDS,
  };
}

/**
 * Infer stage for PENAL_906 using penal906-classifier engine
 */
function inferPenal906Stage(
  text: string,
  currentPipelineStage: number | null,
  input: NormalizedInferenceInput
): StageInferenceOrchestrationResult {
  const result = classifyPenal906(text, currentPipelineStage ?? 0);
  
  const isDifferent = result.phase_inferred !== (currentPipelineStage ?? 0);
  const confidence: StageConfidence = result.confidence_level as StageConfidence;
  
  return {
    suggested_stage: null,
    suggested_cgp_phase: null,
    suggested_pipeline_stage: result.phase_inferred,
    confidence,
    reasoning: `Penal 906 classifier: ${result.keywords_matched.join(', ') || 'no keywords'}`,
    category: result.event_category,
    milestone_type: null,
    triggers_milestone: false,
    should_auto_apply: isDifferent && confidence === 'HIGH' && !result.has_retroceso,
    source_type: input.source_type,
    ...DEFAULT_PRECLUSION_FIELDS,
    preclusion_decision: result.has_retroceso ? 'REGRESSION_BLOCKED' : (isDifferent ? 'ADVANCE_MONOTONIC' : 'SAME_STAGE'),
  };
}

// ============================================
// Auto-Apply Rules
// ============================================

function shouldAutoApplyStageChange(
  confidence: StageConfidence,
  suggestedStage: string | null,
  currentStage: string | null
): boolean {
  if (confidence !== 'HIGH') return false;
  if (!suggestedStage) return false;
  if (suggestedStage === currentStage) return false;
  return true;
}

// ============================================
// Batch Processing
// ============================================

export interface BatchInferenceResult {
  work_item_id: string;
  inference: StageInferenceOrchestrationResult;
  applied: boolean;
  error?: string;
}

export async function processEventsForInference(
  events: Array<{
    work_item_id: string;
    workflow_type: WorkflowType;
    current_stage: string | null;
    current_cgp_phase: CGPPhase | null;
    current_pipeline_stage: number | null;
    event: NormalizedInferenceInput;
  }>
): Promise<BatchInferenceResult[]> {
  const results: BatchInferenceResult[] = [];
  
  for (const item of events) {
    const inference = inferStageFromNewEvent(
      item.workflow_type,
      item.current_stage,
      item.current_cgp_phase,
      item.current_pipeline_stage,
      item.event
    );
    
    results.push({
      work_item_id: item.work_item_id,
      inference,
      applied: false,
    });
  }
  
  return results;
}

// Re-export types for convenience
export type { StageConfidence, PreclisionDecision, PreclisionEvidence };
