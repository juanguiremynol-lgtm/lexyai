/**
 * use-party-capacity.ts — ITER56.
 *
 * The portfolio-wide capacity confirmation, read once and shared by the banner
 * and the onboarding screen so both agree on the remaining count.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  ClientPartyRole,
  RepresentedParty,
} from "@/lib/workflow-terms/party-attribution";
import {
  classifyCapacityRow,
  computeAttributionConsequence,
  noProposalReason,
  type CapacityRowInput,
  type CapacitySection,
  type DeadlineAttributionInput,
  type NoProposalReason,
} from "@/lib/workflow-terms/party-capacity";

export interface CapacityRow extends CapacityRowInput {
  section: CapacitySection;
  reason: NoProposalReason | null;
  deadlines: DeadlineAttributionInput[];
}

export const PARTY_CAPACITY_KEY = ["party-capacity-pending"];

async function fetchCapacityRows(): Promise<CapacityRow[]> {
  const { data, error } = await supabase
    .from("work_items")
    .select(
      "id, radicado, client_id, demandantes, demandados, client_party_role, client_party_role_source, client_party_role_confidence, client_party_role_basis, client_party_represents, clients(name)",
    )
    .eq("lifecycle_state", "ACTIVE")
    .order("radicado", { ascending: true });
  if (error) throw error;

  const rows = ((data ?? []) as unknown as Record<string, unknown>[])
    .filter((r) => r.client_party_role_source !== "CONFIRMADO")
    .map<CapacityRowInput>((r) => ({
      id: String(r.id),
      radicado: (r.radicado as string) ?? null,
      clientName: ((r.clients as { name?: string } | null)?.name as string) ?? null,
      hasClient: r.client_id != null,
      demandantes: (r.demandantes as string) ?? null,
      demandados: (r.demandados as string) ?? null,
      role: (r.client_party_role as ClientPartyRole) ?? null,
      confidence: Number(r.client_party_role_confidence ?? 0),
      basis: (r.client_party_role_basis as string) ?? null,
      represents: (r.client_party_represents as RepresentedParty) ?? null,
    }));

  const ids = rows.map((r) => r.id);
  const byItem = new Map<string, DeadlineAttributionInput[]>();
  if (ids.length > 0) {
    const { data: dl, error: dlErr } = await supabase
      .from("work_item_deadlines")
      .select("work_item_id, bound_party_role, is_judge_side, status")
      .in("work_item_id", ids);
    if (dlErr) throw dlErr;
    for (const d of ((dl ?? []) as unknown as Record<string, unknown>[])) {
      const wid = String(d.work_item_id);
      const list = byItem.get(wid) ?? [];
      list.push({
        bound_party_role: (d.bound_party_role as string) ?? null,
        is_judge_side: (d.is_judge_side as boolean) ?? null,
      });
      byItem.set(wid, list);
    }
  }

  return rows.map((r) => {
    const section = classifyCapacityRow(r);
    return {
      ...r,
      section,
      reason: section === "SIN_PROPUESTA" ? noProposalReason(r) : null,
      deadlines: byItem.get(r.id) ?? [],
    };
  });
}

export function usePartyCapacityRows() {
  return useQuery({
    queryKey: PARTY_CAPACITY_KEY,
    staleTime: 30_000,
    queryFn: fetchCapacityRows,
  });
}

/** Cheap count for the banner — no deadline join. */
export function usePendingCapacityCount() {
  return useQuery({
    queryKey: ["party-capacity-count"],
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("work_items")
        .select("id", { count: "exact", head: true })
        .eq("lifecycle_state", "ACTIVE")
        .neq("client_party_role_source", "CONFIRMADO");
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export interface ConfirmInput {
  row: CapacityRow;
  role: ClientPartyRole;
  represents: RepresentedParty | null;
}

export interface ConfirmResult {
  confirmed: number;
  deadlinesChanged: number;
  alertsRetired: number;
}

export function useConfirmCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: ConfirmInput[]): Promise<ConfirmResult> => {
      const { data: auth } = await supabase.auth.getUser();
      let deadlinesChanged = 0;
      let alertsRetired = 0;
      for (const { row, role, represents } of items) {
        const isOverride = !!row.role && role !== row.role;
        const { error } = await supabase
          .from("work_items")
          .update({
            client_party_role: role,
            client_party_role_source: "CONFIRMADO",
            client_party_role_confirmed_at: new Date().toISOString(),
            client_party_role_confirmed_by: auth.user?.id ?? null,
            client_party_represents: role === "APODERADO_DE_OFICIO" ? represents : null,
            client_party_role_overridden: isOverride,
            client_party_role_proposed: isOverride ? row.role : null,
            client_party_role_override_confidence: isOverride ? row.confidence : null,
          } as never)
          .eq("id", row.id);
        if (error) throw error;

        deadlinesChanged += computeAttributionConsequence(row.deadlines, role, represents).changed;

        // The effect must be visible in this session, not after the next cron.
        const { data: res } = await supabase.functions.invoke("evaluate-deadline-alerts", {
          body: { work_item_id: row.id },
        });
        const retired = Number((res as { alerts_retired?: number } | null)?.alerts_retired ?? 0);
        if (Number.isFinite(retired)) alertsRetired += retired;
      }
      return { confirmed: items.length, deadlinesChanged, alertsRetired };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PARTY_CAPACITY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["party-capacity-count"] }),
        queryClient.invalidateQueries({ queryKey: ["work-item-party-role"] }),
        queryClient.invalidateQueries({ queryKey: ["work-item-deadlines"] }),
      ]);
    },
  });
}
