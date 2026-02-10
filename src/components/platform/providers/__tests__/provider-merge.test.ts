/**
 * Tests for merge engine logic and merge-aware routing.
 */

import { describe, it, expect } from "vitest";
import {
  buildActDedupeKey,
  buildPubDedupeKey,
} from "@/lib/mergeEngine";
import {
  resolveProviderChain,
  decideFallback,
  type CategoryRoute,
} from "@/lib/resolveProviderChain";

// ────── Dedupe key tests ──────

describe("buildActDedupeKey", () => {
  it("produces stable key from date + description", () => {
    const key = buildActDedupeKey({ act_date: "2024-01-15", description: "Auto admite demanda" });
    expect(key).toBe("act|2024-01-15|auto admite demanda");
  });

  it("uses 'unknown' for missing date", () => {
    const key = buildActDedupeKey({ description: "Test" });
    expect(key).toContain("act|unknown|");
  });

  it("truncates description at 200 chars", () => {
    const longDesc = "x".repeat(300);
    const key = buildActDedupeKey({ act_date: "2024-01-01", description: longDesc });
    expect(key.length).toBeLessThan(250);
  });

  it("same content from different providers produces same key", () => {
    const key1 = buildActDedupeKey({ act_date: "2024-03-10", description: "Sentencia favorable" });
    const key2 = buildActDedupeKey({ act_date: "2024-03-10", description: "Sentencia favorable" });
    expect(key1).toBe(key2);
  });
});

describe("buildPubDedupeKey", () => {
  it("includes tipo_publicacion in key", () => {
    const key = buildPubDedupeKey({
      pub_date: "2024-02-20",
      tipo_publicacion: "ESTADO",
      description: "Estado del proceso",
    });
    expect(key).toContain("pub|2024-02-20|estado|");
  });
});

// ────── Merge-aware routing tests ──────

function makeRoute(
  overrides: Partial<CategoryRoute> & { workflow: string; provider_instance_id: string },
): CategoryRoute {
  return {
    id: crypto.randomUUID(),
    scope: "BOTH",
    route_kind: "PRIMARY",
    priority: 0,
    enabled: true,
    provider_name: "TestProvider",
    ...overrides,
  };
}

describe("resolveProviderChain with authoritative", () => {
  it("authoritative route is included in chain", () => {
    const routes: CategoryRoute[] = [
      makeRoute({
        workflow: "CGP",
        provider_instance_id: "auth-1",
        is_authoritative: true,
        provider_name: "AuthProvider",
      }),
    ];
    const chain = resolveProviderChain("CGP", "ACTS", routes);
    expect(chain[0].provider_name).toBe("AuthProvider");
    expect(chain[0].source).toBe("EXTERNAL_PRIMARY");
  });
});

describe("decideFallback merge semantics", () => {
  it("EMPTY + allow_fallback=true (merge on empty) → CONTINUE", () => {
    expect(decideFallback("PROVIDER_EMPTY_RESULT", false, true)).toBe("CONTINUE");
  });

  it("EMPTY + allow_fallback=false → STOP_EMPTY", () => {
    expect(decideFallback("PROVIDER_EMPTY_RESULT", false, false)).toBe("STOP_EMPTY");
  });

  it("OK always stops", () => {
    expect(decideFallback("OK", true, true)).toBe("STOP_OK");
  });

  it("SCRAPING_PENDING always stops (no merge through pending)", () => {
    expect(decideFallback("SCRAPING_PENDING", false, true)).toBe("STOP_PENDING");
  });

  it("SCRAPING_STUCK continues to next provider", () => {
    expect(decideFallback("SCRAPING_STUCK", false, false)).toBe("CONTINUE");
  });

  it("strict 404 codes result in STOP_ERROR", () => {
    expect(decideFallback("PROVIDER_404", false, false)).toBe("STOP_ERROR");
  });
});

// ────── Chain correctness per workflow ──────

describe("built-in chain defaults", () => {
  it("CGP/ACTS defaults to cpnu", () => {
    const chain = resolveProviderChain("CGP", "ACTS", []);
    expect(chain.map(c => c.provider_name)).toEqual(["cpnu"]);
  });

  it("CPACA/ACTS defaults to samai", () => {
    const chain = resolveProviderChain("CPACA", "ACTS", []);
    expect(chain.map(c => c.provider_name)).toEqual(["samai"]);
  });

  it("TUTELA/ACTS defaults to cpnu → tutelas-api", () => {
    const chain = resolveProviderChain("TUTELA", "ACTS", []);
    expect(chain.map(c => c.provider_name)).toEqual(["cpnu", "tutelas-api"]);
  });

  it("PENAL_906/ACTS defaults to cpnu → samai", () => {
    const chain = resolveProviderChain("PENAL_906", "ACTS", []);
    expect(chain.map(c => c.provider_name)).toEqual(["cpnu", "samai"]);
  });

  it("CGP/PUBS defaults to publicaciones", () => {
    const chain = resolveProviderChain("CGP", "PUBS", []);
    expect(chain.map(c => c.provider_name)).toEqual(["publicaciones"]);
  });
});

// ────── Trace attribution ──────

describe("trace attribution fields", () => {
  it("every candidate has attempt_index, source, and provider_instance_id", () => {
    const routes: CategoryRoute[] = [
      makeRoute({ workflow: "CGP", provider_instance_id: "ext-1", provider_name: "Ext1" }),
      makeRoute({ workflow: "CGP", provider_instance_id: "fb-1", route_kind: "FALLBACK", provider_name: "FB1" }),
    ];
    const chain = resolveProviderChain("CGP", "ACTS", routes);
    for (const c of chain) {
      expect(c).toHaveProperty("attempt_index");
      expect(c).toHaveProperty("source");
      expect(typeof c.provider_name).toBe("string");
    }
    // Verify sequential indexing
    expect(chain.map(c => c.attempt_index)).toEqual([0, 1, 2]);
  });
});
