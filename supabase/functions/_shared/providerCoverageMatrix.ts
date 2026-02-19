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

/**
 * Execution mode for a workflow+dataKind combination.
 * - CHAIN: Try primary first, fallback only on NOT_FOUND (default)
 * - FANOUT: Call ALL providers in parallel, merge results with dedup (used for TUTELA)
 */
export type ExecutionMode = "CHAIN" | "FANOUT";

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
  /** Execution mode: CHAIN (sequential primary→fallback) or FANOUT (parallel all) */
  executionMode: ExecutionMode;
}

// ── Coverage definitions ──

interface DataKindCoverage {
  providers: ProviderEntry[];
  executionMode: ExecutionMode;
}

interface WorkflowCoverage {
  ACTUACIONES: DataKindCoverage;
  ESTADOS: DataKindCoverage;
}

const COVERAGE_MAP: Record<string, WorkflowCoverage> = {
  CGP: {
    ACTUACIONES: {
      executionMode: "CHAIN",
      providers: [
        { key: "CPNU", role: "PRIMARY", type: "BUILTIN" },
      ],
    },
    ESTADOS: {
      executionMode: "CHAIN",
      providers: [
        { key: "PUBLICACIONES", role: "PRIMARY", type: "BUILTIN" },
      ],
    },
  },
  LABORAL: {
    ACTUACIONES: {
      executionMode: "CHAIN",
      providers: [
        { key: "CPNU", role: "PRIMARY", type: "BUILTIN" },
      ],
    },
    ESTADOS: {
      executionMode: "CHAIN",
      providers: [
        { key: "PUBLICACIONES", role: "PRIMARY", type: "BUILTIN" },
      ],
    },
  },
  CPACA: {
    ACTUACIONES: {
      executionMode: "CHAIN",
      providers: [
        { key: "SAMAI", role: "PRIMARY", type: "BUILTIN" },
      ],
    },
    ESTADOS: {
      executionMode: "CHAIN",
      providers: [
        { key: "SAMAI_ESTADOS", role: "PRIMARY", type: "EXTERNAL" },
        { key: "PUBLICACIONES", role: "FALLBACK", type: "BUILTIN" },
      ],
    },
  },
  TUTELA: {
    ACTUACIONES: {
      executionMode: "FANOUT",
      providers: [
        { key: "CPNU", role: "PRIMARY", type: "BUILTIN" },
        { key: "SAMAI", role: "PRIMARY", type: "BUILTIN" },
        { key: "TUTELAS", role: "PRIMARY", type: "BUILTIN" },
      ],
    },
    ESTADOS: {
      executionMode: "FANOUT",
      providers: [
        { key: "TUTELAS", role: "PRIMARY", type: "BUILTIN" },
        { key: "PUBLICACIONES", role: "PRIMARY", type: "BUILTIN" },
        { key: "SAMAI_ESTADOS", role: "PRIMARY", type: "EXTERNAL" },
      ],
    },
  },
  PENAL_906: {
    ACTUACIONES: {
      executionMode: "CHAIN",
      providers: [
        { key: "CPNU", role: "PRIMARY", type: "BUILTIN" },
        { key: "SAMAI", role: "FALLBACK", type: "BUILTIN" },
      ],
    },
    ESTADOS: {
      executionMode: "CHAIN",
      providers: [
        { key: "PUBLICACIONES", role: "PRIMARY", type: "BUILTIN" },
      ],
    },
  },
  PETICION: {
    ACTUACIONES: { executionMode: "CHAIN", providers: [] },
    ESTADOS: { executionMode: "CHAIN", providers: [] },
  },
  GOV_PROCEDURE: {
    ACTUACIONES: { executionMode: "CHAIN", providers: [] },
    ESTADOS: { executionMode: "CHAIN", providers: [] },
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
      executionMode: "CHAIN",
    };
  }
  const coverage = wf[dataKind];
  if (!coverage || coverage.providers.length === 0) {
    return {
      providers: [],
      compatible: false,
      reason: `No providers configured for ${workflowType}/${dataKind}`,
      executionMode: "CHAIN",
    };
  }
  return {
    providers: coverage.providers,
    compatible: true,
    executionMode: coverage.executionMode,
    reason: coverage.executionMode === "FANOUT"
      ? `FANOUT: ${coverage.providers.length} providers in parallel`
      : `${coverage.providers.filter(p => p.role === "PRIMARY").length} primary, ${coverage.providers.filter(p => p.role === "FALLBACK").length} fallback`,
  };
}

