/**
 * Tests for effective routing resolution: org override → global → builtin.
 * Includes subchain isolation, scope gating, and invariant coverage tests.
 */

import { describe, it, expect } from "vitest";
import {
  resolveEffectivePolicyAndChain,
  resolveProviderChain,
  resolveGlobalProviderChain,
  decideFallback,
  type GlobalRoute,
  type ResolvedInstance,
  type EffectivePolicy,
} from "@/lib/resolveProviderChain";

function makeGlobalRoute(overrides: Partial<GlobalRoute> & { workflow: string; provider_connector_id: string }): GlobalRoute {
  return {
    id: crypto.randomUUID(),
    scope: "BOTH",
    route_kind: "PRIMARY",
    priority: 0,
    is_authoritative: false,
    enabled: true,
    connector_name: "TestConnector",
    ...overrides,
  };
}

describe("resolveEffectivePolicyAndChain", () => {
  it("org override routes take precedence over global routes", () => {
    const orgRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "org-conn-1", connector_name: "OrgProvider" }),
    ];
    const globalRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "global-conn-1", connector_name: "GlobalProvider" }),
    ];
    const instances: ResolvedInstance[] = [
      { provider_connector_id: "org-conn-1", provider_instance_id: "org-inst-1", provider_name: "OrgInst" },
      { provider_connector_id: "global-conn-1", provider_instance_id: "global-inst-1", provider_name: "GlobalInst" },
    ];

    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes: orgRoutes,
      globalRoutes,
      orgInstances: instances,
    });

    expect(result.routeSource).toBe("ORG_OVERRIDE");
    expect(result.chain[0].provider_name).toBe("OrgInst");
    expect(result.chain[0].route_source).toBe("ORG_OVERRIDE");
    // Built-in should still be present
    expect(result.chain.find(c => c.source === "BUILTIN")).toBeTruthy();
  });

  it("falls back to global routes when no org override exists", () => {
    const globalRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "g-conn-1", connector_name: "GlobalProv" }),
    ];
    const platformInstances: ResolvedInstance[] = [
      { provider_connector_id: "g-conn-1", provider_instance_id: "g-inst-1", provider_name: "GlobalInst", scope: "PLATFORM" },
    ];

    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes: [],
      globalRoutes,
      orgInstances: [],
      platformInstances,
    });

    expect(result.routeSource).toBe("GLOBAL");
    expect(result.chain[0].provider_name).toBe("GlobalInst");
    expect(result.chain[0].route_source).toBe("GLOBAL");
  });

  it("falls back to built-in when no routes exist", () => {
    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes: [],
      globalRoutes: [],
      orgInstances: [],
    });

    expect(result.routeSource).toBe("BUILTIN");
    expect(result.chain.map(c => c.provider_name)).toEqual(["cpnu"]);
    expect(result.chain[0].source).toBe("BUILTIN");
  });

  it("org override policy takes precedence over global policy", () => {
    const orgPolicy: Partial<EffectivePolicy> = {
      strategy: "MERGE",
      merge_mode: "VERIFY_ONLY",
    };
    const globalPolicy: Partial<EffectivePolicy> = {
      strategy: "SELECT",
      merge_mode: "UNION",
    };

    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes: [],
      globalRoutes: [],
      orgInstances: [],
      orgOverridePolicy: orgPolicy,
      globalPolicy,
    });

    expect(result.policy.source).toBe("ORG_OVERRIDE");
    expect(result.policy.strategy).toBe("MERGE");
    expect(result.policy.merge_mode).toBe("VERIFY_ONLY");
  });

  it("global policy used when no org override policy", () => {
    const globalPolicy: Partial<EffectivePolicy> = {
      strategy: "MERGE",
      merge_budget_max_providers: 3,
    };

    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes: [],
      globalRoutes: [],
      orgInstances: [],
      globalPolicy,
    });

    expect(result.policy.source).toBe("GLOBAL");
    expect(result.policy.strategy).toBe("MERGE");
    expect(result.policy.merge_budget_max_providers).toBe(3);
  });

  it("missing org instance causes skip with skip_reason", () => {
    const orgRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "missing-conn", connector_name: "MissingProv" }),
    ];

    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes: orgRoutes,
      globalRoutes: [],
      orgInstances: [], // no instances
    });

    expect(result.routeSource).toBe("ORG_OVERRIDE");
    expect(result.chain[0].skip_reason).toContain("No enabled ORG instance");
    expect(result.chain[0].provider_instance_id).toBeNull();
    // Built-in fallback still present
    expect(result.chain[1].provider_name).toBe("cpnu");
    expect(result.chain[1].source).toBe("BUILTIN");
  });

  it("attempt_index is sequential across entire chain", () => {
    const orgRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "c1", priority: 0, connector_name: "P1" }),
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "c2", route_kind: "FALLBACK", priority: 0, connector_name: "FB1" }),
    ];
    const instances: ResolvedInstance[] = [
      { provider_connector_id: "c1", provider_instance_id: "i1", provider_name: "P1" },
      { provider_connector_id: "c2", provider_instance_id: "i2", provider_name: "FB1" },
    ];

    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes: orgRoutes,
      globalRoutes: [],
      orgInstances: instances,
    });

    expect(result.chain.map(c => c.attempt_index)).toEqual([0, 1, 2]);
  });

  it("GLOBAL routes resolve to PLATFORM instances, not ORG instances", () => {
    const globalRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "private-conn", connector_name: "PrivateConn" }),
    ];
    const platformInstances: ResolvedInstance[] = [
      { provider_connector_id: "private-conn", provider_instance_id: "plat-inst", provider_name: "PlatInst", scope: "PLATFORM" },
    ];

    const resultA = resolveEffectivePolicyAndChain({
      workflow: "CGP", scope: "ACTS",
      orgOverrideRoutes: [], globalRoutes, orgInstances: [], platformInstances,
    });
    expect(resultA.chain[0].provider_name).toBe("PlatInst");
    expect(resultA.chain[0].skip_reason).toBeUndefined();

    // Without platform instance → skip
    const resultB = resolveEffectivePolicyAndChain({
      workflow: "CGP", scope: "ACTS",
      orgOverrideRoutes: [], globalRoutes, orgInstances: [],
    });
    expect(resultB.chain[0].skip_reason).toContain("MISSING_PLATFORM_INSTANCE");
  });
});

