import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { Database } from "@/integrations/supabase/types";

type WorkflowType = Database["public"]["Enums"]["workflow_type"];

// Types for ticker items
export interface TickerItem {
  id: string;
  work_item_id: string;
  workflow_type: string;
  radicado: string | null;
  authority_name: string | null;
  parties_summary: string;
  act_date: string | null;
  act_description: string;
  act_type: string | null;
  source: string | null;
  created_at: string;
}

// Ticker configuration for future extensibility
export interface TickerConfig {
  fields_to_show: string[];
  filters: {
    only_flagged?: boolean;
    only_urgent?: boolean;
    workflow_types?: WorkflowType[];
  };
  max_items: number;
  refresh_seconds: number;
}

// Included workflow types for ticker (exclude PETICION, GOV_PROCEDURE)
const TICKER_WORKFLOW_TYPES: WorkflowType[] = ["CGP", "TUTELA", "LABORAL", "CPACA"];

// Default configuration
export const DEFAULT_TICKER_CONFIG: TickerConfig = {
  fields_to_show: ["workflow_type", "radicado", "authority_name", "act_description", "act_date"],
  filters: {
    only_flagged: false,
    only_urgent: false,
    workflow_types: TICKER_WORKFLOW_TYPES,
  },
  max_items: 30,
  refresh_seconds: 60,
};

/**
 * Hook to fetch ticker settings from organization
 */
export function useTickerSettings() {
  const { organization } = useOrganization();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["ticker-settings", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return { show_estados_ticker: true };

      const { data, error } = await supabase
        .from("organizations")
        .select("show_estados_ticker")
        .eq("id", organization.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching ticker settings:", error);
        return { show_estados_ticker: true };
      }

      return data;
    },
    enabled: !!organization?.id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    showTicker: settings?.show_estados_ticker ?? true,
    isLoading,
  };
}

/**
 * Hook to toggle ticker visibility
 */
export function useToggleTickerSetting() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (showTicker: boolean) => {
      if (!organization?.id) throw new Error("No organization");

      const { error } = await supabase
        .from("organizations")
        .update({ show_estados_ticker: showTicker })
        .eq("id", organization.id);

      if (error) throw error;
      return showTicker;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticker-settings"] });
      queryClient.invalidateQueries({ queryKey: ["current-organization"] });
    },
  });
}

/**
 * Main hook to fetch ticker items (latest estados)
 */
export function useTickerEstados(config: TickerConfig = DEFAULT_TICKER_CONFIG) {
  const { organization } = useOrganization();
  const { showTicker } = useTickerSettings();

  return useQuery({
    queryKey: ["ticker-estados", organization?.id],
    queryFn: async (): Promise<TickerItem[]> => {
      // Get the current user to find their work items
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // Fetch latest work_item_acts joined with work_items
      // Filter by workflow types included in ticker
      const { data: acts, error } = await supabase
        .from("work_item_acts")
        .select(`
          id,
          work_item_id,
          act_date,
          description,
          act_type,
          source,
          created_at,
          work_items!inner (
            id,
            workflow_type,
            radicado,
            authority_name,
            demandantes,
            demandados,
            deleted_at
          )
        `)
        .eq("owner_id", user.id)
        .is("work_items.deleted_at", null)
        .in("work_items.workflow_type", config.filters.workflow_types ?? TICKER_WORKFLOW_TYPES)
        .order("created_at", { ascending: false })
        .limit(config.max_items * 2); // Fetch extra to deduplicate

      if (error) {
        console.error("Error fetching ticker items:", error);
        return [];
      }

      if (!acts || acts.length === 0) return [];

      // Deduplicate by work_item_id + act_description + act_date
      const seen = new Set<string>();
      const uniqueItems: TickerItem[] = [];

      for (const act of acts) {
        const workItem = act.work_items as any;
        if (!workItem) continue;

        // Create dedup key
        const dedupKey = `${act.work_item_id}-${act.description}-${act.act_date}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        // Build parties summary (truncated)
        const demandantes = workItem.demandantes || "";
        const demandados = workItem.demandados || "";
        let partiesSummary = "";
        
        if (demandantes && demandados) {
          const d1 = demandantes.split(";")[0]?.trim().slice(0, 25) || "";
          const d2 = demandados.split(";")[0]?.trim().slice(0, 25) || "";
          partiesSummary = `${d1} vs ${d2}`;
          if (partiesSummary.length > 50) {
            partiesSummary = partiesSummary.slice(0, 47) + "...";
          }
        } else if (demandantes) {
          partiesSummary = demandantes.split(";")[0]?.trim().slice(0, 30) || "";
        }

        uniqueItems.push({
          id: act.id,
          work_item_id: act.work_item_id,
          workflow_type: workItem.workflow_type,
          radicado: workItem.radicado,
          authority_name: workItem.authority_name,
          parties_summary: partiesSummary,
          act_date: act.act_date,
          act_description: act.description || "",
          act_type: act.act_type,
          source: act.source,
          created_at: act.created_at,
        });

        if (uniqueItems.length >= config.max_items) break;
      }

      return uniqueItems;
    },
    enabled: !!organization?.id && showTicker,
    refetchInterval: config.refresh_seconds * 1000,
    staleTime: (config.refresh_seconds * 1000) / 2,
  });
}

/**
 * Format a ticker item into display text
 */
export function formatTickerItem(item: TickerItem): string {
  const parts: string[] = [];
  
  // Workflow type badge
  parts.push(`[${item.workflow_type}]`);
  
  // Radicado (shortened if needed)
  if (item.radicado) {
    const rad = item.radicado.length > 23 
      ? item.radicado.slice(0, 23) 
      : item.radicado;
    parts.push(rad);
  }
  
  // Authority (shortened)
  if (item.authority_name) {
    const auth = item.authority_name.length > 40 
      ? item.authority_name.slice(0, 37) + "..." 
      : item.authority_name;
    parts.push(`— ${auth}`);
  }
  
  // Act description (shortened)
  if (item.act_description) {
    const desc = item.act_description.length > 50 
      ? item.act_description.slice(0, 47) + "..." 
      : item.act_description;
    parts.push(`— ${desc}`);
  }
  
  // Date
  if (item.act_date) {
    parts.push(`— ${item.act_date}`);
  }
  
  return parts.join(" ");
}
