/**
 * supabase-query-guard.ts
 * Ensures the Supabase session is valid before executing a query.
 * Prevents RLS from returning empty results due to expired JWT tokens.
 */

import { supabase } from "@/integrations/supabase/client";

/**
 * Ensures a valid auth session exists before running a Supabase query.
 * If the token is expired or about to expire (within 30s), forces a refresh.
 * Throws 'AUTH_TOKEN_EXPIRED' if refresh fails, so React Query can retry.
 */
export async function ensureValidSession(): Promise<void> {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error || !session) {
    console.warn('[auth-guard] No valid session');
    throw new Error('AUTH_TOKEN_EXPIRED');
  }

  // Check if token is expired or about to expire (within 30 seconds)
  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
  const now = Date.now();
  const isExpiringSoon = expiresAt - now < 30000;

  if (isExpiringSoon) {
    console.log('[auth-guard] Token expiring soon, forcing refresh...');
    const { error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError) {
      console.error('[auth-guard] Token refresh failed:', refreshError.message);
      throw new Error('AUTH_TOKEN_EXPIRED');
    }
    console.log('[auth-guard] Token refreshed successfully');
  }
}
