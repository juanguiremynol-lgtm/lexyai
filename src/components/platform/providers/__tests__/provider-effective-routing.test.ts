/**
 * Tests for effective routing resolution: org override → global → builtin.
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
    const instances: ResolvedInstance[] = [
      { provider_connector_id: "g-conn-1", provider_instance_id: "g-inst-1", provider_name: "GlobalInst" },
    ];

    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes: [],
      globalRoutes,
      orgInstances: instances,
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
    expect(result.chain[0].skip_reason).toContain("No enabled instance");
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

  it("ORG_PRIVATE connector in global routes is not special — just needs org instance", () => {
    // This verifies connector visibility doesn't leak: routing works by connector_id,
    // instance must exist for the org.
    const globalRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "private-conn", connector_name: "PrivateConn" }),
    ];
    // Org A has an instance, Org B doesn't
    const orgAInstances: ResolvedInstance[] = [
      { provider_connector_id: "private-conn", provider_instance_id: "a-inst", provider_name: "AInst" },
    ];

    const resultA = resolveEffectivePolicyAndChain({
      workflow: "CGP", scope: "ACTS",
      orgOverrideRoutes: [], globalRoutes, orgInstances: orgAInstances,
    });
    expect(resultA.chain[0].provider_name).toBe("AInst");
    expect(resultA.chain[0].skip_reason).toBeUndefined();

    // Org B: no instance → skip
    const resultB = resolveEffectivePolicyAndChain({
      workflow: "CGP", scope: "ACTS",
      orgOverrideRoutes: [], globalRoutes, orgInstances: [],
    });
    expect(resultB.chain[0].skip_reason).toContain("No enabled instance");
  });
});

describe("CPACA ESTADOS routing policy", () => {
  it("CPACA PUBS built-in includes publicaciones as fallback", () => {
    const result = resolveEffectivePolicyAndChain({
      workflow: "CPACA",
      scope: "PUBS",
      orgOverrideRoutes: [],
      globalRoutes: [],
      orgInstances: [],
    });

    // Without DB routes, CPACA PUBS should have publicaciones as built-in
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

describe("backward compat: legacy resolvers still work", () => {
  it("resolveProviderChain CGP/ACTS with no routes", () => {
    const chain = resolveProviderChain("CGP", "ACTS", []);
    expect(chain.map(c => c.provider_name)).toEqual(["cpnu"]);
  });

  it("resolveGlobalProviderChain still works", () => {
    const routes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-1" }),
    ];
    const instances: ResolvedInstance[] = [
      { provider_connector_id: "conn-1", provider_instance_id: "inst-1", provider_name: "Prov1" },
    ];
    const chain = resolveGlobalProviderChain("CGP", "ACTS", routes, instances);
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
