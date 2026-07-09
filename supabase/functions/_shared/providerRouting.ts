/**
 * providerRouting.ts — Deterministic per-category provider resolver.
 *
 * SINGLE SOURCE OF TRUTH for which external provider services a work item
 * category MAY consult, per the Doctor's strict routing rule:
 *
 *   ┌──────────┬──────────────────┬──────────────────────────┐
 *   │ Workflow │ Actuaciones      │ Estados                  │
 *   ├──────────┼──────────────────┼──────────────────────────┤
 *   │ CPACA    │ SAMAI            │ SAMAI_ESTADOS            │
 *   │ CGP      │ CPNU             │ PP (Publicaciones)       │
 *   │ PENAL_906│ CPNU             │ PP                       │
 *   │ LABORAL  │ CPNU             │ PP                       │
 *   │ TUTELA   │ CPNU             │ PP                       │
 *   └──────────┴──────────────────┴──────────────────────────┘
 *
 * Mnemonic: SAMAI + SAMAI_ESTADOS are EXCLUSIVE to CPACA. Everything else
 * uses CPNU (actuaciones) + PP (estados).
 *
 * Hard corollaries — enforced by every dispatcher via this resolver:
 *   • A CPACA work item NEVER queries CPNU or PP.
 *   • A non-CPACA work item NEVER queries SAMAI or SAMAI_ESTADOS.
 *
 * All sync dispatchers (sync-by-work-item, sync-publicaciones-by-work-item,
 * syncOrchestrator, provider-sync-external-provider, cpnu-job-poller, and
 * any adapter selector) MUST derive provider selection from `resolveProviders`
 * — no ad-hoc lists, no silent defaults.
 *
 * Related docs:
 *   • .memory/business/workflow-aware-provider-selection-rules.md
 *   • docs/sync-routing-map.md
 */

export type ActuacionesProvider = "CPNU" | "SAMAI";
export type EstadosProvider = "PP" | "SAMAI_ESTADOS";

export interface ProviderRouting {
  actuaciones: ActuacionesProvider | null;
  estados: EstadosProvider | null;
  eligible: boolean;
  reason: string;
}

/**
 * Canonical routing table. `null` means the category has no external judicial
 * provider for that data kind (internal-only state, e.g. PETICION).
 */
const ROUTING_TABLE: Record<string, ProviderRouting> = {
  CPACA:     { actuaciones: "SAMAI", estados: "SAMAI_ESTADOS", eligible: true, reason: "CPACA_ROUTE" },
  CGP:       { actuaciones: "CPNU",  estados: "PP",            eligible: true, reason: "CGP_ROUTE" },
  LABORAL:   { actuaciones: "CPNU",  estados: "PP",            eligible: true, reason: "LABORAL_ROUTE" },
  TUTELA:    { actuaciones: "CPNU",  estados: "PP",            eligible: true, reason: "TUTELA_ROUTE" },
  PENAL_906: { actuaciones: "CPNU",  estados: "PP",            eligible: true, reason: "PENAL_906_ROUTE" },
  // Internal-only categories — never dispatch to any external provider
  PETICION:       { actuaciones: null, estados: null, eligible: false, reason: "INTERNAL_ONLY" },
  GOV_PROCEDURE:  { actuaciones: null, estados: null, eligible: false, reason: "INTERNAL_ONLY" },
};

/**
 * Resolve the deterministic provider routing for a work item category.
 *
 * Unknown categories return {eligible:false} — the caller MUST treat this as
 * ineligible and log a warning. NEVER silently default to CPNU/PP.
 */
export function resolveProviders(
  workflowType: string | null | undefined,
): ProviderRouting {
  if (!workflowType) {
    console.warn("[providerRouting] resolveProviders called with empty workflow_type — treating as ineligible");
    return { actuaciones: null, estados: null, eligible: false, reason: "MISSING_WORKFLOW_TYPE" };
  }
  const entry = ROUTING_TABLE[workflowType];
  if (!entry) {
    console.warn(`[providerRouting] Unknown workflow_type=${workflowType} — treating as ineligible until classified`);
    return { actuaciones: null, estados: null, eligible: false, reason: `UNKNOWN_WORKFLOW_${workflowType}` };
  }
  return entry;
}

// ── Boolean helpers (never use ad-hoc lists elsewhere) ──

export function usesSamaiActs(wt: string | null | undefined): boolean {
  return resolveProviders(wt).actuaciones === "SAMAI";
}
export function usesCpnuActs(wt: string | null | undefined): boolean {
  return resolveProviders(wt).actuaciones === "CPNU";
}
export function usesSamaiEstados(wt: string | null | undefined): boolean {
  return resolveProviders(wt).estados === "SAMAI_ESTADOS";
}
export function usesPpEstados(wt: string | null | undefined): boolean {
  return resolveProviders(wt).estados === "PP";
}

/**
 * Convenience — categories eligible for the PP (Publicaciones Procesales)
 * estados pipeline. Derived exclusively from ROUTING_TABLE.
 */
export const PP_ESTADOS_WORKFLOWS: readonly string[] = Object.entries(ROUTING_TABLE)
  .filter(([, r]) => r.estados === "PP")
  .map(([wt]) => wt);

/**
 * Convenience — categories eligible for the SAMAI_ESTADOS estados pipeline.
 */
export const SAMAI_ESTADOS_WORKFLOWS: readonly string[] = Object.entries(ROUTING_TABLE)
  .filter(([, r]) => r.estados === "SAMAI_ESTADOS")
  .map(([wt]) => wt);