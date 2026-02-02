/**
 * useActuacionesHoy Hook
 * 
 * Fetches actuaciones from the last 3 days.
 * Uses act_date as the primary date field - NOT created_at.
 */

import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/contexts/OrganizationContext';
import { getActuacionesHoy, type ActuacionHoyItem, type ActuacionesHoyResult } from '@/lib/services/actuaciones-hoy-service';

export function useActuacionesHoy() {
  const { organization } = useOrganization();

  const query = useQuery({
    queryKey: ['actuaciones-hoy', organization?.id],
    queryFn: () => getActuacionesHoy(organization!.id),
    enabled: !!organization?.id,
    staleTime: 60000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
    // Computed
    totalCount: query.data?.totalCount ?? 0,
    importantCount: query.data?.items?.filter(i => i.is_important).length ?? 0,
  };
}

export type { ActuacionHoyItem, ActuacionesHoyResult };
