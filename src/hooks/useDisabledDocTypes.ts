/**
 * useDisabledDocTypes — Reads disabled document types from org feature flags.
 *
 * Looks for `disabled_doc_types` (string[]) in org_integration_settings.feature_flags.
 * Returns an empty array if no setting exists (all doc types enabled by default).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { DocumentPolicyType } from "@/lib/document-policy";

export function useDisabledDocTypes(): DocumentPolicyType[] {
  const { organization } = useOrganization();

  const { data } = useQuery({
    queryKey: ["org-disabled-doc-types", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from("org_integration_settings")
        .select("feature_flags")
        .eq("organization_id", organization.id)
        .maybeSingle();
      if (error || !data) return [];
      const flags = data.feature_flags as Record<string, unknown> | null;
      const disabled = flags?.disabled_doc_types;
      if (Array.isArray(disabled)) return disabled as DocumentPolicyType[];
      return [];
    },
    enabled: !!organization?.id,
    staleTime: 1000 * 60 * 10,
  });

  return data ?? [];
}
