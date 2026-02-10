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
 * - Respects autonomy_paused: if paused, observes only (logs heartbeat_observed)
 */

import { useEffect, useRef } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import { runHeartbeat, isInCronGuardWindow } from '@/lib/services/atenia-ai-autonomous';

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes default
const LOCK_KEY = 'atenia-ai-heartbeat-lock';
const LS_LOCK_KEY = 'atenia_ai_heartbeat_lock_v1';

/**
 * Cross-tab single-flight lock.
 * Preferred: Web Locks API (Chrome/Edge + modern browsers).
 * Fallback: localStorage TTL lock.
 */
async function withCrossTabLock(fn: () => Promise<void>): Promise<boolean> {
  const navAny = navigator as any;

  if (navAny?.locks?.request) {
    try {
      const result = await navAny.locks.request(
        LOCK_KEY,
        { ifAvailable: true },
        async (lock: any) => {
          if (!lock) return false; // another tab is leader
          await fn();
          return true;
        }
      );
      return result as boolean;
    } catch {
      // Fall through to localStorage fallback
    }
  }

  // Fallback: localStorage TTL lock
  const now = Date.now();
  const ttlMs = 29 * 60 * 1000; // slightly under 30 min
  const token = `${now}-${Math.random().toString(16).slice(2)}`;

  const raw = localStorage.getItem(LS_LOCK_KEY);
  const existing = raw ? JSON.parse(raw) : null;

  if (existing?.ts && (now - existing.ts) < ttlMs) return false;

  localStorage.setItem(LS_LOCK_KEY, JSON.stringify({ ts: now, token }));

  // Re-read to confirm we won the race
  const confirm = JSON.parse(localStorage.getItem(LS_LOCK_KEY) || 'null');
  if (confirm?.token !== token) return false;

  await fn();
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

      const acquired = await withCrossTabLock(async () => {
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

    // Initial tick after 5 minutes (let the app settle)
    const initialTimeout = setTimeout(tick, 5 * 60 * 1000);

    // Periodic tick
    intervalRef.current = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [organization?.id]);
}
