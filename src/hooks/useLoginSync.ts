/**
 * useLoginSync Hook
 * Triggers automatic sync when user logs in
 * Enforces max 3 login syncs per user per day (America/Bogota)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { getEligibleWorkItems, syncWorkItemBatch } from '@/lib/services/auto-sync-service';
import { 
  checkAndIncrementLoginSync, 
  getLoginSyncStatus, 
  formatSyncStatusMessage,
  type LoginSyncStatus 
} from '@/lib/services/login-sync-service';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export interface UseLoginSyncResult {
  syncStatus: LoginSyncStatus | null;
  isRunning: boolean;
  lastRunAt: Date | null;
}

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

        // Get eligible work items (not synced in last hour)
        const eligibleItems = await getEligibleWorkItems(organization.id, {
          minHoursSinceLastSync: 1,
          limit: 30 // Limit to avoid long delays on login
        });

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

        // Sync in background
        const results = await syncWorkItemBatch(eligibleItems, {
          delayBetweenMs: 300, // Faster for login sync
          onProgress: (completed, total) => {
            console.log(`[useLoginSync] Progress: ${completed}/${total}`);
          }
        });

        // Mark as completed
        sessionStorage.setItem(syncKey, 'true');
        hasTriggeredRef.current = true;
        setIsRunning(false);
        setLastRunAt(new Date());

        // Refresh status after sync
        await fetchSyncStatus(user.id, organization.id);

        // Show result
        const totalUpdates = results.success + results.scraping_initiated;
        if (totalUpdates > 0) {
          toast({
            title: 'Sincronización completada',
            description: `${results.success} procesos actualizados${results.scraping_initiated > 0 ? `, ${results.scraping_initiated} pendientes` : ''}`,
          });
        }

        console.log('[useLoginSync] Completed:', results);

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
