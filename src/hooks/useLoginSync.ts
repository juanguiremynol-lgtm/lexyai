/**
 * useLoginSync Hook
 * Triggers automatic sync when user logs in
 * Enforces max 3 login syncs per user per day (America/Bogota)
 * 
 * CRITICAL: This hook calls BOTH edge functions for each work item:
 * 1. sync-by-work-item → fetches actuaciones from CPNU/SAMAI → writes to work_item_acts
 * 2. sync-publicaciones-by-work-item → fetches estados from Publicaciones API → writes to work_item_publicaciones
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { 
  checkAndIncrementLoginSync, 
  getLoginSyncStatus, 
  type LoginSyncStatus 
} from '@/lib/services/login-sync-service';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export interface UseLoginSyncResult {
  syncStatus: LoginSyncStatus | null;
  isRunning: boolean;
  lastRunAt: Date | null;
}

// Workflows that support external API sync
// Workflows that support external API sync - typed to match Database enum
const SYNC_ENABLED_WORKFLOWS = ['CGP', 'LABORAL', 'CPACA', 'TUTELA', 'PENAL_906'] as const;

// Terminal stages that don't need syncing
const TERMINAL_STAGES = [
  'ARCHIVADO',
  'FINALIZADO',
  'EJECUTORIADO',
  'PRECLUIDO_ARCHIVADO',
  'FINALIZADO_ABSUELTO',
  'FINALIZADO_CONDENADO'
];

/**
 * Hook that triggers sync when user logs in
 * Enforces server-side cap of 3 syncs per day per user
 * Should be used in TenantLayout
 */