// ── CPACA ESTADOS routing policy ──

describe("CPACA ESTADOS routing policy", () => {
  it("CPACA PUBS built-in includes publicaciones as fallback", () => {
    const result = resolveEffectivePolicyAndChain({
      workflow: "CPACA",
      scope: "PUBS",
      orgOverrideRoutes: [],
      globalRoutes: [],
      orgInstances: [],
    });

    expect(result.routeSource).toBe("BUILTIN");
    expect(result.chain.map(c => c.provider_name)).toEqual(["publicaciones"]);
  });

  it("CPACA PUBS with SAMAI_ESTADOS global route: primary + built-in fallback", () => {
    const globalRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CPACA", scope: "PUBS", provider_connector_id: "samai-est-conn", connector_name: "SAMAI Estados" }),
    ];
    const platformInstances: ResolvedInstance[] = [
      { provider_connector_id: "samai-est-conn", provider_instance_id: "plat-inst", provider_name: "SAMAI Estados (Platform)", scope: "PLATFORM" },
    ];

    const result = resolveEffectivePolicyAndChain({
      workflow: "CPACA",
      scope: "PUBS",
      orgOverrideRoutes: [],
      globalRoutes,
      orgInstances: [],
      platformInstances,
    });

    expect(result.routeSource).toBe("GLOBAL");
    expect(result.chain.length).toBe(2);
    expect(result.chain[0].provider_name).toBe("SAMAI Estados (Platform)");
    expect(result.chain[0].source).toBe("EXTERNAL_PRIMARY");
    expect(result.chain[1].provider_name).toBe("publicaciones");
    expect(result.chain[1].source).toBe("BUILTIN");
  });

  it("CGP PUBS chain: publicaciones is built-in primary (no external)", () => {
    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "PUBS",
      orgOverrideRoutes: [],
      globalRoutes: [],
      orgInstances: [],
    });

    expect(result.chain.map(c => c.provider_name)).toEqual(["publicaciones"]);
    expect(result.chain[0].source).toBe("BUILTIN");
  });
});

// ── Scope gating: subchain isolation ──

