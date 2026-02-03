/**
 * Workflow Source Configuration
 * 
 * Defines sync strategies and source configurations per workflow type.
 * - 'fallback': Try primary, then fallback on failure (existing behavior)
 * - 'parallel': Query ALL sources simultaneously, then consolidate
 */

export type SyncStrategy = 'fallback' | 'parallel';
export type Provider = 'cpnu' | 'samai' | 'corte_constitucional' | 'tutelas' | 'publicaciones';
export type DataType = 'actuaciones' | 'publicaciones';

export interface SourceConfig {
  provider: Provider;
  priority: number; // For display order and merge priority (lower = higher priority)
  enabled: boolean;
  data_types: DataType[];
}

export interface WorkflowSourceConfig {
  workflow_type: string;
  sync_strategy: SyncStrategy;
  sources: SourceConfig[];
}

// Provider display names for UI
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  cpnu: 'CPNU',
  samai: 'SAMAI',
  corte_constitucional: 'Corte Const.',
  tutelas: 'API Tutelas',
  publicaciones: 'Publicaciones',
};

// Workflow configurations
export const WORKFLOW_CONFIGS: Record<string, WorkflowSourceConfig> = {
  // CGP: Fallback pattern (CPNU primary, no SAMAI fallback for civil cases)
  CGP: {
    workflow_type: 'CGP',
    sync_strategy: 'fallback',
    sources: [
      { provider: 'cpnu', priority: 1, enabled: true, data_types: ['actuaciones'] },
      { provider: 'samai', priority: 2, enabled: false, data_types: ['actuaciones'] },
      { provider: 'publicaciones', priority: 3, enabled: true, data_types: ['publicaciones'] },
    ],
  },

  // CPACA: SAMAI primary (administrative litigation)
  CPACA: {
    workflow_type: 'CPACA',
    sync_strategy: 'fallback',
    sources: [
      { provider: 'samai', priority: 1, enabled: true, data_types: ['actuaciones'] },
      { provider: 'cpnu', priority: 2, enabled: false, data_types: ['actuaciones'] },
      { provider: 'publicaciones', priority: 3, enabled: true, data_types: ['publicaciones'] },
    ],
  },

  // TUTELA: PARALLEL strategy - query all sources simultaneously
  TUTELA: {
    workflow_type: 'TUTELA',
    sync_strategy: 'parallel',
    sources: [
      { provider: 'corte_constitucional', priority: 1, enabled: true, data_types: ['actuaciones'] },
      { provider: 'cpnu', priority: 2, enabled: true, data_types: ['actuaciones'] },
      { provider: 'samai', priority: 3, enabled: true, data_types: ['actuaciones'] },
      { provider: 'publicaciones', priority: 4, enabled: true, data_types: ['publicaciones'] },
    ],
  },

  // PENAL_906: CPNU primary
  PENAL_906: {
    workflow_type: 'PENAL_906',
    sync_strategy: 'fallback',
    sources: [
      { provider: 'cpnu', priority: 1, enabled: true, data_types: ['actuaciones'] },
      { provider: 'samai', priority: 2, enabled: true, data_types: ['actuaciones'] },
      { provider: 'publicaciones', priority: 3, enabled: true, data_types: ['publicaciones'] },
    ],
  },

  // LABORAL: CPNU primary
  LABORAL: {
    workflow_type: 'LABORAL',
    sync_strategy: 'fallback',
    sources: [
      { provider: 'cpnu', priority: 1, enabled: true, data_types: ['actuaciones'] },
      { provider: 'samai', priority: 2, enabled: false, data_types: ['actuaciones'] },
      { provider: 'publicaciones', priority: 3, enabled: true, data_types: ['publicaciones'] },
    ],
  },
};

/**
 * Get workflow configuration by type
 */
export function getWorkflowConfig(workflowType: string): WorkflowSourceConfig {
  return WORKFLOW_CONFIGS[workflowType] || {
    workflow_type: workflowType,
    sync_strategy: 'fallback',
    sources: [
      { provider: 'cpnu', priority: 1, enabled: true, data_types: ['actuaciones'] },
      { provider: 'publicaciones', priority: 2, enabled: true, data_types: ['publicaciones'] },
    ],
  };
}

/**
 * Check if workflow uses parallel sync
 */
export function isParallelSyncWorkflow(workflowType: string): boolean {
  const config = getWorkflowConfig(workflowType);
  return config.sync_strategy === 'parallel';
}

/**
 * Get enabled sources for actuaciones
 */
export function getActuacionesSources(workflowType: string): SourceConfig[] {
  const config = getWorkflowConfig(workflowType);
  return config.sources
    .filter(s => s.enabled && s.data_types.includes('actuaciones'))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Get enabled sources for publicaciones
 */
export function getPublicacionesSources(workflowType: string): SourceConfig[] {
  const config = getWorkflowConfig(workflowType);
  return config.sources
    .filter(s => s.enabled && s.data_types.includes('publicaciones'))
    .sort((a, b) => a.priority - b.priority);
}
