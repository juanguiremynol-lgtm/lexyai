/**
 * resolveProviderChain.ts — Shared utility for category-aware provider routing.
 *
 * Supports THREE resolution modes:
 *   1. Global routing (platform-wide): routes reference provider_connectors,
 *      resolved at runtime to org-specific instances.
 *   2. Org override routing: org-specific routes that take precedence over global.
 *   3. Legacy org-scoped routing: routes reference provider_instances directly.
 *
 * Resolution precedence: Org Override → Global → Built-in defaults
 *
 * Chain order: External PRIMARY → Built-in defaults → External FALLBACK
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

/** Org override route (same shape as global, but org-scoped) */
export type OrgOverrideRoute = GlobalRoute;

/** Resolved instance for a global/org route */
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
  route_source?: "ORG_OVERRIDE" | "GLOBAL" | "BUILTIN"; // where the route came from
}

export type FallbackDecision =
  | "CONTINUE"
  | "STOP_OK"
  | "STOP_PENDING"
  | "STOP_EMPTY"
  | "STOP_ERROR";

/** Policy for a workflow/scope */
export interface EffectivePolicy {
  strategy: string;
  merge_mode: string;
  merge_budget_max_providers: number;
  merge_budget_max_ms: number;
  allow_merge_on_empty: boolean;
  max_provider_attempts_per_run: number;
  source: "ORG_OVERRIDE" | "GLOBAL" | "BUILTIN";
}

// ────────────────────── Built-in defaults ──────────────────────

const BUILTIN_PROVIDERS: Record<string, { acts: string[]; pubs: string[] }> = {
  CGP:       { acts: ["cpnu"],  pubs: ["publicaciones"] },
  LABORAL:   { acts: ["cpnu"],  pubs: ["publicaciones"] },
  CPACA:     { acts: ["samai"], pubs: ["publicaciones"] },
  TUTELA:    { acts: ["cpnu", "tutelas-api"], pubs: [] },
  PENAL_906: { acts: ["cpnu", "samai"], pubs: ["publicaciones"] },
};

const DEFAULT_POLICY: EffectivePolicy = {
  strategy: "SELECT",
  merge_mode: "UNION_PREFER_PRIMARY",
  merge_budget_max_providers: 2,
  merge_budget_max_ms: 15000,
  allow_merge_on_empty: false,
  max_provider_attempts_per_run: 2,
  source: "BUILTIN",
};

// ────────────────────── Legacy chain resolver ──────────────────────

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

// ────────────────────── Connector→Instance chain builder ──────────────────────

function buildConnectorChain(
  workflow: string,
  scope: "ACTS" | "PUBS",
  routes: GlobalRoute[],
  orgInstances: ResolvedInstance[],
  routeSource: "ORG_OVERRIDE" | "GLOBAL",
): ProviderCandidate[] {
  const chain: ProviderCandidate[] = [];
  let attemptIndex = 0;

  const instanceMap = new Map<string, ResolvedInstance>();
  for (const inst of orgInstances) {
    instanceMap.set(inst.provider_connector_id, inst);
  }

  const primaryRoutes = routes
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
        route_source: routeSource,
      });
    } else {
      chain.push({
        provider_instance_id: null,
        provider_connector_id: r.provider_connector_id,
        provider_name: r.connector_name || "unknown",
        source: "EXTERNAL_PRIMARY",
        attempt_index: attemptIndex++,
        skip_reason: `No enabled instance for connector ${r.connector_name || r.provider_connector_id}`,
        route_source: routeSource,
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
      route_source: "BUILTIN",
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
    const inst = instanceMap.get(r.provider_connector_id);
    if (inst) {
      chain.push({
        provider_instance_id: inst.provider_instance_id,
        provider_connector_id: r.provider_connector_id,
        provider_name: inst.provider_name,
        source: "EXTERNAL_FALLBACK",
        attempt_index: attemptIndex++,
        route_source: routeSource,
      });
    } else {
      chain.push({
        provider_instance_id: null,
        provider_connector_id: r.provider_connector_id,
        provider_name: r.connector_name || "unknown",
        source: "EXTERNAL_FALLBACK",
        attempt_index: attemptIndex++,
        skip_reason: `No enabled instance for connector ${r.connector_name || r.provider_connector_id}`,
        route_source: routeSource,
      });
    }
  }

  return chain;
}

// ────────────────────── Global chain resolver (backward compat) ──────────────────────

export function resolveGlobalProviderChain(
  workflow: string,
  scope: "ACTS" | "PUBS",
  globalRoutes: GlobalRoute[],
  orgInstances: ResolvedInstance[],
): ProviderCandidate[] {
  return buildConnectorChain(workflow, scope, globalRoutes, orgInstances, "GLOBAL");
}

// ────────────────────── Effective resolver (org override → global → builtin) ──────────────────────

export interface EffectiveResolutionInput {
  workflow: string;
  scope: "ACTS" | "PUBS";
  orgOverrideRoutes: GlobalRoute[];
  globalRoutes: GlobalRoute[];
  orgInstances: ResolvedInstance[];
  orgOverridePolicy?: Partial<EffectivePolicy> | null;
  globalPolicy?: Partial<EffectivePolicy> | null;
}

export interface EffectiveResolutionResult {
  chain: ProviderCandidate[];
  policy: EffectivePolicy;
  routeSource: "ORG_OVERRIDE" | "GLOBAL" | "BUILTIN";
}

export function resolveEffectivePolicyAndChain(
  input: EffectiveResolutionInput,
): EffectiveResolutionResult {
  const { workflow, scope, orgOverrideRoutes, globalRoutes, orgInstances, orgOverridePolicy, globalPolicy } = input;

  // 1) Determine effective policy
  let policy: EffectivePolicy;
  if (orgOverridePolicy && orgOverridePolicy.strategy) {
    policy = { ...DEFAULT_POLICY, ...orgOverridePolicy, source: "ORG_OVERRIDE" };
  } else if (globalPolicy && globalPolicy.strategy) {
    policy = { ...DEFAULT_POLICY, ...globalPolicy, source: "GLOBAL" };
  } else {
    policy = { ...DEFAULT_POLICY };
  }

  // 2) Determine effective routes
  const enabledOrgRoutes = orgOverrideRoutes.filter(
    (r) => r.workflow === workflow && r.enabled && (r.scope === scope || r.scope === "BOTH")
  );

  let chain: ProviderCandidate[];
  let routeSource: "ORG_OVERRIDE" | "GLOBAL" | "BUILTIN";

  if (enabledOrgRoutes.length > 0) {
    // Org override takes full precedence
    chain = buildConnectorChain(workflow, scope, orgOverrideRoutes, orgInstances, "ORG_OVERRIDE");
    routeSource = "ORG_OVERRIDE";
  } else {
    const enabledGlobalRoutes = globalRoutes.filter(
      (r) => r.workflow === workflow && r.enabled && (r.scope === scope || r.scope === "BOTH")
    );
    if (enabledGlobalRoutes.length > 0) {
      chain = buildConnectorChain(workflow, scope, globalRoutes, orgInstances, "GLOBAL");
      routeSource = "GLOBAL";
    } else {
      // Built-in defaults only
      chain = buildConnectorChain(workflow, scope, [], orgInstances, "GLOBAL");
      routeSource = "BUILTIN";
    }
  }

  // Re-index attempt_index sequentially
  chain.forEach((c, i) => { c.attempt_index = i; });

  return { chain, policy, routeSource };
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
