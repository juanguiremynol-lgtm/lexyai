/**
 * providerStrategy.ts — Centralized provider selection rules per work item category.
 * 
 * Single source of truth used by:
 * - sync-by-radicado (wizard LOOKUP + SYNC_AND_APPLY)
 * - sync-by-work-item (ongoing sync)
 * - providerCoverageMatrix.ts (compatibility gates)
 *
 * ┌────────────┬──────────────────────────────┬──────────────────────────────┐
 * │ Category   │ Actuaciones (primary→fallback)│ Estados (primary→fallback)   │
 * ├────────────┼──────────────────────────────┼──────────────────────────────┤
 * │ CGP        │ CPNU → SAMAI, TUTELAS        │ PUBLICACIONES → SAMAI_EST,TUT│
 * │ LABORAL    │ CPNU → SAMAI, TUTELAS        │ PUBLICACIONES → SAMAI_EST,TUT│
 * │ CPACA      │ SAMAI → CPNU, TUTELAS        │ SAMAI_ESTADOS → PUBS, TUT    │
 * │ TUTELA     │ ALL (merge all)              │ ALL (merge all)              │
 * │ PENAL_906  │ CPNU → TUTELAS, SAMAI        │ PUBLICACIONES → SAMAI_EST,TUT│
 * │ PETICION   │ (none)                       │ (none)                       │
 * │ GOV_PROC   │ (none)                       │ (none)                       │
 * └────────────┴──────────────────────────────┴──────────────────────────────┘
 *
 * Found semantics:
 *   FOUND_COMPLETE  — match + actuaciones/estados retrieved
 *   FOUND_PARTIAL   — match (metadata/parties) but some endpoints failed/timed out
 *   NOT_FOUND       — no provider returned a match for this radicado
 */

export type ProviderKey = "CPNU" | "SAMAI" | "TUTELAS" | "PUBLICACIONES" | "SAMAI_ESTADOS";
export type FoundStatus = "FOUND_COMPLETE" | "FOUND_PARTIAL" | "NOT_FOUND";

export interface CategoryStrategy {
  /** If true, query all providers in parallel and merge. Used for TUTELA. */
  alwaysMergeAll: boolean;
  /** Primary providers for actuaciones + basic metadata (despacho, parties, fecha) */
  primaryActuaciones: ProviderKey[];
  /** Fallback providers for actuaciones (queried only if ALL primaries return NOT_FOUND) */
  fallbackActuaciones: ProviderKey[];
  /** Primary providers for estados tab */
  primaryEstados: ProviderKey[];
  /** Fallback providers for estados (queried only if ALL primaries return NOT_FOUND) */
  fallbackEstados: ProviderKey[];
}

const STRATEGY_MAP: Record<string, CategoryStrategy> = {
  CGP: {
    alwaysMergeAll: false,
    primaryActuaciones: ["CPNU"],
    fallbackActuaciones: ["SAMAI", "TUTELAS"],
    primaryEstados: ["PUBLICACIONES"],
    fallbackEstados: ["SAMAI_ESTADOS", "TUTELAS"],
  },
  LABORAL: {
    alwaysMergeAll: false,
    primaryActuaciones: ["CPNU"],
    fallbackActuaciones: ["SAMAI", "TUTELAS"],
    primaryEstados: ["PUBLICACIONES"],
    fallbackEstados: ["SAMAI_ESTADOS", "TUTELAS"],
  },
  CPACA: {
    alwaysMergeAll: false,
    primaryActuaciones: ["SAMAI"],
    fallbackActuaciones: ["CPNU", "TUTELAS"],
    primaryEstados: ["SAMAI_ESTADOS"],
    fallbackEstados: ["PUBLICACIONES", "TUTELAS"],
  },
  TUTELA: {
    alwaysMergeAll: true,
    primaryActuaciones: ["CPNU", "SAMAI", "TUTELAS"],
    fallbackActuaciones: [],
    primaryEstados: ["PUBLICACIONES", "SAMAI_ESTADOS", "TUTELAS"],
    fallbackEstados: [],
  },
  PENAL_906: {
    alwaysMergeAll: false,
    primaryActuaciones: ["CPNU"],
    fallbackActuaciones: ["TUTELAS", "SAMAI"],
    primaryEstados: ["PUBLICACIONES"],
    fallbackEstados: ["SAMAI_ESTADOS", "TUTELAS"],
  },
  PETICION: {
    alwaysMergeAll: false,
    primaryActuaciones: [],
    fallbackActuaciones: [],
    primaryEstados: [],
    fallbackEstados: [],
  },
  GOV_PROCEDURE: {
    alwaysMergeAll: false,
    primaryActuaciones: [],
    fallbackActuaciones: [],
    primaryEstados: [],
    fallbackEstados: [],
  },
};

/**
 * Returns the provider strategy for a given category/workflow_type.
 */
export function getCategoryStrategy(workflowType: string): CategoryStrategy {
  return STRATEGY_MAP[workflowType] || STRATEGY_MAP["CGP"];
}

/**
 * Determines the FoundStatus based on provider results.
 *
 * @param hasMetadataMatch - At least one provider returned a radicado match (parties/despacho/fecha)
 * @param hasActuaciones - At least one provider returned actuaciones/estados data
 * @param allProvidersFailed - All providers returned errors (not just empty)
 */
export function determineFoundStatus(
  hasMetadataMatch: boolean,
  hasActuaciones: boolean,
  allProvidersFailed: boolean,
): FoundStatus {
  if (!hasMetadataMatch && !hasActuaciones) return "NOT_FOUND";
  if (hasMetadataMatch && hasActuaciones) return "FOUND_COMPLETE";
  // Has metadata but no actuaciones (e.g., CPNU returned parties but actuaciones 406)
  return "FOUND_PARTIAL";
}

/**
 * Determines if fallback should trigger.
 * Fallback triggers ONLY when primary returns NOT_FOUND (no match at all).
 * FOUND_PARTIAL does NOT trigger fallback.
 */
export function shouldTriggerFallback(primaryStatus: FoundStatus): boolean {
  return primaryStatus === "NOT_FOUND";
}

/**
 * Returns all unique provider keys for a category (for Tutela: all providers).
 */
export function getAllProvidersForCategory(workflowType: string): ProviderKey[] {
  const strategy = getCategoryStrategy(workflowType);
  const all = new Set<ProviderKey>([
    ...strategy.primaryActuaciones,
    ...strategy.fallbackActuaciones,
    ...strategy.primaryEstados,
    ...strategy.fallbackEstados,
  ]);
  return Array.from(all);
}
