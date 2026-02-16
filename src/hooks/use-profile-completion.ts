/**
 * Hook to check if the current user's profile is complete.
 * Used by route guards to enforce profile onboarding.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ProfileCompletionStatus {
  isComplete: boolean;
  isLoading: boolean;
  isPlatformAdmin: boolean;
  profile: {
    full_name: string | null;
    avatar_url: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    profile_completed_at: string | null;
  } | null;
}

export function useProfileCompletion(): ProfileCompletionStatus {
  const { data, isLoading } = useQuery({
    queryKey: ['profile-completion'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { profile: null, isPlatformAdmin: false };

      // Check platform admin status
      const { data: adminRecord } = await supabase
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      // Get profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, avatar_url, address, phone, email, profile_completed_at')
        .eq('id', user.id)
        .maybeSingle();

      return {
        profile,
        isPlatformAdmin: !!adminRecord,
      };
    },
    staleTime: 1000 * 60 * 2,
  });

  const profile = data?.profile ?? null;
  const isPlatformAdmin = data?.isPlatformAdmin ?? false;

  return {
    isComplete: isPlatformAdmin || !!profile?.profile_completed_at,
    isLoading,
    isPlatformAdmin,
    profile,
  };
}
