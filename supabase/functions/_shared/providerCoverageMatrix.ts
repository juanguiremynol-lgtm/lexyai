/**
 * providerCoverageMatrix.ts — Single source-of-truth for provider compatibility.
 *
 * ┌────────────┬───────────────────────────────────────┬───────────────────────────────────────┐
 * │ Workflow   │ ACTUACIONES primary → fallbacks       │ ESTADOS primary → fallbacks           │
 * ├────────────┼───────────────────────────────────────┼───────────────────────────────────────┤
 * │ CGP        │ CPNU                                  │ Publicaciones Procesales              │
 * │ LABORAL    │ CPNU                                  │ Publicaciones Procesales              │
 * │ CPACA      │ SAMAI                                 │ SAMAI_ESTADOS (primary)               │
 * │ TUTELA     │ CPNU → SAMAI, TUTELAS                │ (none)                                │
 * │ PENAL_906  │ CPNU → SAMAI                          │ Publicaciones Procesales              │
 * │ PETICION   │ (none)                                │ (none)                                │
 * │ GOV_PROC   │ (none)                                │ (none)                                │
 * └────────────┴───────────────────────────────────────┴───────────────────────────────────────┘
 *
 * Merge behavior:
 *   - Primary providers are queried first in declared order
 *   - Fallback providers are queried if primary fails/returns empty (when allow_fallback_on_empty)
 *   - All non-duplicate results are merged into canonical tables
 *   - Provenance is ALWAYS preserved, even for dedup hits (provenance-first merge)
 *
 * Compatibility gate:
 *   - isProviderCompatible(connectorKey, workflow, dataKind) determines whether a specific
 *     external provider connector should be called for a given work item category and data kind.
 *   - Incompatible providers are skipped with a trace entry (unless debug override is active).
 */

export type DataKind = "ACTUACIONES" | "ESTADOS";
export type ProviderRole = "PRIMARY" | "FALLBACK";

export interface ProviderEntry {
  /** Connector key or built-in name (e.g., "cpnu", "samai", "SAMAI_ESTADOS", "publicaciones") */
  key: string;
  role: ProviderRole;
  /** Whether this is a built-in (inline fetch) or external (provider-sync-external-provider) */
  type: "BUILTIN" | "EXTERNAL";
}

export interface CoverageResult {
  providers: ProviderEntry[];
  compatible: boolean;
  reason: string;
}

// ── Coverage definitions ──

interface WorkflowCoverage {
  ACTUACIONES: ProviderEntry[];
  ESTADOS: ProviderEntry[];
}

const COVERAGE_MAP: Record<string, WorkflowCoverage> = {
  CGP: {
    ACTUACIONES: [
      { key: "cpnu", role: "PRIMARY", type: "BUILTIN" },
    ],
    ESTADOS: [
      { key: "publicaciones", role: "PRIMARY", type: "BUILTIN" },
    ],
  },
  LABORAL: {
    ACTUACIONES: [
      { key: "cpnu", role: "PRIMARY", type: "BUILTIN" },
    ],
    ESTADOS: [
      { key: "publicaciones", role: "PRIMARY", type: "BUILTIN" },
    ],
  },
  CPACA: {
    ACTUACIONES: [
      { key: "samai", role: "PRIMARY", type: "BUILTIN" },
    ],
    ESTADOS: [
      { key: "SAMAI_ESTADOS", role: "PRIMARY", type: "EXTERNAL" },
      { key: "publicaciones", role: "FALLBACK", type: "BUILTIN" },
    ],
  },
  TUTELA: {
    ACTUACIONES: [
      { key: "cpnu", role: "PRIMARY", type: "BUILTIN" },
      { key: "samai", role: "FALLBACK", type: "BUILTIN" },
      { key: "tutelas-api", role: "FALLBACK", type: "BUILTIN" },
    ],
    ESTADOS: [],
  },
  PENAL_906: {
    ACTUACIONES: [
      { key: "cpnu", role: "PRIMARY", type: "BUILTIN" },
      { key: "samai", role: "FALLBACK", type: "BUILTIN" },
    ],
    ESTADOS: [
      { key: "publicaciones", role: "PRIMARY", type: "BUILTIN" },
    ],
  },
  PETICION: {
    ACTUACIONES: [],
    ESTADOS: [],
  },
  GOV_PROCEDURE: {
    ACTUACIONES: [],
    ESTADOS: [],
  },
};

