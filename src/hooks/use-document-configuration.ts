/**
 * Hook to fetch and manage document configuration settings per org/user.
 * Resolution priority: User override > Org config > System defaults.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type IdType = "CC" | "NIT";

export interface FieldOverride {
  required?: boolean;
  hidden?: boolean;
  default_value?: string;
}

export interface DocumentConfiguration {
  id?: string;
  document_type: string;
  field_overrides: Record<string, FieldOverride>;
  enabled_sections: Record<string, boolean>;
  default_values: Record<string, string>;
  default_lawyer_id_type: IdType;
  default_client_id_type: IdType;
}

const EMPTY_CONFIG: DocumentConfiguration = {
  document_type: "",
  field_overrides: {},
  enabled_sections: {},
  default_values: {},
  default_lawyer_id_type: "CC",
  default_client_id_type: "CC",
};

export function useDocumentConfiguration(
  documentType: string,
  organizationId: string | null | undefined,
) {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ["document-configuration", documentType, organizationId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Try user-level override first
      const { data: userConfig } = await (supabase
        .from("document_configurations" as any)
        .select("*")
        .eq("document_type", documentType)
        .eq("user_id", user.id)
        .maybeSingle() as any);

      if (userConfig) return userConfig as DocumentConfiguration;

      // Fall back to org-level config
      if (organizationId) {
        const { data: orgConfig } = await (supabase
          .from("document_configurations" as any)
          .select("*")
          .eq("document_type", documentType)
          .eq("organization_id", organizationId)
          .is("user_id", null)
          .maybeSingle() as any);

        if (orgConfig) return orgConfig as DocumentConfiguration;
      }

      return null;
    },
    enabled: !!documentType,
  });

  const resolved: DocumentConfiguration = {
    ...EMPTY_CONFIG,
    document_type: documentType,
    ...(config || {}),
  };

  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<DocumentConfiguration> & { scope: "org" | "user" }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const record: any = {
        document_type: documentType,
        field_overrides: updates.field_overrides ?? resolved.field_overrides,
        enabled_sections: updates.enabled_sections ?? resolved.enabled_sections,
        default_values: updates.default_values ?? resolved.default_values,
        default_lawyer_id_type: updates.default_lawyer_id_type ?? resolved.default_lawyer_id_type,
        default_client_id_type: updates.default_client_id_type ?? resolved.default_client_id_type,
      };

      if (updates.scope === "org" && organizationId) {
        record.organization_id = organizationId;
        record.user_id = null;
      } else {
        record.user_id = user.id;
        record.organization_id = null;
      }

      const { error } = await (supabase
        .from("document_configurations" as any)
        .upsert(record, { onConflict: "organization_id,document_type,user_id" }) as any);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-configuration"] });
      toast.success("Configuración de documento guardada");
    },
    onError: (err) => toast.error("Error: " + (err as Error).message),
  });

  const isFieldRequired = (fieldKey: string, systemRequired: boolean): boolean => {
    const override = resolved.field_overrides[fieldKey];
    if (override?.required !== undefined) return override.required;
    return systemRequired;
  };

  const isFieldHidden = (fieldKey: string): boolean => {
    return resolved.field_overrides[fieldKey]?.hidden === true;
  };

  const isSectionEnabled = (sectionKey: string, defaultEnabled = true): boolean => {
    if (resolved.enabled_sections[sectionKey] !== undefined) {
      return resolved.enabled_sections[sectionKey];
    }
    return defaultEnabled;
  };

  return {
    config: resolved,
    isLoading,
    save: saveMutation.mutate,
    isSaving: saveMutation.isPending,
    isFieldRequired,
    isFieldHidden,
    isSectionEnabled,
  };
}
