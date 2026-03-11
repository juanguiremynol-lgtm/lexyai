import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { WorkItem } from "@/types/work-item";
import type { WorkflowType } from "@/lib/workflow-constants";

const CPNU_API_URL = "https://cpnu-read-api-486431576619.us-central1.run.app/work-items";

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

interface CpnuApiItem {
  work_item_id: string;
  radicado: string | null;
  status: string | null;
  monitoring_enabled: boolean;
  cpnu_status: string | null;
  cpnu_total_procesos: number | null;
  cpnu_total_sujetos: number | null;
  cpnu_total_actuaciones: number | null;
  cpnu_last_sync_at: string | null;
  ultimo_run_status: string | null;
  ultimo_run_has_novedad: boolean | null;
  tipo_novedad: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  ultima_novedad_descripcion: string | null;
  ultima_novedad_revisada: boolean | null;
  ultima_novedad_fecha: string | null;
}

/**
 * Hook to fetch work items for the Processes list page
 * Uses work_items as the single source of truth
 * CPNU items are enriched with data from external API
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
            name
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
            radicadoMatch || authorityMatch || cityMatch ||
            demandantesMatch || demandadosMatch || titleMatch || clientMatch
          );
        });
      }

      return items;
    },
    enabled,
  });

  // 2. Secondary query: CPNU enrichment from external API
  const cpnuQuery = useQuery({
    queryKey: ["cpnu-enrichment"],
    queryFn: async (): Promise<Map<string, CpnuApiItem>> => {
      const res = await fetch(CPNU_API_URL);
      if (!res.ok) throw new Error(`CPNU API error: ${res.status}`);
      const json = await res.json();
      if (!json.ok || !Array.isArray(json.items)) {
        throw new Error("CPNU API returned unexpected format");
      }
      const map = new Map<string, CpnuApiItem>();
      for (const item of json.items as CpnuApiItem[]) {
        map.set(item.work_item_id, item);
      }
      return map;
    },
    enabled,
    staleTime: 60_000,
  });

  // 3. Merge: enrich items found in CPNU API
  const mergedData = useMemo(() => {
    const items = supabaseQuery.data;
    if (!items) return undefined;

    const cpnuMap = cpnuQuery.data;
    if (!cpnuMap || cpnuMap.size === 0) return items;

    return items.map((item): WorkItem => {

      const enrichment = cpnuMap.get(item.id);
      if (!enrichment) return item;

      return {
        ...item,
        last_checked_at: enrichment.cpnu_last_sync_at ?? item.last_checked_at,
        total_actuaciones: enrichment.cpnu_total_actuaciones ?? item.total_actuaciones,
        monitoring_enabled: enrichment.monitoring_enabled ?? item.monitoring_enabled,
        // CPNU-specific enrichment fields
        cpnu_status: enrichment.cpnu_status,
        cpnu_total_procesos: enrichment.cpnu_total_procesos,
        cpnu_total_sujetos: enrichment.cpnu_total_sujetos,
        ultimo_run_status: enrichment.ultimo_run_status,
        ultimo_run_has_novedad: enrichment.ultimo_run_has_novedad,
        tipo_novedad: enrichment.tipo_novedad,
        valor_anterior: enrichment.valor_anterior,
        valor_nuevo: enrichment.valor_nuevo,
        ultima_novedad_descripcion: enrichment.ultima_novedad_descripcion,
        ultima_novedad_revisada: enrichment.ultima_novedad_revisada,
        ultima_novedad_fecha: enrichment.ultima_novedad_fecha,
      };
    });
  }, [supabaseQuery.data, cpnuQuery.data]);

  // 5. Return same interface — consumers see no difference
  return {
    ...supabaseQuery,
    data: mergedData,
    isLoading: supabaseQuery.isLoading || (hasCpnuItems && cpnuQuery.isLoading),
  };
}
