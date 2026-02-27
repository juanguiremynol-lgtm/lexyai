/**
 * Hook: useHoyCounts
 *
 * Badge counts for "Estados de Hoy" and "Actuaciones de Hoy" sidebar.
 * 
 * CANONICAL LOGIC (v2 — aligned with email alerts):
 * Counts are based on DETECTION timestamps (detected_at) within today's
 * COT (America/Bogota) window. This matches the alert_instances trigger
 * logic used by dispatch-update-emails, ensuring sidebar badges and
 * email alerts always show the same items.
 * 
 * Previously filtered by legal dates (act_date, fecha_fijacion) which
 * caused divergence from email alerts when items had backdated legal dates.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/contexts/OrganizationContext';
import { getColombiaDayBoundsUTC, getColombiaToday } from '@/lib/colombia-date-utils';

export function useHoyCounts() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const today = getColombiaToday();
  const { startUTC, endUTC } = getColombiaDayBoundsUTC(0);

  const { data: estadosCount = 0 } = useQuery({
    queryKey: ['hoy-count-estados', orgId, today],
    queryFn: async () => {
      if (!orgId) return 0;

      // Count estados detected today (COT) — matches email alert trigger
      const { count, error } = await supabase
        .from('work_item_publicaciones')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .gte('detected_at', startUTC)
        .lte('detected_at', endUTC);

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

      // Count actuaciones detected today (COT) — matches email alert trigger
      const { count, error } = await supabase
        .from('work_item_acts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .gte('detected_at', startUTC)
        .lte('detected_at', endUTC);

      if (error) console.error('[hoy-counts] actuaciones error:', error);
      return count ?? 0;
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return { estadosCount, actuacionesCount, today };
}
