/**
 * Platform Admin Hook
 * 
 * Checks if the current user is a platform superadmin with cross-org access.
 * Platform admins can manage all organizations, subscriptions, and platform-wide operations.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PlatformAdminInfo {
  isPlatformAdmin: boolean;
  isLoading: boolean;
  role: string | null;
  createdAt: string | null;
}

export function usePlatformAdmin(): PlatformAdminInfo {
  const { data, isLoading } = useQuery({
    queryKey: ["platform-admin-status"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: adminRecord, error } = await supabase
        .from("platform_admins")
        .select("user_id, role, created_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.warn("[usePlatformAdmin] Error checking platform admin status:", error.message);
        return null;
      }

      return adminRecord;
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: 1,
  });

  return {
    isPlatformAdmin: !!data,
    isLoading,
    role: data?.role || null,
    createdAt: data?.created_at || null,
  };
}
