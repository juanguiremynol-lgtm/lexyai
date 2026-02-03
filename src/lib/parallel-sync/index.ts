/**
 * Parallel Sync Module
 * 
 * Exports all parallel sync functionality for multi-source Tutela sync.
 */

export {
  type SyncStrategy,
  type Provider,
  type DataType,
  type SourceConfig,
  type WorkflowSourceConfig,
  PROVIDER_DISPLAY_NAMES,
  WORKFLOW_CONFIGS,
  getWorkflowConfig,
  isParallelSyncWorkflow,
  getActuacionesSources,
  getPublicacionesSources,
} from './workflow-config';

export {
  type RawActuacion,
  type ProviderResult,
  type NormalizedActuacion,
  type ConsolidatedActuacion,
  type ConsolidationResult,
  normalizeActuacion,
  consolidateActuaciones,
  generateMultiSourceFingerprint,
} from './consolidation-engine';
