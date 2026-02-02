/**
 * usePublicacionesHoy Hook
 * 
 * Fetches publicaciones (estados) from the last 3 days.
 * Uses fecha_fijacion as the primary date field.
 */

import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/contexts/OrganizationContext';
import { getPublicacionesHoy, type PublicacionHoyItem, type PublicacionesHoyResult } from '@/lib/services/publicaciones-hoy-service';

export function usePublicacionesHoy() {
  const { organization } = useOrganization();

  const query = useQuery({
    queryKey: ['publicaciones-hoy', organization?.id],
    queryFn: () => getPublicacionesHoy(organization!.id),
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
    withDateCount: query.data?.withDate?.length ?? 0,
    withoutDateCount: query.data?.withoutDate?.length ?? 0,
  };
}

export type { PublicacionHoyItem, PublicacionesHoyResult };
