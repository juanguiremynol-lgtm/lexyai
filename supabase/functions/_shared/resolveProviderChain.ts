/**
 * resolveProviderChain.ts — Deno-compatible shared utility for edge functions.
 * Category-aware provider routing resolution.
 *
 * Supports:
 *   1. Global routing: routes reference provider_connectors, resolved to PLATFORM instances.
 *   2. Org override routing: org-specific routes that use ORG instances (never fall back to PLATFORM).
 *   3. Legacy org-scoped routing: routes reference provider_instances directly.
 *
 * Resolution precedence: Org Override → Global → Built-in defaults
 *
 * PLATFORM semantics:
 *   - GLOBAL routes always resolve to PLATFORM-scoped instances (scope='PLATFORM', organization_id IS NULL).
 *   - If no enabled PLATFORM instance exists, skip_reason = MISSING_PLATFORM_INSTANCE.
 *   - ORG_OVERRIDE routes only use ORG instances; they never fall back to PLATFORM.
 *   - Multiple PLATFORM instances per connector allowed; deterministic selection by is_enabled + created_at.
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

export type OrgOverrideRoute = GlobalRoute;

export interface ResolvedInstance {
  provider_connector_id: string;
  provider_instance_id: string;
  provider_name: string;
  scope?: "PLATFORM" | "ORG";
}

export interface ProviderCandidate {
  provider_instance_id: string | null;
  provider_connector_id?: string | null;
  provider_name: string;
  source: "EXTERNAL_PRIMARY" | "BUILTIN" | "EXTERNAL_FALLBACK";
  attempt_index: number;
  skip_reason?: string;
  route_source?: "ORG_OVERRIDE" | "GLOBAL" | "BUILTIN";
}

export type FallbackDecision =
  | "CONTINUE"
  | "STOP_OK"
  | "STOP_PENDING"
  | "STOP_EMPTY"
  | "STOP_ERROR";

export interface EffectivePolicy {
  strategy: string;
  merge_mode: string;
  merge_budget_max_providers: number;
  merge_budget_max_ms: number;
  allow_merge_on_empty: boolean;
  max_provider_attempts_per_run: number;
  source: "ORG_OVERRIDE" | "GLOBAL" | "BUILTIN";
}

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

/**
 * Build a chain from connector-based routes, resolving to instances.
 *
 * For GLOBAL routes: use platformInstances first. If missing → MISSING_PLATFORM_INSTANCE.
 * For ORG_OVERRIDE routes: use orgInstances only. Never fall back to PLATFORM.
 */
function buildConnectorChain(
  workflow: string,
  scope: "ACTS" | "PUBS",
  routes: GlobalRoute[],
  orgInstances: ResolvedInstance[],
  routeSource: "ORG_OVERRIDE" | "GLOBAL",
  platformInstances?: ResolvedInstance[],
): ProviderCandidate[] {
  const chain: ProviderCandidate[] = [];
  let attemptIndex = 0;

  const orgInstanceMap = new Map<string, ResolvedInstance>();
  for (const inst of orgInstances) {
    orgInstanceMap.set(inst.provider_connector_id, inst);
  }
  const platformInstanceMap = new Map<string, ResolvedInstance>();
  if (platformInstances) {
    for (const inst of platformInstances) {
      platformInstanceMap.set(inst.provider_connector_id, inst);
    }
  }

  const resolveInstance = (connectorId: string): ResolvedInstance | undefined => {
    if (routeSource === "GLOBAL") {
      // GLOBAL routes: PLATFORM instance only. No fallback to org instance.
      return platformInstanceMap.get(connectorId);
    }
    // ORG_OVERRIDE: org instances only. Never fall back to PLATFORM.
    return orgInstanceMap.get(connectorId);
  };

  const missingSkipReason = (connectorName: string, connectorId: string): string => {
    if (routeSource === "GLOBAL") {
      return `MISSING_PLATFORM_INSTANCE: No enabled PLATFORM instance for connector ${connectorName || connectorId}. Configure a platform instance via the wizard.`;
    }
    return `No enabled ORG instance for connector ${connectorName || connectorId}`;
  };

  const addRoutes = (filtered: GlobalRoute[], kind: "EXTERNAL_PRIMARY" | "EXTERNAL_FALLBACK") => {
    for (const r of filtered) {
      const inst = resolveInstance(r.provider_connector_id);
      if (inst) {
        chain.push({
          provider_instance_id: inst.provider_instance_id,
          provider_connector_id: r.provider_connector_id,
          provider_name: inst.provider_name,
          source: kind,
          attempt_index: attemptIndex++,
          route_source: routeSource,
        });
      } else {
        chain.push({
          provider_instance_id: null,
          provider_connector_id: r.provider_connector_id,
          provider_name: r.connector_name || "unknown",
          source: kind,
          attempt_index: attemptIndex++,
          skip_reason: missingSkipReason(r.connector_name || "", r.provider_connector_id),
          route_source: routeSource,
        });
      }
    }
  };

  const primaryRoutes = routes
    .filter((r) =>
      r.workflow === workflow &&
      r.route_kind === "PRIMARY" &&
      r.enabled &&
      (r.scope === scope || r.scope === "BOTH")
    )
    .sort((a, b) => a.priority - b.priority);
  addRoutes(primaryRoutes, "EXTERNAL_PRIMARY");

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
  addRoutes(fallbackRoutes, "EXTERNAL_FALLBACK");

  return chain;
}

