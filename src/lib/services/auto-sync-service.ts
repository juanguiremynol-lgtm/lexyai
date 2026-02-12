/**
 * Auto-Sync Service
 * Handles automatic synchronization of work items with external APIs
 */

import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type WorkflowType = Database['public']['Enums']['workflow_type'];

// Workflows that support external API sync
const SYNC_ENABLED_WORKFLOWS: WorkflowType[] = ['CGP', 'LABORAL', 'CPACA', 'TUTELA', 'PENAL_906'];

// Terminal stages that don't need syncing
const TERMINAL_STAGES = [
  'ARCHIVADO',
  'FINALIZADO',
  'EJECUTORIADO',
  'PRECLUIDO_ARCHIVADO',
  'FINALIZADO_ABSUELTO',
  'FINALIZADO_CONDENADO'
];

export interface SyncEligibleWorkItem {
  id: string;
  radicado: string;
  workflow_type: string;
  organization_id: string;
  owner_id: string;
  last_synced_at: string | null;
  stage: string;
}

export interface SyncBatchResults {
  success: number;
  failed: number;
  skipped: number;
  scraping_initiated: number;
  errors: Array<{ workItemId: string; error: string }>;
}

/**
 * Get all work items eligible for automatic sync
 */
export async function getEligibleWorkItems(
  organizationId: string,
  options: {
    minHoursSinceLastSync?: number;
    limit?: number;
  } = {}
): Promise<SyncEligibleWorkItem[]> {
  const { minHoursSinceLastSync = 1, limit = 100 } = options;

  // Calculate cutoff time
  const cutoffTime = new Date();
  cutoffTime.setHours(cutoffTime.getHours() - minHoursSinceLastSync);

  try {
    const { data, error } = await supabase
      .from('work_items')
      .select('id, radicado, workflow_type, organization_id, owner_id, last_synced_at, stage')
      .eq('organization_id', organizationId)
      .in('workflow_type', SYNC_ENABLED_WORKFLOWS)
      .not('stage', 'in', `(${TERMINAL_STAGES.join(',')})`)
      .not('radicado', 'is', null)
      .is('deleted_at', null)
      .neq('monitoring_enabled', false) // Use existing monitoring_enabled column
      .or(`last_synced_at.is.null,last_synced_at.lt.${cutoffTime.toISOString()}`)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(limit);

    if (error) {
      console.error('[auto-sync] Error fetching eligible work items:', error);
      return [];
    }

    // Filter to only valid 23-digit radicados and cast to our interface
    const eligibleItems = (data || []).filter(item =>
      item.radicado && item.radicado.replace(/\D/g, '').length === 23
    );

    return eligibleItems.map(item => ({
      id: item.id,
      radicado: item.radicado!,
      workflow_type: item.workflow_type,
      organization_id: item.organization_id || '',
      owner_id: item.owner_id,
      last_synced_at: item.last_synced_at,
      stage: item.stage
    }));
  } catch (err) {
    console.error('[auto-sync] Exception fetching eligible work items:', err);
    return [];
  }
}

/**
 * Sync a batch of work items
 */
export async function syncWorkItemBatch(
  workItems: SyncEligibleWorkItem[],
  options: {
    onProgress?: (completed: number, total: number) => void;
    onError?: (workItemId: string, error: Error) => void;
    delayBetweenMs?: number;
  } = {}
): Promise<SyncBatchResults> {
  const { onProgress, onError, delayBetweenMs = 500 } = options;

  const results: SyncBatchResults = {
    success: 0,
    failed: 0,
    skipped: 0,
    scraping_initiated: 0,
    errors: []
  };

  for (let i = 0; i < workItems.length; i++) {
    const workItem = workItems[i];

    try {
      // Call sync-by-work-item edge function
      const { data, error } = await supabase.functions.invoke('sync-by-work-item', {
        body: { work_item_id: workItem.id }
      });

      if (error) {
        throw error;
      }

      if (data?.ok) {
        results.success++;
        // Update last_synced_at
        await updateLastSyncedAt(workItem.id);
      } else if (data?.code === 'SCRAPING_INITIATED' || data?.scraping_initiated) {
        results.scraping_initiated++;
      } else {
        results.skipped++;
      }

      // Also sync publicaciones for eligible workflows
      if (['CGP', 'LABORAL', 'CPACA', 'PENAL_906'].includes(workItem.workflow_type)) {
        try {
          await supabase.functions.invoke('sync-publicaciones-by-work-item', {
            body: { work_item_id: workItem.id }
          });
        } catch (pubErr) {
          console.warn('[auto-sync] Publicaciones sync failed for', workItem.id, pubErr);
        }
      }

    } catch (err) {
      results.failed++;
      results.errors.push({
        workItemId: workItem.id,
        error: (err as Error).message
      });
      onError?.(workItem.id, err as Error);
    }

    // Update progress
    onProgress?.(i + 1, workItems.length);

    // Rate limiting delay
    if (i < workItems.length - 1 && delayBetweenMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenMs));
    }
  }

  return results;
}

/**
 * Update last_synced_at timestamp for a work item
 */
export async function updateLastSyncedAt(workItemId: string): Promise<void> {
  try {
    await supabase
      .from('work_items')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', workItemId);
  } catch (err) {
    console.error('[auto-sync] Failed to update last_synced_at:', err);
  }
}

/**
 * Check if a work item is eligible for sync
 */
export function isEligibleForSync(workItem: {
  radicado: string | null;
  workflow_type: string;
  stage: string;
  monitoring_enabled?: boolean;
}): boolean {
  // Must have valid radicado
  if (!workItem.radicado || workItem.radicado.replace(/\D/g, '').length !== 23) {
    return false;
  }

  // Must be supported workflow
  if (!SYNC_ENABLED_WORKFLOWS.includes(workItem.workflow_type as WorkflowType)) {
    return false;
  }

  // Must not be in terminal stage
  if (TERMINAL_STAGES.includes(workItem.stage)) {
    return false;
  }

  // Must have monitoring enabled (default true)
  if (workItem.monitoring_enabled === false) {
    return false;
  }

  return true;
}

/**
 * Get sync status description
 */
export function getSyncStatusDescription(lastSyncedAt: string | null): {
  status: 'never' | 'fresh' | 'stale' | 'critical';
  message: string;
} {
  if (!lastSyncedAt) {
    return { status: 'never', message: 'Nunca sincronizado' };
  }

  const lastSync = new Date(lastSyncedAt);
  const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);

  if (hoursSinceSync < 4) {
    return { status: 'fresh', message: 'Sincronizado recientemente' };
  } else if (hoursSinceSync < 24) {
    return { status: 'stale', message: 'Sincronizado hace más de 4 horas' };
  } else {
    return { status: 'critical', message: 'Sincronizado hace más de 24 horas' };
  }
}
