/**
 * monitoring-matrix.ts — frontend mirror of the DB routing matrix
 * (public.provider_chain_for_workflow / is_provider_monitored_workflow).
 *
 * Monitoring is derived from the workflow type, never asked of the user.
 */

export const PROVIDER_CHAIN_BY_WORKFLOW: Record<string, string[]> = {
  CGP: ["cpnu", "publicaciones"],
  LABORAL: ["cpnu", "publicaciones"],
  PENAL: ["cpnu", "publicaciones"],
  PENAL_906: ["cpnu", "publicaciones"],
  CPACA: ["samai", "samai_estados"],
  TUTELA: ["cpnu", "samai", "publicaciones", "samai_estados"],
};

export function providerChainFor(workflowType?: string | null): string[] {
  if (!workflowType) return [];
  return PROVIDER_CHAIN_BY_WORKFLOW[workflowType.toUpperCase()] ?? [];
}

export function isProviderMonitoredWorkflow(workflowType?: string | null): boolean {
  return providerChainFor(workflowType).length > 0;
}