/**
 * Returns the ordered provider list for a given workflow + data_kind.
 * Primary providers come first, then fallbacks.
 */
export function getProviderCoverage(
  workflowType: string,
  dataKind: DataKind,
): CoverageResult {
  const wf = COVERAGE_MAP[workflowType];
  if (!wf) {
    return {
      providers: [],
      compatible: false,
      reason: `Unknown workflow_type: ${workflowType}`,
    };
  }
  const providers = wf[dataKind];
  if (!providers || providers.length === 0) {
    return {
      providers: [],
      compatible: false,
      reason: `No providers configured for ${workflowType}/${dataKind}`,
    };
  }
  return {
    providers,
    compatible: true,
    reason: `${providers.filter(p => p.role === "PRIMARY").length} primary, ${providers.filter(p => p.role === "FALLBACK").length} fallback`,
  };
}

// ── Compatibility sets: which connector keys are valid for which workflow+dataKind ──

const COMPATIBLE_CONNECTORS: Record<string, Record<DataKind, Set<string>>> = {
  CGP: {
    ACTUACIONES: new Set(["cpnu"]),
    ESTADOS: new Set(["publicaciones"]),
  },
  LABORAL: {
    ACTUACIONES: new Set(["cpnu"]),
    ESTADOS: new Set(["publicaciones"]),
  },
  CPACA: {
    ACTUACIONES: new Set(["samai", "cpnu"]),
    ESTADOS: new Set(["SAMAI_ESTADOS", "samai_estados", "samai-estados", "publicaciones"]),
  },
  TUTELA: {
    ACTUACIONES: new Set(["cpnu", "samai", "tutelas-api", "tutelas"]),
    ESTADOS: new Set([]),
  },
  PENAL_906: {
    ACTUACIONES: new Set(["cpnu", "samai"]),
    ESTADOS: new Set(["publicaciones"]),
  },
};

/**
 * Determines if a given external provider connector is compatible with a workflow + data_kind.
 * Used as a gate before calling provider-sync-external-provider.
 *
 * @param connectorKey - The connector's key (e.g., "SAMAI_ESTADOS", "cpnu")
 * @param workflowType - The work item's workflow_type
 * @param dataKind - "ACTUACIONES" or "ESTADOS"
 * @param debugOverride - If true, bypasses compatibility check (PLATFORM admin debug mode)
 * @returns { compatible, reason }
 */
export function isProviderCompatible(
  connectorKey: string,
  workflowType: string,
  dataKind: DataKind,
  debugOverride = false,
): { compatible: boolean; reason: string } {
  if (debugOverride) {
    return { compatible: true, reason: "DEBUG_OVERRIDE: compatibility check bypassed" };
  }

  const wfCompat = COMPATIBLE_CONNECTORS[workflowType];
  if (!wfCompat) {
    return { compatible: false, reason: `Unknown workflow: ${workflowType}` };
  }

  const kindSet = wfCompat[dataKind];
  if (!kindSet || kindSet.size === 0) {
    return { compatible: false, reason: `No compatible providers for ${workflowType}/${dataKind}` };
  }

  const normalized = connectorKey.toLowerCase().replace(/[_-]/g, "");
  for (const allowed of kindSet) {
    if (allowed.toLowerCase().replace(/[_-]/g, "") === normalized) {
      return { compatible: true, reason: `${connectorKey} is compatible with ${workflowType}/${dataKind}` };
    }
  }

  return {
    compatible: false,
    reason: `${connectorKey} is NOT compatible with ${workflowType}/${dataKind}. Allowed: ${[...kindSet].join(", ")}`,
  };
}

/**
 * Determines the effective data_kind for a route scope.
 * Used to map route.scope (ACTS/PUBS/BOTH) to DataKind.
 */
export function routeScopeToDataKinds(scope: string): DataKind[] {
  switch (scope) {
    case "ACTS":
      return ["ACTUACIONES"];
    case "PUBS":
      return ["ESTADOS"];
    case "BOTH":
      return ["ACTUACIONES", "ESTADOS"];
    default:
      return ["ACTUACIONES"];
  }
}
