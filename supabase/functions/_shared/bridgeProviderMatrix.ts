/**
 * bridgeProviderMatrix.ts — ITERATION 26, item 5.
 *
 * The provider chain and the two lookup maps used by `bridge-reconcile` used to
 * live inside the edge function, where adding a key to CHAIN without matching
 * entries in PROVIDER_ROW_KINDS / PROVIDER_LOCAL_SOURCES silently reintroduced
 * iteration 23's apples-to-oranges comparison (a provider reconciled against a
 * row kind it never emits, or against local rows written by someone else).
 *
 * They now live here so a plain unit test can assert the three stay in
 * lockstep. This module must stay dependency-free (no Deno, no npm imports).
 */

/** ITER44 — canonical enum members only; the legacy `PENAL` alias is resolved
 *  by normalizeWorkflowType and never duplicated into a routing table. */
export const CHAIN: Record<string, string[]> = {
  CGP: ["cpnu", "publicaciones"],
  LABORAL: ["cpnu", "publicaciones"],
  PENAL_906: ["cpnu", "publicaciones"],
  EJECUTIVO: ["cpnu", "publicaciones"],
  CPACA: ["samai", "samai_estados"],
  // Fan-out until classified (iteration 18); mirrors provider_chain_for_workflow.
  INDETERMINADO: ["cpnu", "publicaciones", "samai", "samai_estados"],
  TUTELA: ["cpnu", "samai", "publicaciones", "samai_estados"],
};

/** The row kind(s) each provider actually emits. */
export const PROVIDER_ROW_KINDS: Record<string, Array<"ACT" | "PUB">> = {
  cpnu: ["ACT"],
  samai: ["ACT"],
  publicaciones: ["PUB"],
  samai_estados: ["PUB"],
};

/** Local `source` values attributable to each provider (lowercase). */
export const PROVIDER_LOCAL_SOURCES: Record<string, string[]> = {
  // ITER48 — `tutelas` / `cpnu+tutelas` are LEGACY strings for CPNU-origin rows;
  // the tutelas provider never existed, so its rows belong to cpnu.
  cpnu: ["cpnu", "cpnu+tutelas", "tutelas"],
  samai: ["samai"],
  publicaciones: ["publicaciones", "pp"],
  samai_estados: ["samai_estados"],
};

/** Every provider referenced by CHAIN, deduplicated. */
export function chainProviders(): string[] {
  return [...new Set(Object.values(CHAIN).flat())];
}

/** Providers in CHAIN that are missing an entry in either lookup map. */
export function providerMatrixGaps(): Array<{ provider: string; missing: string[] }> {
  return chainProviders()
    .map((provider) => ({
      provider,
      missing: [
        ...(PROVIDER_ROW_KINDS[provider]?.length ? [] : ["PROVIDER_ROW_KINDS"]),
        ...(PROVIDER_LOCAL_SOURCES[provider]?.length ? [] : ["PROVIDER_LOCAL_SOURCES"]),
      ],
    }))
    .filter((g) => g.missing.length > 0);
}
