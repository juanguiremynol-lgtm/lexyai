import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  brand_logo_url: string | null;
  brand_tagline: string;
  brand_primary_color: string | null;
  is_active?: boolean;
  created_by?: string;
}

interface OrganizationContextType {
  organization: Organization | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

const OrganizationContext = createContext<OrganizationContextType>({
  organization: null,
  isLoading: true,
  error: null,
  refetch: () => {},
});

export function useOrganization() {
  return useContext(OrganizationContext);
}

interface OrganizationProviderProps {
  children: ReactNode;
}

export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const { data: organization, isLoading, error, refetch } = useQuery({
    queryKey: ["current-organization"],
    queryFn: async () => {
      // First get the user's profile to find their organization
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .single();

      if (!profile?.organization_id) {
        // Check if user has a membership (might be newly created)
        const { data: memberships } = await supabase
          .from("organization_memberships")
          .select("organization_id")
          .eq("user_id", user.id)
          .limit(1);

        if (memberships && memberships.length > 0) {
          // Update profile with organization_id
          await supabase
            .from("profiles")
            .update({ organization_id: memberships[0].organization_id })
            .eq("id", user.id);

          const { data: org } = await supabase
            .from("organizations")
            .select("*")
            .eq("id", memberships[0].organization_id)
            .single();

          return org as Organization;
        }

        // Return default ATENIA organization for backward compatibility
        return {
          id: "a0000000-0000-0000-0000-000000000001",
          name: "ATENIA",
          slug: "atenia",
          brand_logo_url: null,
          brand_tagline: "Asistente jurídico digital",
          brand_primary_color: null,
        } as Organization;
      }

      const { data: org, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", profile.organization_id)
        .single();

      if (error) throw error;

      return org as Organization;
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  return (
    <OrganizationContext.Provider 
      value={{ 
        organization: organization ?? null, 
        isLoading, 
        error: error as Error | null,
        refetch,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}