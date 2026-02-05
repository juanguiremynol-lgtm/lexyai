/**
 * Hook: useHoyCounts
 * 
 * Provides live badge counts for "Estados de Hoy" and "Actuaciones de Hoy"
 * sidebar items. Counts ALL records dated today (Colombia timezone),
 * regardless of is_notifiable.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';

function getColombiaToday(): string {
  // Get current date in Colombia timezone (UTC-5)
  const now = new Date();
  const colombiaOffset = -5 * 60; // minutes
  const localOffset = now.getTimezoneOffset(); // minutes
  const colombiaTime = new Date(now.getTime() + (localOffset + colombiaOffset) * 60000);
  return colombiaTime.toISOString().split('T')[0];
}

export function useHoyCounts() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const today = getColombiaToday();

  const { data: estadosCount = 0 } = useQuery({
    queryKey: ['hoy-count-estados', orgId, today],
    queryFn: async () => {
      if (!orgId) return 0;
      const { count, error } = await supabase
        .from('work_item_publicaciones')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('fecha_fijacion', today)
        .eq('is_archived', false);
      if (error) {
        console.error('[hoy-counts] estados error:', error);
        return 0;
      }
      return count ?? 0;
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: actuacionesCount = 0 } = useQuery({
    queryKey: ['hoy-count-actuaciones', orgId, today],
    queryFn: async () => {
      if (!orgId) return 0;
      const { count, error } = await supabase
        .from('work_item_acts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('act_date', today)
        .eq('is_archived', false);
      if (error) {
        console.error('[hoy-counts] actuaciones error:', error);
        return 0;
      }
      return count ?? 0;
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return { estadosCount, actuacionesCount, today };
}
