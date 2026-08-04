/**
 * Iteration 13.1 — "Expedientes sin monitoreo" review list.
 *
 * Silence must never be mistaken for absence of movement: this hook surfaces
 * every non-deleted work item whose monitoring is off, together with its stage,
 * last actuación and whether the stage is procedurally live.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setWorkItemLifecycle } from "@/lib/lifecycle";
import { toast } from "sonner";

export interface UnmonitoredWorkItem {
  work_item_id: string;
  radicado: string | null;
  title: string | null;
  workflow_type: string | null;
  stage: string | null;
  lifecycle_state: string | null;
  organization_id: string | null;
  last_act_date: string | null;
  last_act_description: string | null;
  last_ingest: string | null;
  procedurally_live: boolean;
  monitoring_disabled_reason: string | null;
  monitoring_disabled_by: string | null;
  monitoring_disabled_at: string | null;
}

export function useUnmonitoredWorkItems() {
  return useQuery({
    queryKey: ["unmonitored-work-items"],
    queryFn: async (): Promise<UnmonitoredWorkItem[]> => {
      const { data, error } = await (supabase as any).rpc("list_unmonitored_work_items");
      if (error) throw error;
      return (data ?? []) as UnmonitoredWorkItem[];
    },
  });
}

/**
 * Manual reactivation only. Provider enrolment stays governed by the routing
 * matrix (CPACA→SAMAI exclusive; CGP/Penal/Laboral→CPNU+PP; TUTELA→full union),
 * which the server-side sync layer applies on the next run.
 */
export function useActivateMonitoring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (workItemId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const r = await setWorkItemLifecycle(supabase, {
        workItemId,
        newState: "ACTIVE",
        reason: "USER_REACTIVATE_FROM_REVIEW_LIST",
        actor: "USER",
        actorUserId: user?.id ?? null,
      });
      if (!r.ok) throw new Error("No fue posible reactivar el monitoreo");
      const { error } = await (supabase.from("work_items") as any)
        .update({
          monitoring_enabled: true,
          demonitor_reason: null,
          demonitor_at: null,
          consecutive_404_count: 0,
          provider_reachable: true,
        })
        .eq("id", workItemId);
      if (error) throw error;
      return workItemId;
    },
    onSuccess: () => {
      toast.success("Monitoreo reactivado. Se sincronizará en el próximo ciclo programado.");
      qc.invalidateQueries({ queryKey: ["unmonitored-work-items"] });
      qc.invalidateQueries({ queryKey: ["work-items-list"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error al reactivar el monitoreo"),
  });
}
