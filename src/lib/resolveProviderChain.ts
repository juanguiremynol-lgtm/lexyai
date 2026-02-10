/**
 * resolveProviderChain.ts — Shared utility for category-aware provider routing.
 *
 * Supports TWO resolution modes:
 *   1. Global routing (platform-wide): routes reference provider_connectors,
 *      resolved at runtime to org-specific instances.
 *   2. Legacy org-scoped routing: routes reference provider_instances directly.
 *
 * Chain order: External PRIMARY → Built-in defaults → External FALLBACK
 *
 * Fallback semantics:
 *   - STOP on: OK, SCRAPING_PENDING (enqueue retry)
 *   - STOP on EMPTY (unless allow_fallback_on_empty=true for workflow)
 *   - CONTINUE on: SCRAPING_STUCK, PROVIDER_RATE_LIMITED, PROVIDER_NOT_FOUND,
 *                  UPSTREAM errors, timeouts, generic errors
 */

// ────────────────────── Types ──────────────────────

export type RouteKind = "PRIMARY" | "FALLBACK";
export type RouteScope = "ACTS" | "PUBS" | "BOTH";

/** Legacy org-scoped route (references provider_instance directly) */
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

/** Global route (references provider_connector, resolved to instance at runtime) */
export interface GlobalRoute {
  id: string;
  workflow: string;
  scope: RouteScope;
  route_kind: RouteKind;
  priority: number;
  provider_connector_id: string;
  is_authoritative: boolean;
  enabled: boolean;
  connector_name?: string;
}

/** Resolved instance for a global route */
export interface ResolvedInstance {
  provider_connector_id: string;
  provider_instance_id: string;
  provider_name: string;
}

export interface ProviderCandidate {
  provider_instance_id: string | null; // null = built-in
  provider_connector_id?: string | null;
  provider_name: string;
  source: "EXTERNAL_PRIMARY" | "BUILTIN" | "EXTERNAL_FALLBACK";
  attempt_index: number;
  skip_reason?: string; // populated when connector lacks an org instance
}

export type FallbackDecision =
  | "CONTINUE"
  | "STOP_OK"
  | "STOP_PENDING"
  | "STOP_EMPTY"
  | "STOP_ERROR";

// ────────────────────── Built-in defaults ──────────────────────

const BUILTIN_PROVIDERS: Record<string, { acts: string[]; pubs: string[] }> = {
  CGP:       { acts: ["cpnu"],  pubs: ["publicaciones"] },
  LABORAL:   { acts: ["cpnu"],  pubs: ["publicaciones"] },
  CPACA:     { acts: ["samai"], pubs: ["publicaciones"] },
  TUTELA:    { acts: ["cpnu", "tutelas-api"], pubs: [] },
  PENAL_906: { acts: ["cpnu", "samai"], pubs: ["publicaciones"] },
};

// ────────────────────── Legacy chain resolver ──────────────────────

/**
 * Resolve chain from org-scoped routes (legacy).
 * Used when no global routes are configured.
 */
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

// ────────────────────── Global chain resolver ──────────────────────

/**
 * Resolve chain from global routes + org instance lookup.
 * For each global route, finds the org's enabled instance for that connector.
 * If no instance exists, the route is skipped (with skip_reason in trace).
 */
export function resolveGlobalProviderChain(
  workflow: string,
  scope: "ACTS" | "PUBS",
  globalRoutes: GlobalRoute[],
  orgInstances: ResolvedInstance[],
): ProviderCandidate[] {
  const chain: ProviderCandidate[] = [];
  let attemptIndex = 0;

  const instanceMap = new Map<string, ResolvedInstance>();
  for (const inst of orgInstances) {
    instanceMap.set(inst.provider_connector_id, inst);
  }

  const primaryRoutes = globalRoutes
    .filter((r) =>
      r.workflow === workflow &&
      r.route_kind === "PRIMARY" &&
      r.enabled &&
      (r.scope === scope || r.scope === "BOTH")
    )
    .sort((a, b) => a.priority - b.priority);

  for (const r of primaryRoutes) {
    const inst = instanceMap.get(r.provider_connector_id);
    if (inst) {
      chain.push({
        provider_instance_id: inst.provider_instance_id,
        provider_connector_id: r.provider_connector_id,
        provider_name: inst.provider_name,
        source: "EXTERNAL_PRIMARY",
        attempt_index: attemptIndex++,
      });
    } else {
      // Skip — org has no instance for this connector
      chain.push({
        provider_instance_id: null,
        provider_connector_id: r.provider_connector_id,
        provider_name: r.connector_name || "unknown",
        source: "EXTERNAL_PRIMARY",
        attempt_index: attemptIndex++,
        skip_reason: `No enabled instance for connector ${r.connector_name || r.provider_connector_id}`,
      });
    }
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

  const fallbackRoutes = globalRoutes
    .filter((r) =>
      r.workflow === workflow &&
      r.route_kind === "FALLBACK" &&
      r.enabled &&
      (r.scope === scope || r.scope === "BOTH")
    )
    .sort((a, b) => a.priority - b.priority);

  for (const r of fallbackRoutes) {
    const inst = instanceMap.get(r.provider_connector_id);
    if (inst) {
      chain.push({
        provider_instance_id: inst.provider_instance_id,
        provider_connector_id: r.provider_connector_id,
        provider_name: inst.provider_name,
        source: "EXTERNAL_FALLBACK",
        attempt_index: attemptIndex++,
      });
    } else {
      chain.push({
        provider_instance_id: null,
        provider_connector_id: r.provider_connector_id,
        provider_name: r.connector_name || "unknown",
        source: "EXTERNAL_FALLBACK",
        attempt_index: attemptIndex++,
        skip_reason: `No enabled instance for connector ${r.connector_name || r.provider_connector_id}`,
      });
    }
  }

  return chain;
}

// ────────────────────── Fallback decision ──────────────────────

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
