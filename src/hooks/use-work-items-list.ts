import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WorkItem } from "@/types/work-item";
import type { WorkflowType } from "@/lib/workflow-constants";
import { matchesQuery, rankOf, type SearchableWorkItem } from "@/lib/search/normalized-search";

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
 * Hook to fetch work items for the Processes list page.
 * Uses the canonical `work_items` Supabase table as the single source of truth.
 * External enrichment from per-provider APIs has been removed; the daily
 * server-side sync-jobs are responsible for hydrating these rows.
 */
export function useWorkItemsList(options: UseWorkItemsListOptions = {}) {
  const { filters, enabled = true } = options;

  // 1. Primary query: all work items from Supabase
  const supabaseQuery = useQuery({
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
          demonitor_reason,
          consecutive_404_count,
          provider_reachable,
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
            name,
            id_number
          )
        `)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });

      if (filters?.workflowTypes && filters.workflowTypes.length > 0) {
        query = query.in("workflow_type", filters.workflowTypes as any);
      }
      if (filters?.clientId) {
        query = query.eq("client_id", filters.clientId);
      }
      if (filters?.hasClient === true) {
        query = query.not("client_id", "is", null);
      } else if (filters?.hasClient === false) {
        query = query.is("client_id", null);
      }

      const { data, error } = await query;
      if (error) throw error;

      let items = data as unknown as WorkItem[];

      // Same normalized rules as the global search: radicado in any form
      // (hyphenated, spaced, 21/22-digit, partial), accent-insensitive text,
      // multi-token AND across radicado, partes, despacho, ciudad, tipo,
      // etapa, cliente and su identificación.
      const term = filters?.search?.trim();
      if (term) {
        const toSearchable = (item: WorkItem): SearchableWorkItem => ({
          radicado: item.radicado,
          title: item.title,
          demandantes: item.demandantes,
          demandados: item.demandados,
          authority_name: item.authority_name,
          authority_city: item.authority_city,
          workflow_type: item.workflow_type,
          stage: item.stage,
          client_name: item.clients?.name ?? null,
          client_id_number: (item.clients as { id_number?: string | null } | null)?.id_number ?? null,
        });

        items = items
          .filter((item) => matchesQuery(toSearchable(item), term))
          .sort((a, b) => rankOf(toSearchable(a), term) - rankOf(toSearchable(b), term));
      }

      return items;
    },
    enabled,
  });

  // 2. Secondary query: CPNU enrichment from external API
  return supabaseQuery;
}
