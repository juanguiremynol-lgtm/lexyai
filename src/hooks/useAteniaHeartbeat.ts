/**
 * useAteniaHeartbeat Hook (B2)
 * 
 * Periodic heartbeat that triggers Atenia AI's OBSERVE → ACT pipeline.
 * 
 * Guards:
 * - COT window guard: no actions during 6:50–7:30 AM COT (daily cron window)
 * - Single-flight cross-tab: Web Locks API + localStorage TTL fallback
 * - Minimum interval: 30 min between heartbeats (configurable via atenia_ai_config)
 * - Only runs for authenticated users with an organization
 */

import { useEffect, useRef } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { runHeartbeat, isInCronGuardWindow } from '@/lib/services/atenia-ai-autonomous';

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes default
const LOCK_KEY = 'atenia_heartbeat_lock';
const LS_LAST_RUN_KEY = 'atenia_heartbeat_last_run';

/**
 * Attempt to acquire a cross-tab lock using Web Locks API.
 * Falls back to localStorage TTL if Web Locks is unavailable.
 */
async function acquireSingleFlightLock(
  callback: () => Promise<void>
): Promise<boolean> {
  // Web Locks API (preferred)
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    try {
      const result = await navigator.locks.request(
        LOCK_KEY,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return false; // Another tab holds the lock
          await callback();
          return true;
        }
      );
      return result as boolean;
    } catch {
      // Fallback if Web Locks fails
    }
  }

  // Fallback: localStorage TTL
  const now = Date.now();
  const lastRun = parseInt(localStorage.getItem(LS_LAST_RUN_KEY) || '0', 10);
  
  // If another tab ran within the last 5 minutes, skip
  if (now - lastRun < 5 * 60 * 1000) {
    return false;
  }

  localStorage.setItem(LS_LAST_RUN_KEY, String(now));
  await callback();
  return true;
}

export function useAteniaHeartbeat() {
  const { organization } = useOrganization();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRunRef = useRef<number>(0);

  useEffect(() => {
    if (!organization?.id) return;

    const orgId = organization.id;

    const tick = async () => {
      const now = Date.now();
      
      // Enforce minimum interval
      if (now - lastRunRef.current < HEARTBEAT_INTERVAL_MS) return;

      // COT window guard (quick check before acquiring lock)
      if (isInCronGuardWindow()) return;

      const acquired = await acquireSingleFlightLock(async () => {
        try {
          const result = await runHeartbeat(orgId);
          if (!result.skipped) {
            console.log(
              `[atenia-heartbeat] Completed: ${result.observations.length} observations, ${result.actionsTriggered} actions`
            );
          } else {
            console.log(`[atenia-heartbeat] Skipped: ${result.reason}`);
          }
        } catch (err) {
          console.warn('[atenia-heartbeat] Error:', err);
        }
      });

      if (acquired) {
        lastRunRef.current = now;
      }
    };

    // Initial tick after 2 minutes (let the app settle)
    const initialTimeout = setTimeout(tick, 2 * 60 * 1000);

    // Periodic tick
    intervalRef.current = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [organization?.id]);
}
