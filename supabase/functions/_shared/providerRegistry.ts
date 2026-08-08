/**
 * providerRegistry.ts — THE CANONICAL SOURCE OF TRUTH for all 4 external judicial data providers.
 *
 * ┌─────────────────┬──────────────────────────────┬──────────────┬───────────────────────────┐
 * │ Key             │ Display Name                 │ Scope        │ Target Table              │
 * ├─────────────────┼──────────────────────────────┼──────────────┼───────────────────────────┤
 * │ cpnu            │ CPNU (Rama Judicial)         │ ACTUACIONES  │ work_item_acts            │
 * │ samai           │ SAMAI (Consejo de Estado)    │ ACTUACIONES  │ work_item_acts            │
 * │ publicaciones   │ Publicaciones Procesales     │ ESTADOS      │ work_item_publicaciones   │
 * │ samai_estados   │ SAMAI Estados                │ ESTADOS      │ work_item_publicaciones   │
 * └─────────────────┴──────────────────────────────┴──────────────┴───────────────────────────┘
 *
 * ITER48 — `tutelas` was RETIRED as a provider. GCP probed GET /expediente and
 * POST /search against all eight services with valid API keys and got 404 on
 * every one: there is no tutelas service, in any region, and there never was
 * (ADAPTER_CONTRACT_SPEC.md §5, 2026-07-13, "NO BACKEND EXISTS"). Tutelas are
 * the UNION of the four real sources; upstream implements the TUTELA case in
 * /lifecycle by switching on all four flags. Stored tutela data lives in
 * cpnu-https-jobs /snapshot?numero_radicacion= and cpnu-read-api /work-items
 * filtered on workflow_type='TUTELA'. Legacy `tutelas*` strings normalise to
 * `cpnu`, which is where the rows actually came from.
 *
 * POLICY (requires double authorization at the org level to change):
 *   - Exactly 4 providers. No more, no less.
 *   - Actuaciones providers ONLY write to work_item_acts.
 *   - Estados providers ONLY write to work_item_publicaciones.
 *   - These two scopes are NEVER mixed.
 *   - Provider key "none", null, or "" is REJECTED at every write point.
 *   - Demo lookup ALWAYS fans out to ALL 4 providers (category-agnostic).
 *   - Work item wizard routes by category (see getProvidersForCategory).
 *   - Ongoing sync routes by category (same rules as wizard).
 */

export type ProviderScope = "ACTUACIONES" | "ESTADOS";
export type ProviderType = "built-in" | "external";

export interface CanonicalProvider {
  readonly key: ProviderKey;
  readonly displayName: string;
  readonly scope: ProviderScope;
  readonly targetTable: "work_item_acts" | "work_item_publicaciones";
  readonly type: ProviderType;
  readonly edgeFunction: string;
  readonly primaryFor: readonly string[];
  readonly fallbackFor: readonly string[];
  readonly isAsync?: boolean;
}

export const CANONICAL_PROVIDERS = {
  cpnu: {
    key: "cpnu",
    displayName: "CPNU (Rama Judicial)",
    scope: "ACTUACIONES" as const,
    targetTable: "work_item_acts" as const,
    type: "built-in" as const,
    edgeFunction: "sync-by-work-item",
    primaryFor: ["CGP", "LABORAL", "PENAL_906"],
    fallbackFor: ["TUTELA", "CPACA"],
  },
  samai: {
    key: "samai",
    displayName: "SAMAI (Consejo de Estado)",
    scope: "ACTUACIONES" as const,
    targetTable: "work_item_acts" as const,
    type: "built-in" as const,
    edgeFunction: "sync-by-work-item",
    primaryFor: ["CPACA"],
    fallbackFor: ["CGP", "LABORAL"],
  },
  publicaciones: {
    key: "publicaciones",
    displayName: "Publicaciones Procesales",
    scope: "ESTADOS" as const,
    targetTable: "work_item_publicaciones" as const,
    type: "built-in" as const,
    edgeFunction: "sync-publicaciones-by-work-item",
    primaryFor: ["CGP", "CPACA", "TUTELA", "LABORAL", "PENAL_906"],
    fallbackFor: [],
  },
  samai_estados: {
    key: "samai_estados",
    displayName: "SAMAI Estados",
    scope: "ESTADOS" as const,
    targetTable: "work_item_publicaciones" as const,
    type: "built-in" as const,
    edgeFunction: "provider-sync-external-provider",
    primaryFor: ["CPACA"],
    fallbackFor: [],
  },
} as const;

