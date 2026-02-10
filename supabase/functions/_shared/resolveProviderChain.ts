/**
 * resolveProviderChain.ts — Deno-compatible shared utility for edge functions.
 * Category-aware provider routing resolution.
 */

export type RouteKind = "PRIMARY" | "FALLBACK";
export type RouteScope = "ACTS" | "PUBS" | "BOTH";

export interface CategoryRoute {
  id: string;
  workflow: string;
  scope: RouteScope;
  route_kind: RouteKind;
  priority: number;
  provider_instance_id: string;
  enabled: boolean;
  is_authoritative?: boolean;
  provider_name?: string;
}

export interface ProviderCandidate {
  provider_instance_id: string | null; // null = built-in
  provider_name: string;
  source: "EXTERNAL_PRIMARY" | "BUILTIN" | "EXTERNAL_FALLBACK";
  attempt_index: number;
}

export type FallbackDecision =
  | "CONTINUE"
  | "STOP_OK"
  | "STOP_PENDING"
  | "STOP_EMPTY"
  | "STOP_ERROR";

const BUILTIN_PROVIDERS: Record<string, { acts: string[]; pubs: string[] }> = {
  CGP:       { acts: ["cpnu"],  pubs: ["publicaciones"] },
  LABORAL:   { acts: ["cpnu"],  pubs: ["publicaciones"] },
  CPACA:     { acts: ["samai"], pubs: ["publicaciones"] },
  TUTELA:    { acts: ["cpnu", "tutelas-api"], pubs: [] },
  PENAL_906: { acts: ["cpnu", "samai"], pubs: ["publicaciones"] },
};

export function resolveProviderChain(
  workflow: string,
  scope: "ACTS" | "PUBS",
  routes: CategoryRoute[],
): ProviderCandidate[] {
  const chain: ProviderCandidate[] = [];
  let attemptIndex = 0;

  const primaryRoutes = routes
    .filter((r) =>
      r.workflow === workflow &&
      r.route_kind === "PRIMARY" &&
      r.enabled &&
      (r.scope === scope || r.scope === "BOTH")
    )
    .sort((a, b) => a.priority - b.priority);

  for (const r of primaryRoutes) {
    chain.push({
      provider_instance_id: r.provider_instance_id,
      provider_name: r.provider_name || r.provider_instance_id.slice(0, 8),
      source: "EXTERNAL_PRIMARY",
      attempt_index: attemptIndex++,
    });
  }

  const builtins = BUILTIN_PROVIDERS[workflow] || { acts: ["cpnu"], pubs: [] };
  const builtinList = scope === "ACTS" ? builtins.acts : builtins.pubs;
  for (const b of builtinList) {
    chain.push({
      provider_instance_id: null,
      provider_name: b,
      source: "BUILTIN",
      attempt_index: attemptIndex++,
    });
  }

  const fallbackRoutes = routes
    .filter((r) =>
      r.workflow === workflow &&
      r.route_kind === "FALLBACK" &&
      r.enabled &&
      (r.scope === scope || r.scope === "BOTH")
    )
    .sort((a, b) => a.priority - b.priority);

  for (const r of fallbackRoutes) {
    chain.push({
      provider_instance_id: r.provider_instance_id,
      provider_name: r.provider_name || r.provider_instance_id.slice(0, 8),
      source: "EXTERNAL_FALLBACK",
      attempt_index: attemptIndex++,
    });
  }

  return chain;
}

const RETRYABLE_CODES = new Set([
  "SCRAPING_STUCK",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_NOT_FOUND",
  "UPSTREAM_ROUTE_MISSING",
  "UPSTREAM_ERROR",
  "PROVIDER_TIMEOUT",
  "NETWORK_ERROR",
  "UNKNOWN_ERROR",
]);

export function decideFallback(
  resultCode: string,
  ok: boolean,
  allowFallbackOnEmpty: boolean,
): FallbackDecision {
  if (ok) return "STOP_OK";
  if (resultCode === "SCRAPING_PENDING") return "STOP_PENDING";
  if (resultCode === "PROVIDER_EMPTY_RESULT" || resultCode === "EMPTY") {
    return allowFallbackOnEmpty ? "CONTINUE" : "STOP_EMPTY";
  }
  if (RETRYABLE_CODES.has(resultCode)) return "CONTINUE";
  return "STOP_ERROR";
}
