/**
 * useBranding — Resolves custom branding (logo + firm name) for the current user/org.
 * Priority: Organization branding > Individual branding > Andromeda default.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface Branding {
  logoUrl: string | null;
  firmName: string;
  isCustom: boolean;
}

const DEFAULT_BRANDING: Branding = {
  logoUrl: null,
  firmName: "Andromeda Legal",
  isCustom: false,
};

function getStorageUrl(path: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/branding/${path}`;
}

export function useBranding(): { branding: Branding; isLoading: boolean } {
  const { organization } = useOrganization();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["branding-profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("custom_logo_path, custom_firm_name, custom_branding_enabled, full_name")
        .eq("id", user.id)
        .single();
      return data;
    },
  });

  const branding: Branding = (() => {
    // Priority 1: Organization branding
    if (organization && (organization as any).custom_branding_enabled && (organization as any).custom_logo_path) {
      return {
        logoUrl: getStorageUrl((organization as any).custom_logo_path),
        firmName: (organization as any).custom_firm_name || organization.name,
        isCustom: true,
      };
    }
    // Priority 2: Individual branding
    if (profile?.custom_branding_enabled && profile?.custom_logo_path) {
      return {
        logoUrl: getStorageUrl(profile.custom_logo_path),
        firmName: profile.custom_firm_name || profile.full_name || "Mi Firma",
        isCustom: true,
      };
    }
    // Priority 3: Default
    return DEFAULT_BRANDING;
  })();

  return { branding, isLoading: profileLoading };
}

/**
 * Resolve branding for a specific organization (used in edge functions / server-side context).
 */
export function getBrandingFromData(
  org: { custom_branding_enabled?: boolean; custom_logo_path?: string; custom_firm_name?: string; name?: string } | null,
  profile: { custom_branding_enabled?: boolean; custom_logo_path?: string; custom_firm_name?: string; full_name?: string } | null
): Branding {
  if (org?.custom_branding_enabled && org?.custom_logo_path) {
    return {
      logoUrl: getStorageUrl(org.custom_logo_path),
      firmName: org.custom_firm_name || org.name || "Andromeda Legal",
      isCustom: true,
    };
  }
  if (profile?.custom_branding_enabled && profile?.custom_logo_path) {
    return {
      logoUrl: getStorageUrl(profile.custom_logo_path),
      firmName: profile.custom_firm_name || profile.full_name || "Mi Firma",
      isCustom: true,
    };
  }
  return DEFAULT_BRANDING;
}