export type ProviderKey = keyof typeof CANONICAL_PROVIDERS;

export const ALL_PROVIDER_KEYS: ProviderKey[] = Object.keys(CANONICAL_PROVIDERS) as ProviderKey[];
export const ACTUACIONES_PROVIDERS: ProviderKey[] = ["cpnu", "samai"];
export const ESTADOS_PROVIDERS: ProviderKey[] = ["publicaciones", "samai_estados"];

/**
 * Returns providers for a given work item category.
 *
 * Used by: wizard LOOKUP, sync-by-work-item (ongoing sync), debug console.
 * NOT used by: demo lookup (which always fans out to all 5).
 */
export function getProvidersForCategory(category: string): {
  actuaciones: ProviderKey[];
  estados: ProviderKey[];
} {
  switch (category) {
    case "CGP":
      return { actuaciones: ["cpnu"], estados: ["publicaciones"] };
    case "CPACA":
      return { actuaciones: ["samai"], estados: ["publicaciones", "samai_estados"] };
    case "TUTELA":
      // ITER48 — union of the four real sources; no tutelas provider exists.
      return { actuaciones: ["cpnu", "samai"], estados: ["publicaciones", "samai_estados"] };
    case "LABORAL":
      return { actuaciones: ["cpnu"], estados: ["publicaciones"] };
    case "PENAL_906":
      return { actuaciones: ["cpnu"], estados: ["publicaciones"] };
    default:
      return { actuaciones: [], estados: [] };
  }
}

/**
 * Returns ALL providers for demo lookup (fans out to all 5 regardless of category).
 */
export function getProvidersForDemo(): {
  actuaciones: ProviderKey[];
  estados: ProviderKey[];
} {
  return {
    actuaciones: ["cpnu", "samai"],
    estados: ["publicaciones", "samai_estados"],
  };
}

/**
 * Normalize any variant of a provider key/name to the canonical ProviderKey.
 *
 * Handles known aliases from legacy code, external traces, and display names.
 * Returns null for unrecognized inputs (including null, undefined, "none", "").
 */
export function normalizeProviderKey(raw: string | null | undefined): ProviderKey | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim();
  if (!cleaned || cleaned === "none" || cleaned === "unknown") return null;

  const aliases: Record<string, ProviderKey> = {
    // cpnu
    cpnu: "cpnu",
    rama_judicial: "cpnu",
    "rama judicial": "cpnu",
    rama_judicial_api: "cpnu",
    "cpnu (rama judicial)": "cpnu",
    // samai
    samai: "samai",
    consejo_de_estado: "cpnu", // typo guard — SAMAI is Consejo de Estado
    "samai (consejo de estado)": "samai",
    "consejo de estado": "samai",
    // publicaciones
    publicaciones: "publicaciones",
    publicaciones_v3: "publicaciones",
    pub: "publicaciones",
    "publicaciones procesales": "publicaciones",
    "publicaciones api": "publicaciones",
    // samai_estados
    samai_estados: "samai_estados",
    "samai estados": "samai_estados",
    "samai estados api": "samai_estados",
    "ext:samai estados api": "samai_estados",
    // ITER48 — retired tutelas aliases resolve to their real origin: CPNU.
    tutelas: "cpnu",
    "tutelas-api": "cpnu",
    tutelas_api: "cpnu",
    "tutelas api": "cpnu",
    "corte constitucional": "cpnu",
  };

  return aliases[cleaned] || null;
}

/**
 * Validate that a string is a canonical ProviderKey.
 */
export function isValidProviderKey(key: string): key is ProviderKey {
  return key in CANONICAL_PROVIDERS;
}

/**
 * Get display name for a provider key (safe for UI rendering).
 */
export function getProviderDisplayName(key: string | null | undefined): string {
  if (!key) return "Desconocido";
  const normalized = normalizeProviderKey(key);
  if (!normalized) return key;
  return CANONICAL_PROVIDERS[normalized].displayName;
}

/**
 * Ensure sources array is always a proper string array.
 * Handles: string, string[], null, undefined.
 */
export function normalizeSources(sources: unknown): string[] {
  if (!sources) return [];
  if (Array.isArray(sources)) return sources.filter((s): s is string => typeof s === "string");
  if (typeof sources === "string") return [sources];
  return [];
}
