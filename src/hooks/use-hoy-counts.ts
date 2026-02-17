/**
 * Hook: useHoyCounts
 *
 * Badge counts for "Estados de Hoy" and "Actuaciones de Hoy" sidebar.
 * 
 * IMPORTANT: Counts are based ONLY on external event dates:
 *   - Estados: fecha_fijacion = today (court publication date)
 *   - Actuaciones: act_date = today (court event date)
 * 
 * NOT based on created_at/updated_at. Re-syncing old data must NOT inflate counts.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { getColombiaToday } from '@/lib/colombia-date-utils';

export function useHoyCounts() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const today = getColombiaToday();

  const { data: estadosCount = 0 } = useQuery({
    queryKey: ['hoy-count-estados', orgId, today],
    queryFn: async () => {
      if (!orgId) return 0;

      // Count only estados published today by the court (fecha_fijacion)
      const { count, error } = await supabase
        .from('work_item_publicaciones')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('fecha_fijacion', today)
        .eq('is_archived', false);

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

      // Count only actuaciones with event date today (act_date)
      const { count, error } = await supabase
        .from('work_item_acts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('act_date', today)
        .eq('is_archived', false);

      if (error) console.error('[hoy-counts] actuaciones error:', error);
      return count ?? 0;
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return { estadosCount, actuacionesCount, today };
}
