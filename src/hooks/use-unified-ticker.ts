/**
 * Unified Ticker Hook
 * 
 * Provides real-time ticker data from both work_item_publicaciones and work_item_acts.
 * Includes Supabase Realtime subscriptions for instant updates.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { getTickerItems, type TickerItem } from '@/lib/services/ticker-data-service';
import { useTickerSettings } from './use-ticker-estados';

interface UseUnifiedTickerOptions {
  limit?: number;
  refetchIntervalSeconds?: number;
  enableRealtime?: boolean;
}

export function useUnifiedTicker(options: UseUnifiedTickerOptions = {}) {
  const {
    limit = 50,
    refetchIntervalSeconds = 60,
    enableRealtime = true,
  } = options;

  const { organization } = useOrganization();
  const { showTicker, isLoading: settingsLoading } = useTickerSettings();
  const queryClient = useQueryClient();

  // Main query for ticker items
  const query = useQuery({
    queryKey: ['unified-ticker', organization?.id, limit],
    queryFn: async (): Promise<TickerItem[]> => {
      if (!organization?.id) return [];
      return getTickerItems(organization.id, limit);
    },
    enabled: !!organization?.id && showTicker,
    refetchInterval: refetchIntervalSeconds * 1000,
    staleTime: (refetchIntervalSeconds * 1000) / 2,
  });

  // Real-time subscriptions for instant updates
  useEffect(() => {
    if (!organization?.id || !enableRealtime || !showTicker) return;

    const invalidateTicker = () => {
      queryClient.invalidateQueries({ queryKey: ['unified-ticker'] });
    };

    // Subscribe to new publicaciones
    const publicacionesChannel = supabase
      .channel('ticker-publicaciones')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'work_item_publicaciones',
        },
        (payload) => {
          console.log('[ticker] New publicacion detected:', payload.new?.id);
          invalidateTicker();
        }
      )
      .subscribe();

    // Subscribe to new actuaciones (work_item_acts)
    const actuacionesChannel = supabase
      .channel('ticker-actuaciones')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'work_item_acts',
        },
        (payload) => {
          console.log('[ticker] New actuacion detected:', payload.new?.id);
          invalidateTicker();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(publicacionesChannel);
      supabase.removeChannel(actuacionesChannel);
    };
  }, [organization?.id, enableRealtime, showTicker, queryClient]);

  // Computed values
  const estadosCount = query.data?.filter(item => item.type === 'ESTADO').length ?? 0;
  const actuacionesCount = query.data?.filter(item => item.type === 'ACTUACION').length ?? 0;
  const criticalCount = query.data?.filter(item => item.severity === 'CRITICAL').length ?? 0;
  const missingDesfijacionCount = query.data?.filter(item => item.missing_fecha_desfijacion).length ?? 0;

  return {
    items: query.data ?? [],
    isLoading: query.isLoading || settingsLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    // Computed
    estadosCount,
    actuacionesCount,
    criticalCount,
    missingDesfijacionCount,
    // Settings
    showTicker,
  };
}

export type { TickerItem };