describe("scope gating: subchain isolation", () => {
  it("ACTS-scoped route does NOT appear in PUBS chain", () => {
    const globalRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", scope: "ACTS", provider_connector_id: "acts-only-conn", connector_name: "ActsOnly" }),
    ];
    const platformInstances: ResolvedInstance[] = [
      { provider_connector_id: "acts-only-conn", provider_instance_id: "acts-inst", provider_name: "ActsOnlyInst", scope: "PLATFORM" },
    ];

    const pubsResult = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "PUBS",
      orgOverrideRoutes: [],
      globalRoutes,
      orgInstances: [],
      platformInstances,
    });

    // ACTS-only route must NOT appear in PUBS chain
    const hasActsProvider = pubsResult.chain.some(c => c.provider_name === "ActsOnlyInst");
    expect(hasActsProvider).toBe(false);
  });

  it("PUBS-scoped route does NOT appear in ACTS chain", () => {
    const globalRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", scope: "PUBS", provider_connector_id: "pubs-only-conn", connector_name: "PubsOnly" }),
    ];
    const platformInstances: ResolvedInstance[] = [
      { provider_connector_id: "pubs-only-conn", provider_instance_id: "pubs-inst", provider_name: "PubsOnlyInst", scope: "PLATFORM" },
    ];

    const actsResult = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes: [],
      globalRoutes,
      orgInstances: [],
      platformInstances,
    });

    const hasPubsProvider = actsResult.chain.some(c => c.provider_name === "PubsOnlyInst");
    expect(hasPubsProvider).toBe(false);
  });

  it("BOTH-scoped route appears in BOTH chains", () => {
    const globalRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", scope: "BOTH", provider_connector_id: "both-conn", connector_name: "BothProvider" }),
    ];
    const platformInstances: ResolvedInstance[] = [
      { provider_connector_id: "both-conn", provider_instance_id: "both-inst", provider_name: "BothInst", scope: "PLATFORM" },
    ];

    const actsResult = resolveEffectivePolicyAndChain({
      workflow: "CGP", scope: "ACTS",
      orgOverrideRoutes: [], globalRoutes, orgInstances: [], platformInstances,
    });
    const pubsResult = resolveEffectivePolicyAndChain({
      workflow: "CGP", scope: "PUBS",
      orgOverrideRoutes: [], globalRoutes, orgInstances: [], platformInstances,
    });

    expect(actsResult.chain.some(c => c.provider_name === "BothInst")).toBe(true);
    expect(pubsResult.chain.some(c => c.provider_name === "BothInst")).toBe(true);
  });
});

// ── Built-in provider determinism ──

describe("built-in provider determinism per workflow", () => {
  const workflows = [
    { wf: "CGP", acts: ["cpnu"], pubs: ["publicaciones"] },
    { wf: "LABORAL", acts: ["cpnu"], pubs: ["publicaciones"] },
    { wf: "CPACA", acts: ["samai"], pubs: ["publicaciones"] },
    { wf: "TUTELA", acts: ["cpnu", "tutelas-api"], pubs: [] },
    { wf: "PENAL_906", acts: ["cpnu", "samai"], pubs: ["publicaciones"] },
  ];

  for (const { wf, acts, pubs } of workflows) {
    it(`${wf} ACTS built-in = [${acts.join(", ")}]`, () => {
      const result = resolveEffectivePolicyAndChain({
        workflow: wf, scope: "ACTS",
        orgOverrideRoutes: [], globalRoutes: [], orgInstances: [],
      });
      const builtinNames = result.chain.filter(c => c.source === "BUILTIN").map(c => c.provider_name);
      expect(builtinNames).toEqual(acts);
    });

    it(`${wf} PUBS built-in = [${pubs.join(", ")}]`, () => {
      const result = resolveEffectivePolicyAndChain({
        workflow: wf, scope: "PUBS",
        orgOverrideRoutes: [], globalRoutes: [], orgInstances: [],
      });
      const builtinNames = result.chain.filter(c => c.source === "BUILTIN").map(c => c.provider_name);
      expect(builtinNames).toEqual(pubs);
    });
  }
});

// ── Backward compat ──

describe("backward compat: legacy resolvers still work", () => {
  it("resolveProviderChain CGP/ACTS with no routes", () => {
    const chain = resolveProviderChain("CGP", "ACTS", []);
    expect(chain.map(c => c.provider_name)).toEqual(["cpnu"]);
  });

  it("resolveGlobalProviderChain still works with platform instances", () => {
    const routes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-1" }),
    ];
    const platformInstances: ResolvedInstance[] = [
      { provider_connector_id: "conn-1", provider_instance_id: "inst-1", provider_name: "Prov1", scope: "PLATFORM" },
    ];
    const chain = resolveGlobalProviderChain("CGP", "ACTS", routes, [], platformInstances);
    expect(chain[0].provider_name).toBe("Prov1");
  });
});

describe("decideFallback (unchanged)", () => {
  it("OK stops", () => {
    expect(decideFallback("OK", true, false)).toBe("STOP_OK");
  });
  it("EMPTY + allow=true continues", () => {
    expect(decideFallback("PROVIDER_EMPTY_RESULT", false, true)).toBe("CONTINUE");
  });
  it("EMPTY + allow=false stops", () => {
    expect(decideFallback("PROVIDER_EMPTY_RESULT", false, false)).toBe("STOP_EMPTY");
  });
});
