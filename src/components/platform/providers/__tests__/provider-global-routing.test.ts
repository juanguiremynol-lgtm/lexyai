/**
 * Tests for global provider routing resolution.
 */

import { describe, it, expect } from "vitest";
import {
  resolveProviderChain,
  resolveGlobalProviderChain,
  resolveEffectivePolicyAndChain,
  decideFallback,
  type CategoryRoute,
  type GlobalRoute,
  type ResolvedInstance,
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

describe("resolveGlobalProviderChain", () => {
  it("resolves global routes to org instances", () => {
    const routes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-1", connector_name: "ExtProvider" }),
    ];
    const instances: ResolvedInstance[] = [
      { provider_connector_id: "conn-1", provider_instance_id: "inst-1", provider_name: "OrgExtProvider" },
    ];
    const chain = resolveGlobalProviderChain("CGP", "ACTS", routes, instances);
    expect(chain[0].provider_instance_id).toBe("inst-1");
    expect(chain[0].provider_name).toBe("OrgExtProvider");
    expect(chain[0].source).toBe("EXTERNAL_PRIMARY");
    expect(chain[0].skip_reason).toBeUndefined();
    // Built-in still present after
    expect(chain[1].provider_name).toBe("cpnu");
  });

  it("skips connector when org has no instance (with skip_reason)", () => {
    const routes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-missing", connector_name: "MissingProvider" }),
    ];
    const chain = resolveGlobalProviderChain("CGP", "ACTS", routes, []);
    expect(chain[0].provider_instance_id).toBeNull();
    expect(chain[0].skip_reason).toContain("No enabled instance");
    // Built-in still follows
    expect(chain[1].provider_name).toBe("cpnu");
    expect(chain[1].source).toBe("BUILTIN");
  });

  it("backward compat: no global routes returns only built-in defaults", () => {
    const chain = resolveGlobalProviderChain("CGP", "ACTS", [], []);
    expect(chain.map(c => c.provider_name)).toEqual(["cpnu"]);
    expect(chain[0].source).toBe("BUILTIN");
  });

  it("FALLBACK routes also resolve to org instances", () => {
    const routes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-fb", route_kind: "FALLBACK", connector_name: "FBConn" }),
    ];
    const instances: ResolvedInstance[] = [
      { provider_connector_id: "conn-fb", provider_instance_id: "fb-inst-1", provider_name: "FBInstance" },
    ];
    const chain = resolveGlobalProviderChain("CGP", "ACTS", routes, instances);
    // Built-in first, then fallback
    expect(chain[0].source).toBe("BUILTIN");
    expect(chain[1].provider_instance_id).toBe("fb-inst-1");
    expect(chain[1].source).toBe("EXTERNAL_FALLBACK");
  });

  it("attempt_index is sequential across all candidates", () => {
    const routes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "c1", priority: 0 }),
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "c2", route_kind: "FALLBACK", priority: 0 }),
    ];
    const instances: ResolvedInstance[] = [
      { provider_connector_id: "c1", provider_instance_id: "i1", provider_name: "P1" },
      { provider_connector_id: "c2", provider_instance_id: "i2", provider_name: "P2" },
    ];
    const chain = resolveGlobalProviderChain("CGP", "ACTS", routes, instances);
    expect(chain.map(c => c.attempt_index)).toEqual([0, 1, 2]);
  });
});

describe("legacy resolveProviderChain still works", () => {
  it("CGP/ACTS with no routes returns cpnu", () => {
    const chain = resolveProviderChain("CGP", "ACTS", []);
    expect(chain.map(c => c.provider_name)).toEqual(["cpnu"]);
  });
});

describe("decideFallback with global context", () => {
  it("SELECT mode: OK stops", () => {
    expect(decideFallback("OK", true, false)).toBe("STOP_OK");
  });

  it("MERGE mode: EMPTY + allow=true continues", () => {
    expect(decideFallback("PROVIDER_EMPTY_RESULT", false, true)).toBe("CONTINUE");
  });

  it("MERGE mode: EMPTY + allow=false stops", () => {
    expect(decideFallback("PROVIDER_EMPTY_RESULT", false, false)).toBe("STOP_EMPTY");
  });
});
