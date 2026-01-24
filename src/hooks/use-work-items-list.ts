import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WorkItem } from "@/types/work-item";
import type { WorkflowType } from "@/lib/workflow-constants";

export interface WorkItemListFilters {
  search?: string;
  workflowTypes?: WorkflowType[];
  clientId?: string;
  hasClient?: boolean;
}

export interface UseWorkItemsListOptions {
  filters?: WorkItemListFilters;
  enabled?: boolean;
}

/**
 * Hook to fetch work items for the Processes list page
 * Uses work_items as the single source of truth
 */
export function useWorkItemsList(options: UseWorkItemsListOptions = {}) {
  const { filters, enabled = true } = options;

  return useQuery({
    queryKey: ["work-items-list", filters],
    queryFn: async () => {
      let query = supabase
        .from("work_items")
        .select(`
          id,
          owner_id,
          workflow_type,
          stage,
          status,
          cgp_phase,
          radicado,
          radicado_verified,
          authority_name,
          authority_city,
          authority_department,
          demandantes,
          demandados,
          title,
          description,
          is_flagged,
          monitoring_enabled,
          last_action_date,
          last_action_description,
          last_checked_at,
          total_actuaciones,
          source,
          created_at,
          updated_at,
          client_id,
          clients:client_id (
            id,
            name
          )
        `)
        .order("updated_at", { ascending: false });

      // Filter by workflow types if specified
      if (filters?.workflowTypes && filters.workflowTypes.length > 0) {
        query = query.in("workflow_type", filters.workflowTypes);
      }

      // Filter by client if specified
      if (filters?.clientId) {
        query = query.eq("client_id", filters.clientId);
      }

      // Filter by has client
      if (filters?.hasClient === true) {
        query = query.not("client_id", "is", null);
      } else if (filters?.hasClient === false) {
        query = query.is("client_id", null);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Apply search filter in memory for flexible matching
      let items = data as WorkItem[];

      if (filters?.search) {
        const searchLower = filters.search.toLowerCase().trim();
        items = items.filter((item) => {
          const radicadoMatch = item.radicado?.toLowerCase().includes(searchLower);
          const authorityMatch = item.authority_name?.toLowerCase().includes(searchLower);
          const cityMatch = item.authority_city?.toLowerCase().includes(searchLower);
          const demandantesMatch = item.demandantes?.toLowerCase().includes(searchLower);
          const demandadosMatch = item.demandados?.toLowerCase().includes(searchLower);
          const titleMatch = item.title?.toLowerCase().includes(searchLower);
          const clientMatch = item.clients?.name?.toLowerCase().includes(searchLower);
          
          return (
            radicadoMatch ||
            authorityMatch ||
            cityMatch ||
            demandantesMatch ||
            demandadosMatch ||
            titleMatch ||
            clientMatch
          );
        });
      }

      return items;
    },
    enabled,
  });
}
