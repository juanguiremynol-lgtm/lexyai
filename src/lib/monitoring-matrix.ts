/**
 * monitoring-matrix.ts — frontend mirror of the DB routing matrix
 * (public.provider_chain_for_workflow / is_provider_monitored_workflow).
 *
 * Monitoring is derived from the workflow type, never asked of the user.
 */

import { normalizeWorkflowType } from "./workflow-constants";

export const PROVIDER_CHAIN_BY_WORKFLOW: Record<string, string[]> = {
  CGP: ["cpnu", "publicaciones"],
  LABORAL: ["cpnu", "publicaciones"],
  PENAL_906: ["cpnu", "publicaciones"],
  EJECUTIVO: ["cpnu", "publicaciones"],
  CPACA: ["samai", "samai_estados"],
  // Subject matter unknown (mixed-competence court): fan out to every provider
  // until the matter is classified (iteration 18). Mirrors the DB function.
  INDETERMINADO: ["cpnu", "publicaciones", "samai", "samai_estados"],
  TUTELA: ["cpnu", "samai", "publicaciones", "samai_estados"],
};

export function providerChainFor(workflowType?: string | null): string[] {
  if (!workflowType) return [];
  // ITER44 — aliases are resolved in exactly one place (normalizeWorkflowType);
  // the matrix itself only ever holds canonical enum members.
  const key = normalizeWorkflowType(workflowType) ?? workflowType.toUpperCase();
  return PROVIDER_CHAIN_BY_WORKFLOW[key] ?? [];
}

export function isProviderMonitoredWorkflow(workflowType?: string | null): boolean {
  return providerChainFor(workflowType).length > 0;
}
