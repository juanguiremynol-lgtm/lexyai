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
  eligibleCount: number;
  syncedCount: number;
  runSyncAgain: () => void;
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
  const [eligibleCount, setEligibleCount] = useState(0);
  const [syncedCount, setSyncedCount] = useState(0);

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

    // Trigger async sync
    // NOTE: sessionStorage check moved inside runLoginSync to include userId (FIX 1.3)
    const runLoginSync = async () => {
      console.log('[useLoginSync] Starting login sync for org:', organization.id);

      try {
        // Verify user is authenticated
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          console.log('[useLoginSync] No authenticated user, skipping');
          return;
        }

        // FIX 1.3: Include userId in sessionStorage key to prevent cross-user collisions
        const syncKey = `login_sync_${user.id}_${organization.id}_${new Date().toDateString()}`;
        
        // Check if we've already triggered sync in this browser session today
        if (sessionStorage.getItem(syncKey)) {
          console.log('[useLoginSync] Already synced today for this user, skipping');
          hasTriggeredRef.current = true;
          fetchSyncStatus(user.id, organization.id);
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
        // Limit to 10 items and order by oldest sync to prioritize stale data
        const { data: workItems, error: fetchError } = await supabase
          .from('work_items')
          .select('id, workflow_type, radicado, stage')
          .eq('organization_id', organization.id)
          .eq('monitoring_enabled', true)
          .is('deleted_at', null)
          .in('workflow_type', SYNC_ENABLED_WORKFLOWS)
          .not('radicado', 'is', null)
          .order('last_synced_at', { ascending: true, nullsFirst: true }) // Oldest sync first
          .limit(10); // Reduced from 50 to 10 due to 60s polling per item

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
          setEligibleCount(0);
          return;
        }

        console.log('[useLoginSync] Found', eligibleItems.length, 'items to sync');
        setEligibleCount(eligibleItems.length);

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
        setSyncedCount(successCount + publicacionesCount);

        // Refresh status after sync
        await fetchSyncStatus(user.id, organization.id);

        // Show result — check for existing Lexy message first
        if (successCount > 0 || publicacionesCount > 0) {
          // Check if a Lexy daily message already exists for today
          const todayStr = new Date(new Date().getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const { data: existingLexy } = await (supabase
            .from('lexy_daily_messages') as any)
            .select('id')
            .eq('user_id', user.id)
            .eq('message_date', todayStr)
            .maybeSingle();

          if (existingLexy) {
            // Lexy message exists — show simple toast with counts instead of duplicating
            toast({
              title: 'Procesos actualizados',
              description: `Se encontraron ${successCount} nuevas actuaciones y ${publicacionesCount} nuevos estados.${errorCount > 0 ? ` (${errorCount} errores)` : ''}`,
            });
          } else {
            toast({
              title: 'Sincronización completada',
              description: `${successCount} actuaciones, ${publicacionesCount} estados actualizados${errorCount > 0 ? `, ${errorCount} errores` : ''}`,
            });
          }
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

  // Allow manual re-run (bypasses sessionStorage guard)
  const runSyncAgain = useCallback(() => {
    if (!organization?.id) return;
    // FIX 1.3: Clear all user-scoped sync keys for this org+date
    const dateStr = new Date().toDateString();
    // Clear any matching key pattern
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('login_sync_') && key.includes(organization.id) && key.includes(dateStr)) {
        sessionStorage.removeItem(key);
      }
    }
    hasTriggeredRef.current = false;
    // Force re-run by updating a dependency (will trigger useEffect)
    setLastRunAt(null);
  }, [organization?.id]);

  return { syncStatus, isRunning, lastRunAt, eligibleCount, syncedCount, runSyncAgain };
}
