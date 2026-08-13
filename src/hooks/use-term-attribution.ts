/**
 * use-term-attribution.ts — ITER53.
 *
 * The single place a work item's term attribution is computed. Acción
 * requerida, Términos del expediente and the unattributed block all call this
 * hook, so the same term can never read "suya" in one card and "sin parte
 * determinada" in another.
 */
import { useCallback } from "react";
import { useWorkItemPartyRole } from "@/hooks/use-work-item-party-role";
import {
  resolveTermAttribution,
  type ClientPartyRole,
  type ResolvedTermAttribution,
  type TermAttributionInput,
} from "@/lib/workflow-terms/party-attribution";

export function useTermAttribution(workItemId: string | undefined | null) {
  const { data: partyRole } = useWorkItemPartyRole(workItemId);
  const confirmedRole: ClientPartyRole | null =
    partyRole?.source === "CONFIRMADO" ? partyRole.role : null;
  const represents = partyRole?.represents ?? null;

  const resolve = useCallback(
    (input: TermAttributionInput): ResolvedTermAttribution =>
      resolveTermAttribution(input, confirmedRole, represents),
    [confirmedRole, represents],
  );

  return { partyRole, confirmedRole, resolve };
}