export function useLoginSync(): UseLoginSyncResult {
  const { organization } = useOrganization();
  const hasTriggeredRef = useRef(false);
  const lastOrgIdRef = useRef<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<LoginSyncStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  // Fetch current sync status on mount/org change
  const fetchSyncStatus = useCallback(async (userId: string, orgId: string) => {
    const status = await getLoginSyncStatus(userId, orgId);
    setSyncStatus(status);
    return status;
  }, []);

  useEffect(() => {
    // Only run once per organization per session
    if (!organization?.id) return;

    // Check if this is a new organization context
    if (organization.id === lastOrgIdRef.current && hasTriggeredRef.current) {
      return;
    }

    lastOrgIdRef.current = organization.id;

    // Check if we've already triggered sync in this browser session today
    const syncKey = `login_sync_${organization.id}_${new Date().toDateString()}`;
    if (sessionStorage.getItem(syncKey)) {
      console.log('[useLoginSync] Already synced today, skipping');
      hasTriggeredRef.current = true;
      
      // Still fetch status for UI
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          fetchSyncStatus(user.id, organization.id);
        }
      });
      return;
    }

    // Trigger async sync
    const runLoginSync = async () => {
      console.log('[useLoginSync] Starting login sync for org:', organization.id);

      try {
        // Verify user is authenticated
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          console.log('[useLoginSync] No authenticated user, skipping');
          return;
        }

        // SERVER-ENFORCED: Check and increment login sync counter atomically
        const checkResult = await checkAndIncrementLoginSync(user.id, organization.id);
        
        // Update local status
        setSyncStatus({
          count: checkResult.count,
          limit: checkResult.limit,
          remaining: checkResult.remaining ?? (checkResult.limit - checkResult.count),
          canSync: checkResult.allowed
        });

        if (!checkResult.allowed) {
          console.log('[useLoginSync] Login sync limit reached:', checkResult.message);
          toast({
            title: 'Límite de sincronización alcanzado',
            description: checkResult.message || `Has alcanzado el límite de ${checkResult.limit} sincronizaciones automáticas por día.`,
            variant: 'default'
          });
          hasTriggeredRef.current = true;
          return;
        }

        console.log(`[useLoginSync] Sync allowed (${checkResult.count}/${checkResult.limit})`);
        setIsRunning(true);

        // Get eligible work items for this organization
        const { data: workItems, error: fetchError } = await supabase
          .from('work_items')
          .select('id, workflow_type, radicado, stage')
          .eq('organization_id', organization.id)
          .eq('monitoring_enabled', true)
          .in('workflow_type', SYNC_ENABLED_WORKFLOWS)
          .not('radicado', 'is', null)
          .limit(50); // Limit to avoid long delays on login

        if (fetchError) {
          console.error('[useLoginSync] Error fetching work items:', fetchError);
          setIsRunning(false);
          hasTriggeredRef.current = true;
          return;
        }

        // Filter to valid 23-digit radicados and non-terminal stages
        const eligibleItems = (workItems || []).filter(item =>
          item.radicado && 
          item.radicado.replace(/\D/g, '').length === 23 &&
          !TERMINAL_STAGES.includes(item.stage)
        );

        if (eligibleItems.length === 0) {
          console.log('[useLoginSync] No work items need syncing');
          sessionStorage.setItem(syncKey, 'true');
          hasTriggeredRef.current = true;
          setIsRunning(false);
          setLastRunAt(new Date());
          return;
        }

        console.log('[useLoginSync] Found', eligibleItems.length, 'items to sync');

        // Show toast with remaining syncs
        const remainingSyncs = checkResult.remaining ?? (checkResult.limit - checkResult.count);
        toast({
          title: 'Sincronizando procesos...',
          description: `Actualizando ${eligibleItems.length} procesos en segundo plano. (${remainingSyncs} sincronizaciones restantes hoy)`,
        });

        // Sync in background - call BOTH edge functions for each work item
        let successCount = 0;
        let publicacionesCount = 0;
        let errorCount = 0;

        for (let i = 0; i < eligibleItems.length; i++) {
          const workItem = eligibleItems[i];
          
          try {
            // Call BOTH edge functions in parallel for each work item
            const [actsResult, pubsResult] = await Promise.allSettled([
              // 1. sync-by-work-item → fetches actuaciones from CPNU/SAMAI → work_item_acts
              supabase.functions.invoke('sync-by-work-item', {
                body: { work_item_id: workItem.id, _scheduled: true }
              }),
              // 2. sync-publicaciones-by-work-item → fetches estados → work_item_publicaciones
              supabase.functions.invoke('sync-publicaciones-by-work-item', {
                body: { work_item_id: workItem.id, _scheduled: true }
              }),
            ]);

            // Track results
            if (actsResult.status === 'fulfilled' && actsResult.value.data?.ok) {
              successCount++;
            }
            if (pubsResult.status === 'fulfilled' && pubsResult.value.data?.ok) {
              publicacionesCount++;
            }

            console.log(`[useLoginSync] Synced item ${i + 1}/${eligibleItems.length}: ${workItem.id}`);

          } catch (err) {
            console.error(`[useLoginSync] Error syncing item ${workItem.id}:`, err);
            errorCount++;
          }

          // Rate limiting delay between items (faster for login sync)
          if (i < eligibleItems.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // Mark as completed
        sessionStorage.setItem(syncKey, 'true');
        hasTriggeredRef.current = true;
        setIsRunning(false);
        setLastRunAt(new Date());

        // Refresh status after sync
        await fetchSyncStatus(user.id, organization.id);

        // Show result
        if (successCount > 0 || publicacionesCount > 0) {
          toast({
            title: 'Sincronización completada',
            description: `${successCount} actuaciones, ${publicacionesCount} estados actualizados${errorCount > 0 ? `, ${errorCount} errores` : ''}`,
          });
        }

        console.log('[useLoginSync] Completed:', { successCount, publicacionesCount, errorCount });

      } catch (err) {
        console.error('[useLoginSync] Error:', err);
        hasTriggeredRef.current = true; // Prevent retries on error
        setIsRunning(false);
      }
    };

    // Run after a short delay to not block UI
    const timeoutId = setTimeout(runLoginSync, 3000);

    return () => clearTimeout(timeoutId);
  }, [organization?.id, fetchSyncStatus]);

  return { syncStatus, isRunning, lastRunAt };
}