// ── Compatibility sets: which connector keys are valid for which workflow+dataKind ──

const COMPATIBLE_CONNECTORS: Record<string, Record<DataKind, Set<string>>> = {
  CGP: {
    ACTUACIONES: new Set(["CPNU"]),
    ESTADOS: new Set(["PUBLICACIONES"]),
  },
  LABORAL: {
    ACTUACIONES: new Set(["CPNU"]),
    ESTADOS: new Set(["PUBLICACIONES"]),
  },
  CPACA: {
    ACTUACIONES: new Set(["SAMAI", "CPNU"]),
    ESTADOS: new Set(["SAMAI_ESTADOS", "PUBLICACIONES"]),
  },
  TUTELA: {
    ACTUACIONES: new Set(["CPNU", "SAMAI", "TUTELAS"]),
    ESTADOS: new Set(["TUTELAS", "PUBLICACIONES", "SAMAI_ESTADOS"]),
  },
  PENAL_906: {
    ACTUACIONES: new Set(["CPNU", "SAMAI"]),
    ESTADOS: new Set(["PUBLICACIONES"]),
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

// ── Dynamic coverage overlay from DB ──

export interface CoverageOverrideRow {
  workflow_type: string;
  data_kind: DataKind;
  provider_key: string;
  provider_role: ProviderRole;
  provider_type: "BUILTIN" | "EXTERNAL";
  execution_mode: ExecutionMode;
  priority: number;
  override_builtin: boolean;
  connector_id: string | null;
  timeout_ms: number | null;
  enabled: boolean;
}

/**
 * Load enabled coverage overrides from DB.
 * Returns empty array if query fails (fail-open to preserve existing behavior).
 */
export async function loadCoverageOverrides(
  supabase: any,
): Promise<CoverageOverrideRow[]> {
  try {
    const { data, error } = await supabase
      .from("provider_coverage_overrides")
      .select("*")
      .eq("enabled", true)
      .order("priority", { ascending: true });
    if (error) {
      console.warn("[providerCoverageMatrix] Failed to load overrides:", error.message);
      return [];
    }
    return (data || []) as CoverageOverrideRow[];
  } catch {
    return [];
  }
}

/**
 * Merge DB overrides with the hardcoded coverage matrix.
 *
 * Rules:
 *   - If override has override_builtin=true AND matches a built-in key, replace it
 *   - Otherwise, APPEND dynamic providers to the existing list
 *   - If overrides specify a different execution_mode for a (workflow, dataKind),
 *     the override's mode wins ONLY if there are override entries for that combo
 *   - Built-in providers are preserved unless explicitly overridden
 */
export function getProviderCoverageWithOverrides(
  workflowType: string,
  dataKind: DataKind,
  overrides: CoverageOverrideRow[],
): CoverageResult {
  const baseCoverage = getProviderCoverage(workflowType, dataKind);

  // Filter overrides for this workflow+dataKind
  const relevantOverrides = overrides.filter(
    (o) => o.workflow_type === workflowType && o.data_kind === dataKind,
  );

  if (relevantOverrides.length === 0) {
    return baseCoverage;
  }

  // Determine which built-in keys are being overridden
  const overriddenKeys = new Set(
    relevantOverrides
      .filter((o) => o.override_builtin)
      .map((o) => o.provider_key.toUpperCase()),
  );

  // Keep non-overridden built-in providers
  const keptProviders = baseCoverage.providers.filter(
    (p) => !overriddenKeys.has(p.key.toUpperCase()),
  );

  // Convert overrides to ProviderEntry
  const dynamicProviders: ProviderEntry[] = relevantOverrides.map((o) => ({
    key: o.provider_key.toUpperCase(),
    role: o.provider_role,
    type: o.provider_type,
  }));

  // Merge: kept builtins + dynamic providers, sorted by priority
  // Dynamic providers with lower priority numbers go first
  const allProviders = [...keptProviders, ...dynamicProviders];

  // Determine execution mode: if any override specifies FANOUT, use FANOUT
  const overrideMode = relevantOverrides.some((o) => o.execution_mode === "FANOUT")
    ? "FANOUT"
    : baseCoverage.executionMode;

  return {
    providers: allProviders,
    compatible: true,
    executionMode: overrideMode,
    reason: `${baseCoverage.reason} + ${dynamicProviders.length} dynamic provider(s)`,
  };
}