export function resolveGlobalProviderChain(
  workflow: string,
  scope: "ACTS" | "PUBS",
  globalRoutes: GlobalRoute[],
  orgInstances: ResolvedInstance[],
  platformInstances?: ResolvedInstance[],
): ProviderCandidate[] {
  return buildConnectorChain(workflow, scope, globalRoutes, orgInstances, "GLOBAL", platformInstances);
}

export interface EffectiveResolutionInput {
  workflow: string;
  scope: "ACTS" | "PUBS";
  orgOverrideRoutes: GlobalRoute[];
  globalRoutes: GlobalRoute[];
  orgInstances: ResolvedInstance[];
  platformInstances?: ResolvedInstance[];
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
  const { workflow, scope, orgOverrideRoutes, globalRoutes, orgInstances, platformInstances, orgOverridePolicy, globalPolicy } = input;

  let policy: EffectivePolicy;
  if (orgOverridePolicy && orgOverridePolicy.strategy) {
    policy = { ...DEFAULT_POLICY, ...orgOverridePolicy, source: "ORG_OVERRIDE" };
  } else if (globalPolicy && globalPolicy.strategy) {
    policy = { ...DEFAULT_POLICY, ...globalPolicy, source: "GLOBAL" };
  } else {
    policy = { ...DEFAULT_POLICY };
  }

  const enabledOrgRoutes = orgOverrideRoutes.filter(
    (r) => r.workflow === workflow && r.enabled && (r.scope === scope || r.scope === "BOTH")
  );

  let chain: ProviderCandidate[];
  let routeSource: "ORG_OVERRIDE" | "GLOBAL" | "BUILTIN";

  if (enabledOrgRoutes.length > 0) {
    // ORG_OVERRIDE: uses org instances only, never falls back to PLATFORM
    chain = buildConnectorChain(workflow, scope, orgOverrideRoutes, orgInstances, "ORG_OVERRIDE");
    routeSource = "ORG_OVERRIDE";
  } else {
    const enabledGlobalRoutes = globalRoutes.filter(
      (r) => r.workflow === workflow && r.enabled && (r.scope === scope || r.scope === "BOTH")
    );
    if (enabledGlobalRoutes.length > 0) {
      // GLOBAL routes: PLATFORM instances only
      chain = buildConnectorChain(workflow, scope, globalRoutes, orgInstances, "GLOBAL", platformInstances);
      routeSource = "GLOBAL";
    } else {
      chain = buildConnectorChain(workflow, scope, [], orgInstances, "GLOBAL", platformInstances);
      routeSource = "BUILTIN";
    }
  }

  chain.forEach((c, i) => { c.attempt_index = i; });

  return { chain, policy, routeSource };
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
