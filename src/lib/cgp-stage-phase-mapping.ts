/**
 * CGP Stage-to-Phase Mapping
 * 
 * DEPRECATED: Use src/lib/cgp-constants.ts instead.
 * This file is kept for backward compatibility during migration.
 * 
 * New code should import from cgp-constants.ts:
 * import { CGP_STAGES, derivePhaseFromStage, getOrderedCGPStages } from '@/lib/cgp-constants';
 */

import {
  CGP_STAGES,
  derivePhaseFromStage as _derivePhaseFromStage,
  getOrderedCGPStages as _getOrderedCGPStages,
  getStagesForPhase as _getStagesForPhase,
  getStageLabel as _getStageLabel,
  getStageShortLabel as _getStageShortLabel,
  getStageOrder as _getStageOrder,
  wouldChangePhase as _wouldChangePhase,
  type CGPPhase,
  type CGPStageConfig,
} from './cgp-constants';

// Re-export types
export type { CGPPhase };

// Legacy type for backward compatibility
export type CGPUnifiedStage = keyof typeof CGP_STAGES;

// Create a legacy-compatible structure
const CGP_UNIFIED_STAGES_LEGACY: Record<string, {
  order: number;
  label: string;
  shortLabel: string;
  phase: CGPPhase;
  color: string;
}> = {};

Object.entries(CGP_STAGES).forEach(([key, config]) => {
  CGP_UNIFIED_STAGES_LEGACY[key] = {
    order: config.order,
    label: config.label,
    shortLabel: config.shortLabel,
    phase: config.phase,
    color: config.color,
  };
});

export const CGP_UNIFIED_STAGES = CGP_UNIFIED_STAGES_LEGACY;

// Re-export functions with legacy names
export const derivePhaseFromStage = _derivePhaseFromStage;
export const getOrderedCGPStages = (): string[] => _getOrderedCGPStages().map(s => s.key);
export const getStagesForPhase = (phase: CGPPhase): string[] => 
  _getStagesForPhase(phase).map(s => s.key);
export const getStageLabel = _getStageLabel;
export const getStageShortLabel = _getStageShortLabel;
export const getStageOrder = _getStageOrder;
export const wouldChangePhase = _wouldChangePhase;

// Merged kanban stages config for pipeline display
export interface MergedStageConfig {
  id: string;
  label: string;
  shortLabel: string;
  color: string;
  phase: CGPPhase;
  stages: string[];
  order: number;
}

/**
 * Get merged kanban stages - now returns all 13 stages as individual columns
 */
export function getMergedKanbanStages(): MergedStageConfig[] {
  return _getOrderedCGPStages().map((stage) => ({
    id: stage.key,
    label: stage.label,
    shortLabel: stage.shortLabel,
    color: stage.color,
    phase: stage.phase,
    stages: [stage.key],
    order: stage.order,
  }));
}

/**
 * Find which column a stage belongs to
 */
export function findMergedColumnForStage(stage: string): MergedStageConfig | null {
  const mergedStages = getMergedKanbanStages();
  return mergedStages.find(col => col.stages.includes(stage)) || null;
}

/**
 * Get the first stage of a merged column
 */
export function getFirstStageOfMergedColumn(mergedColumnId: string): string | null {
  const mergedStages = getMergedKanbanStages();
  const column = mergedStages.find(col => col.id === mergedColumnId);
  return column?.stages[0] || null;
}

// Validation function
export function isValidStageTransition(fromStage: string, toStage: string): boolean {
  const fromConfig = CGP_STAGES[fromStage];
  const toConfig = CGP_STAGES[toStage];
  if (!fromConfig || !toConfig) return false;
  // Allow any transition (user can drag anywhere)
  return true;
}
