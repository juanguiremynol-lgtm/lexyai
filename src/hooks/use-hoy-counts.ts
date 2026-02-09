/**
 * Hook: useHoyCounts
 *
 * Badge counts for "Estados de Hoy" and "Actuaciones de Hoy" sidebar.
 * Uses dual-criteria: items where act_date/fecha_fijacion = today
 * OR created_at falls within today in Colombia timezone.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { getColombiaToday, getColombiaDayBoundsUTC } from '@/lib/colombia-date-utils';

export function useHoyCounts() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const today = getColombiaToday();
  const { startUTC, endUTC } = getColombiaDayBoundsUTC(0);

  const { data: estadosCount = 0 } = useQuery({
    queryKey: ['hoy-count-estados', orgId, today],
    queryFn: async () => {
      if (!orgId) return 0;

      // Two parallel count queries, then deduplicate via ID fetch
      const [byDate, byCreated] = await Promise.all([
        supabase
          .from('work_item_publicaciones')
          .select('id', { head: false })
          .eq('organization_id', orgId)
          .eq('fecha_fijacion', today)
          .eq('is_archived', false),
        supabase
          .from('work_item_publicaciones')
          .select('id', { head: false })
          .eq('organization_id', orgId)
          .gte('created_at', startUTC)
          .lte('created_at', endUTC)
          .eq('is_archived', false),
      ]);

      const ids = new Set<string>();
      (byDate.data || []).forEach((r: any) => ids.add(r.id));
      (byCreated.data || []).forEach((r: any) => ids.add(r.id));
      return ids.size;
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: actuacionesCount = 0 } = useQuery({
    queryKey: ['hoy-count-actuaciones', orgId, today],
    queryFn: async () => {
      if (!orgId) return 0;

      const [byDate, byCreated] = await Promise.all([
        supabase
          .from('work_item_acts')
          .select('id', { head: false })
          .eq('organization_id', orgId)
          .eq('act_date', today)
          .eq('is_archived', false),
        supabase
          .from('work_item_acts')
          .select('id', { head: false })
          .eq('organization_id', orgId)
          .gte('created_at', startUTC)
          .lte('created_at', endUTC)
          .eq('is_archived', false),
      ]);

      const ids = new Set<string>();
      (byDate.data || []).forEach((r: any) => ids.add(r.id));
      (byCreated.data || []).forEach((r: any) => ids.add(r.id));
      return ids.size;
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return { estadosCount, actuacionesCount, today };
}
