/**
 * use-work-item-party-role.ts — the capacity in which our client acts (iter 50).
 *
 * The role may be PROPOSED by name matching against the parties, but it only
 * becomes authoritative when the user confirms it: getting it wrong inverts
 * every term on the matter.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClientPartyRole } from "@/lib/workflow-terms/party-attribution";
import type { RepresentedParty } from "@/lib/workflow-terms/party-attribution";
import { isClientPartyRole } from "@/lib/workflow-terms/party-attribution";

export interface WorkItemPartyRole {
  role: ClientPartyRole | null;
  /** PROPUESTO = suggestion awaiting confirmation. CONFIRMADO = user-owned. */
  source: "PROPUESTO" | "CONFIRMADO" | null;
  confidence: number | null;
  basis: string | null;
  /** Party represented when the client acts as curador ad litem. */
  represents: RepresentedParty | null;
  clientName: string | null;
  demandantes: string | null;
  demandados: string | null;
}

const key = (id: string | null | undefined) => ["work-item-party-role", id];

export function useWorkItemPartyRole(workItemId: string | undefined | null) {
  return useQuery({
    queryKey: key(workItemId),
    enabled: !!workItemId,
    staleTime: 60_000,
    queryFn: async (): Promise<WorkItemPartyRole> => {
      const { data, error } = await supabase
        .from("work_items")
        .select(
          "client_party_role, client_party_role_source, client_party_role_confidence, client_party_role_basis, demandantes, demandados, clients(name)",
        // client_party_represents is selected separately below to keep the
        // generated types happy on older schema snapshots.
        )
        .eq("id", workItemId!)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? {}) as Record<string, unknown>;
      const client = row.clients as { name?: string } | null | undefined;
      const src = row.client_party_role_source;
      return {
        role: isClientPartyRole(row.client_party_role) ? row.client_party_role : null,
        source: src === "PROPUESTO" || src === "CONFIRMADO" ? src : null,
        confidence:
          typeof row.client_party_role_confidence === "number"
            ? row.client_party_role_confidence
            : row.client_party_role_confidence != null
              ? Number(row.client_party_role_confidence)
              : null,
        basis: typeof row.client_party_role_basis === "string" ? row.client_party_role_basis : null,
        represents:
          row.client_party_represents === "DEMANDANTE" || row.client_party_represents === "DEMANDADO"
            ? (row.client_party_represents as RepresentedParty)
            : null,
        clientName: client?.name ?? null,
        demandantes: typeof row.demandantes === "string" ? row.demandantes : null,
        demandados: typeof row.demandados === "string" ? row.demandados : null,
      };
    },
  });
}

export function useSetWorkItemPartyRole(workItemId: string | undefined | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClientPartyRole | { role: ClientPartyRole; represents?: RepresentedParty | null }) => {
      const role = typeof input === "string" ? input : input.role;
      const represents = typeof input === "string" ? undefined : input.represents;
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("work_items")
        .update({
          client_party_role: role,
          client_party_role_source: "CONFIRMADO",
          client_party_role_confirmed_at: new Date().toISOString(),
          client_party_role_confirmed_by: auth.user?.id ?? null,
          ...(represents !== undefined ? { client_party_represents: represents } : {}),
        } as never)
        .eq("id", workItemId!);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key(workItemId) }),
        queryClient.invalidateQueries({ queryKey: ["work-item-deadlines", workItemId] }),
      ]);
    },
  });
}
