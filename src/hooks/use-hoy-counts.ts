/**
 * Hook: useHoyCounts
 *
 * Badge counts for "Estados de Hoy" and "Actuaciones de Hoy" sidebar.
 * 
 * Counts are based on DETECTION dates (detected_at, changed_at),
 * showing items that were newly discovered or modified today,
 * regardless of their court event date.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { getColombiaDayBoundsUTC } from '@/lib/colombia-date-utils';

export function useHoyCounts() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const todayBounds = getColombiaDayBoundsUTC(0);
  const today = todayBounds.dateStr;

  const { data: estadosCount = 0 } = useQuery({
    queryKey: ['hoy-count-estados', orgId, today],
    queryFn: async () => {
      if (!orgId) return 0;

      // Count estados whose court date (fecha_fijacion) is today (COT)
      const { count, error } = await supabase
        .from('work_item_publicaciones')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .eq('fecha_fijacion', today);

      if (error) console.error('[hoy-counts] estados error:', error);
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

      // Count actuaciones whose event date (act_date) is today (COT)
      const { count, error } = await supabase
        .from('work_item_acts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .eq('act_date', today);

      if (error) console.error('[hoy-counts] actuaciones error:', error);
      return count ?? 0;
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return { estadosCount, actuacionesCount, today };
}
