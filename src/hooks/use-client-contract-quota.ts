/**
 * Hook to check per-client contract quota for anti-abuse enforcement.
 * Returns quota status including current count, effective limit, and whether creation is allowed.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ClientContractQuota {
  allowed: boolean;
  current_count: number;
  base_limit: number;
  extra_limit_granted: number;
  effective_limit: number;
  can_request_extra: boolean;
  expires_at: string | null;
}

export function useClientContractQuota(
  organizationId: string | undefined,
  clientId: string | undefined,
  enabled = true
) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["client-contract-quota", organizationId, clientId],
    queryFn: async (): Promise<ClientContractQuota> => {
      const { data, error } = await supabase.rpc("check_client_contract_quota", {
        p_organization_id: organizationId!,
        p_client_id: clientId!,
      });
      if (error) throw error;
      return data as unknown as ClientContractQuota;
    },
    enabled: enabled && !!organizationId && !!clientId,
    staleTime: 1000 * 30, // 30 seconds
  });

  return {
    quota: data ?? null,
    isLoading,
    refetch,
  };
}
