/**
 * Login Sync Service
 * Manages per-user login sync cap enforcement (max 3/day)
 */

import { supabase } from '@/integrations/supabase/client';

export interface LoginSyncStatus {
  count: number;
  limit: number;
  remaining: number;
  canSync: boolean;
}

export interface LoginSyncCheckResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining?: number;
  message?: string;
}

const LOGIN_SYNC_LIMIT = 3;

/**
 * Get current login sync status for a user (read-only)
 */
export async function getLoginSyncStatus(
  userId: string,
  organizationId: string
): Promise<LoginSyncStatus> {
  try {
    const { data, error } = await supabase.rpc('get_login_sync_status', {
      p_user_id: userId,
      p_organization_id: organizationId,
      p_max_per_day: LOGIN_SYNC_LIMIT
    });

    if (error) {
      console.error('[login-sync-service] Error getting status:', error);
      // Fail open - allow sync if we can't check
      return { count: 0, limit: LOGIN_SYNC_LIMIT, remaining: LOGIN_SYNC_LIMIT, canSync: true };
    }

    const result = data as { count: number; limit: number; remaining: number; can_sync: boolean };
    return {
      count: result.count,
      limit: result.limit,
      remaining: result.remaining,
      canSync: result.can_sync
    };
  } catch (err) {
    console.error('[login-sync-service] Exception getting status:', err);
    return { count: 0, limit: LOGIN_SYNC_LIMIT, remaining: LOGIN_SYNC_LIMIT, canSync: true };
  }
}

/**
 * Check and atomically increment login sync counter
 * Returns whether sync is allowed
 */
export async function checkAndIncrementLoginSync(
  userId: string,
  organizationId: string
): Promise<LoginSyncCheckResult> {
  try {
    const { data, error } = await supabase.rpc('check_and_increment_login_sync', {
      p_user_id: userId,
      p_organization_id: organizationId,
      p_max_per_day: LOGIN_SYNC_LIMIT
    });

    if (error) {
      console.error('[login-sync-service] Error checking/incrementing:', error);
      // Fail open - allow sync if we can't check
      return { allowed: true, count: 0, limit: LOGIN_SYNC_LIMIT };
    }

    const result = data as { 
      allowed: boolean; 
      count: number; 
      limit: number; 
      remaining?: number;
      message?: string;
    };
    
    return {
      allowed: result.allowed,
      count: result.count,
      limit: result.limit,
      remaining: result.remaining,
      message: result.message
    };
  } catch (err) {
    console.error('[login-sync-service] Exception checking/incrementing:', err);
    // Fail open - allow sync if we can't check
    return { allowed: true, count: 0, limit: LOGIN_SYNC_LIMIT };
  }
}

/**
 * Get a formatted message for the user about their sync status
 */
export function formatSyncStatusMessage(status: LoginSyncStatus): string {
  if (!status.canSync) {
    return `Límite de sincronización automática alcanzado (${status.count}/${status.limit})`;
  }
  return `Sincronizaciones restantes hoy: ${status.remaining}/${status.limit}`;
}
