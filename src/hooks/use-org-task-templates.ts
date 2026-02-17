/**
 * Hook for consuming org task templates (read-only for non-admin users)
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface OrgTaskTemplate {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  default_cadence_days: number | null;
  category: string;
  workflow_types: string[];
}

export function useOrgTaskTemplates(workflowType?: string) {
  const { organization } = useOrganization();

  return useQuery({
    queryKey: ["org-task-templates-active", organization?.id, workflowType],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from("org_task_templates")
        .select("id, title, description, priority, default_cadence_days, category, workflow_types")
        .eq("organization_id", organization.id)
        .eq("is_active", true)
        .order("title");
      if (error) throw error;

      // Filter by workflow type if specified
      const templates = (data || []) as OrgTaskTemplate[];
      if (workflowType) {
        return templates.filter(
          t => !t.workflow_types?.length || t.workflow_types.includes(workflowType)
        );
      }
      return templates;
    },
    enabled: !!organization?.id,
    staleTime: 5 * 60 * 1000,
  });
}
