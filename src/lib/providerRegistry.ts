/**
 * providerRegistry.ts — Frontend mirror of the canonical provider registry.
 *
 * This is a CLIENT-SIDE copy of supabase/functions/_shared/providerRegistry.ts.
 * Both files MUST stay in sync. The edge function version is the source of truth.
 *
 * POLICY: Exactly 5 providers. No more, no less. See the edge function version
 * for the full policy documentation.
 */

export type ProviderScope = "ACTUACIONES" | "ESTADOS";

export interface CanonicalProvider {
  readonly key: ProviderKey;
  readonly displayName: string;
  readonly scope: ProviderScope;
  readonly targetTable: "work_item_acts" | "work_item_publicaciones";
}

export const CANONICAL_PROVIDERS = {
  cpnu: {
    key: "cpnu" as const,
    displayName: "CPNU (Rama Judicial)",
    scope: "ACTUACIONES" as const,
    targetTable: "work_item_acts" as const,
  },
  samai: {
    key: "samai" as const,
    displayName: "SAMAI (Consejo de Estado)",
    scope: "ACTUACIONES" as const,
    targetTable: "work_item_acts" as const,
  },
  publicaciones: {
    key: "publicaciones" as const,
    displayName: "Publicaciones Procesales",
    scope: "ESTADOS" as const,
    targetTable: "work_item_publicaciones" as const,
  },
  samai_estados: {
    key: "samai_estados" as const,
    displayName: "SAMAI Estados",
    scope: "ESTADOS" as const,
    targetTable: "work_item_publicaciones" as const,
  },
  tutelas: {
    key: "tutelas" as const,
    displayName: "Tutelas API",
    scope: "ACTUACIONES" as const,
    targetTable: "work_item_acts" as const,
  },
} as const;

export type ProviderKey = keyof typeof CANONICAL_PROVIDERS;

export const ALL_PROVIDER_KEYS: ProviderKey[] = Object.keys(CANONICAL_PROVIDERS) as ProviderKey[];
export const ACTUACIONES_PROVIDERS: ProviderKey[] = ["cpnu", "samai", "tutelas"];
export const ESTADOS_PROVIDERS: ProviderKey[] = ["publicaciones", "samai_estados"];

export function getProvidersForCategory(category: string): {
  actuaciones: ProviderKey[];
  estados: ProviderKey[];
} {
  switch (category) {
    case "CGP":       return { actuaciones: ["cpnu"], estados: ["publicaciones"] };
    case "CPACA":     return { actuaciones: ["samai"], estados: ["publicaciones", "samai_estados"] };
    case "TUTELA":    return { actuaciones: ["cpnu", "tutelas", "samai"], estados: ["publicaciones"] };
    case "LABORAL":   return { actuaciones: ["cpnu"], estados: ["publicaciones"] };
    case "PENAL_906": return { actuaciones: ["cpnu"], estados: ["publicaciones"] };
    default:          return { actuaciones: [], estados: [] };
  }
}

export function normalizeProviderKey(raw: string | null | undefined): ProviderKey | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim();
  if (!cleaned || cleaned === "none" || cleaned === "unknown") return null;

  const aliases: Record<string, ProviderKey> = {
    cpnu: "cpnu", rama_judicial: "cpnu", "rama judicial": "cpnu", rama_judicial_api: "cpnu",
    samai: "samai", consejo_de_estado: "samai", "consejo de estado": "samai",
    publicaciones: "publicaciones", publicaciones_v3: "publicaciones", pub: "publicaciones",
    "publicaciones api": "publicaciones", "publicaciones procesales": "publicaciones",
    samai_estados: "samai_estados", "samai estados": "samai_estados",
    "samai estados api": "samai_estados", "ext:samai estados api": "samai_estados",
    tutelas: "tutelas", "tutelas-api": "tutelas", tutelas_api: "tutelas",
  };

  return aliases[cleaned] || null;
}

export function isValidProviderKey(key: string): key is ProviderKey {
  return key in CANONICAL_PROVIDERS;
}

export function getProviderDisplayName(key: string | null | undefined): string {
  if (!key) return "Desconocido";
  const normalized = normalizeProviderKey(key);
  if (!normalized) return key;
  return CANONICAL_PROVIDERS[normalized].displayName;
}

export function normalizeSources(sources: unknown): string[] {
  if (!sources) return [];
  if (Array.isArray(sources)) return sources.filter((s): s is string => typeof s === "string");
  if (typeof sources === "string") return [sources];
  return [];
}
