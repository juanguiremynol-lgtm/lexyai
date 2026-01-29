/**
 * useLoginSync Hook
 * Triggers automatic sync when user logs in
 */

import { useEffect, useRef } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { getEligibleWorkItems, syncWorkItemBatch } from '@/lib/services/auto-sync-service';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook that triggers sync when user logs in
 * Should be used in TenantLayout
 */
export function useLoginSync() {
  const { organization } = useOrganization();
  const hasTriggeredRef = useRef(false);
  const lastOrgIdRef = useRef<string | null>(null);

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

        // Get eligible work items (not synced in last hour)
        const eligibleItems = await getEligibleWorkItems(organization.id, {
          minHoursSinceLastSync: 1,
          limit: 30 // Limit to avoid long delays on login
        });

        if (eligibleItems.length === 0) {
          console.log('[useLoginSync] No work items need syncing');
          sessionStorage.setItem(syncKey, 'true');
          hasTriggeredRef.current = true;
          return;
        }

        console.log('[useLoginSync] Found', eligibleItems.length, 'items to sync');

        // Show toast
        toast({
          title: 'Sincronizando procesos...',
          description: `Actualizando ${eligibleItems.length} procesos en segundo plano`,
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
      }
    };

    // Run after a short delay to not block UI
    const timeoutId = setTimeout(runLoginSync, 3000);

    return () => clearTimeout(timeoutId);
  }, [organization?.id]);
}
