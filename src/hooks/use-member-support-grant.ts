/**
 * Hook to check if the current user has a support tab grant
 * for their organization (granted by org admin via Andro IA).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useMemberSupportGrant(organizationId: string | null) {
  const { data: hasSupportGrant = false, isLoading } = useQuery({
    queryKey: ["member-support-grant", organizationId],
    queryFn: async () => {
      if (!organizationId) return false;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { data, error } = await supabase
        .from("member_support_grants")
        .select("id, revoked_at")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .is("revoked_at", null)
        .maybeSingle();

      if (error) return false;
      return !!data;
    },
    enabled: !!organizationId,
    refetchInterval: 30_000,
  });

  return { hasSupportGrant, isLoading };
}
