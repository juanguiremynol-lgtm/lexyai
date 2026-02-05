/**
 * useUnreadAlerts Hook
 * 
 * Provides real-time unread alert count with Supabase subscription.
 * Shows toast notifications for CRITICAL alerts in real-time.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { toast } from 'sonner';

const QUERY_KEY = 'unread-alert-count';

export function useUnreadAlerts() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const userIdRef = useRef<string | null>(null);

  // Get current user ID
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      userIdRef.current = data?.user?.id ?? null;
    });
  }, []);

  const { data: unreadCount = 0, refetch } = useQuery({
    queryKey: [QUERY_KEY, organization?.id],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !organization?.id) return 0;
      userIdRef.current = user.id;

      const { count, error } = await supabase
        .from('alert_instances')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', user.id)
        .in('status', ['PENDING', 'SENT', 'FIRED'])
        .is('seen_at', null);

      if (error) {
        console.error('[useUnreadAlerts] count error:', error);
        return 0;
      }
      return count ?? 0;
    },
    enabled: !!organization?.id,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  const refetchCount = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
  }, [queryClient]);

  // Real-time subscription for new alerts
  useEffect(() => {
    if (!userIdRef.current) return;

    const userId = userIdRef.current;
    const channel = supabase
      .channel('alert-realtime-' + userId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'alert_instances',
          filter: `owner_id=eq.${userId}`,
        },
        (payload) => {
          // Refresh count
          refetchCount();

          // Show toast for CRITICAL severity
          const newAlert = payload.new as { severity?: string; title?: string; message?: string };
          if (newAlert.severity === 'CRITICAL') {
            toast.error(`${newAlert.title}: ${newAlert.message?.slice(0, 120)}`, {
              duration: 10_000,
            });
          } else if (newAlert.severity === 'WARNING') {
            toast.warning(newAlert.title || 'Nueva alerta', {
              description: newAlert.message?.slice(0, 100),
              duration: 6_000,
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'alert_instances',
          filter: `owner_id=eq.${userId}`,
        },
        () => refetchCount()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userIdRef.current, refetchCount]);

  /**
   * Mark all visible alerts as seen (clears badge)
   */
  const markAllSeen = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('alert_instances')
      .update({ seen_at: new Date().toISOString() })
      .eq('owner_id', user.id)
      .in('status', ['PENDING', 'SENT', 'FIRED'])
      .is('seen_at', null);

    refetchCount();
  }, [refetchCount]);

  return {
    unreadCount,
    refetchCount,
    markAllSeen,
  };
}
