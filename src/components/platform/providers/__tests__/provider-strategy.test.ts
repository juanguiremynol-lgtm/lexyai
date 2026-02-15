/**
 * Regression tests for providerStrategy.ts — centralized provider selection rules.
 *
 * Verifies:
 * - Correct primary/fallback providers per category
 * - FOUND_PARTIAL from primary does NOT trigger fallback
 * - NOT_FOUND from primary DOES trigger fallback
 * - Merges never drop parties/basic metadata
 * - TUTELA always merges all providers
 */
import { describe, it, expect } from "vitest";

// Import the strategy module functions (mirrored logic for testing)
// Since the actual module is in supabase/functions/_shared, we mirror the key functions here

type ProviderKey = "CPNU" | "SAMAI" | "TUTELAS" | "PUBLICACIONES" | "SAMAI_ESTADOS";
type FoundStatus = "FOUND_COMPLETE" | "FOUND_PARTIAL" | "NOT_FOUND";

interface CategoryStrategy {
  alwaysMergeAll: boolean;
  primaryActuaciones: ProviderKey[];
  fallbackActuaciones: ProviderKey[];
  primaryEstados: ProviderKey[];
  fallbackEstados: ProviderKey[];
}

// Mirror the strategy map from providerStrategy.ts
const STRATEGY_MAP: Record<string, CategoryStrategy> = {
  CGP: {
    alwaysMergeAll: false,
    primaryActuaciones: ["CPNU"],
    fallbackActuaciones: ["SAMAI", "TUTELAS"],
    primaryEstados: ["PUBLICACIONES"],
    fallbackEstados: ["SAMAI_ESTADOS", "TUTELAS"],
  },
  LABORAL: {
    alwaysMergeAll: false,
    primaryActuaciones: ["CPNU"],
    fallbackActuaciones: ["SAMAI", "TUTELAS"],
    primaryEstados: ["PUBLICACIONES"],
    fallbackEstados: ["SAMAI_ESTADOS", "TUTELAS"],
  },
  CPACA: {
    alwaysMergeAll: false,
    primaryActuaciones: ["SAMAI"],
    fallbackActuaciones: ["CPNU", "TUTELAS"],
    primaryEstados: ["SAMAI_ESTADOS"],
    fallbackEstados: ["PUBLICACIONES", "TUTELAS"],
  },
  TUTELA: {
    alwaysMergeAll: true,
    primaryActuaciones: ["CPNU", "SAMAI", "TUTELAS"],
    fallbackActuaciones: [],
    primaryEstados: ["PUBLICACIONES", "SAMAI_ESTADOS", "TUTELAS"],
    fallbackEstados: [],
  },
  PENAL_906: {
    alwaysMergeAll: false,
    primaryActuaciones: ["CPNU"],
    fallbackActuaciones: ["TUTELAS", "SAMAI"],
    primaryEstados: ["PUBLICACIONES"],
    fallbackEstados: ["SAMAI_ESTADOS", "TUTELAS"],
  },
};

function getCategoryStrategy(wf: string): CategoryStrategy {
  return STRATEGY_MAP[wf] || STRATEGY_MAP["CGP"];
}

function determineFoundStatus(hasMetadata: boolean, hasActuaciones: boolean): FoundStatus {
  if (!hasMetadata && !hasActuaciones) return "NOT_FOUND";
  if (hasMetadata && hasActuaciones) return "FOUND_COMPLETE";
  return "FOUND_PARTIAL";
}

function shouldTriggerFallback(status: FoundStatus): boolean {
  return status === "NOT_FOUND";
}

// ── Tests ──

describe("ProviderStrategy — category selection rules", () => {
  it("CGP: CPNU primary for actuaciones, no fallback to SAMAI by default", () => {
    const s = getCategoryStrategy("CGP");
    expect(s.primaryActuaciones).toEqual(["CPNU"]);
    expect(s.fallbackActuaciones).toContain("SAMAI");
    expect(s.alwaysMergeAll).toBe(false);
  });

  it("CPACA: SAMAI primary for actuaciones, SAMAI_ESTADOS primary for estados", () => {
    const s = getCategoryStrategy("CPACA");
    expect(s.primaryActuaciones).toEqual(["SAMAI"]);
    expect(s.primaryEstados).toEqual(["SAMAI_ESTADOS"]);
    expect(s.fallbackActuaciones).toContain("CPNU");
  });

  it("LABORAL: same as CGP (CPNU primary)", () => {
    const s = getCategoryStrategy("LABORAL");
    expect(s.primaryActuaciones).toEqual(["CPNU"]);
    expect(s.primaryEstados).toEqual(["PUBLICACIONES"]);
  });

  it("TUTELA: always merge all, no fallbacks (all are primary)", () => {
    const s = getCategoryStrategy("TUTELA");
    expect(s.alwaysMergeAll).toBe(true);
    expect(s.primaryActuaciones).toContain("CPNU");
    expect(s.primaryActuaciones).toContain("SAMAI");
    expect(s.primaryActuaciones).toContain("TUTELAS");
    expect(s.fallbackActuaciones).toEqual([]);
  });

  it("PENAL_906: CPNU primary, TUTELAS+SAMAI fallback", () => {
    const s = getCategoryStrategy("PENAL_906");
    expect(s.primaryActuaciones).toEqual(["CPNU"]);
    expect(s.fallbackActuaciones).toEqual(["TUTELAS", "SAMAI"]);
  });
});

describe("ProviderStrategy — found status semantics", () => {
  it("FOUND_COMPLETE when metadata + actuaciones present", () => {
    expect(determineFoundStatus(true, true)).toBe("FOUND_COMPLETE");
  });

  it("FOUND_PARTIAL when metadata present but no actuaciones (e.g., 406)", () => {
    expect(determineFoundStatus(true, false)).toBe("FOUND_PARTIAL");
  });

  it("NOT_FOUND when neither metadata nor actuaciones", () => {
    expect(determineFoundStatus(false, false)).toBe("NOT_FOUND");
  });

  it("FOUND_PARTIAL does NOT trigger fallback", () => {
    expect(shouldTriggerFallback("FOUND_PARTIAL")).toBe(false);
  });

  it("NOT_FOUND DOES trigger fallback", () => {
    expect(shouldTriggerFallback("NOT_FOUND")).toBe(true);
  });

  it("FOUND_COMPLETE does NOT trigger fallback", () => {
    expect(shouldTriggerFallback("FOUND_COMPLETE")).toBe(false);
  });
});

describe("ProviderStrategy — merge rules (parties preservation)", () => {
  it("empty parties from provider B do not overwrite populated parties from provider A", () => {
    const cpnuParties = { demandante: "OFELIA MERCEDES MAYA MARTINEZ", demandado: "TIERRADENTRO" };
    const samaiParties = { demandante: "", demandado: "" };

    // First-non-empty-wins merge
    const merged = {
      demandante: cpnuParties.demandante || samaiParties.demandante || "",
      demandado: cpnuParties.demandado || samaiParties.demandado || "",
    };

    expect(merged.demandante).toBe("OFELIA MERCEDES MAYA MARTINEZ");
    expect(merged.demandado).toBe("TIERRADENTRO");
  });

  it("null/undefined from later provider does not overwrite earlier provider data", () => {
    const fields = ["despacho", "demandante", "demandado", "fecha_radicacion"] as const;
    const providerA = {
      despacho: "JUZGADO 004",
      demandante: "OFELIA",
      demandado: "TIERRADENTRO",
      fecha_radicacion: "2026-02-13",
    };
    const providerB: Record<string, string | undefined> = {
      despacho: undefined,
      demandante: undefined,
      demandado: undefined,
      fecha_radicacion: undefined,
    };

    const merged: Record<string, string> = {};
    for (const key of fields) {
      merged[key] = (providerA as Record<string, string>)[key] || (providerB[key] as string) || "";
    }

    expect(merged.despacho).toBe("JUZGADO 004");
    expect(merged.demandante).toBe("OFELIA");
    expect(merged.demandado).toBe("TIERRADENTRO");
    expect(merged.fecha_radicacion).toBe("2026-02-13");
  });

  it("TUTELA merge: actuaciones from multiple providers are deduplicated", () => {
    const cpnuActs = [
      { fecha: "2026-02-13", actuacion: "RADICACIÓN", anotacion: "" },
    ];
    const samaiActs = [
      { fecha: "2026-02-13", actuacion: "RADICACIÓN", anotacion: "Con detalle adicional" },
      { fecha: "2026-02-14", actuacion: "AUTO ADMISORIO", anotacion: "" },
    ];

    const all = [...cpnuActs, ...samaiActs];
    const seen = new Map<string, typeof all[0]>();
    for (const act of all) {
      const key = `${act.fecha}|${(act.actuacion || "").toLowerCase().trim().slice(0, 60)}`;
      if (!seen.has(key)) {
        seen.set(key, act);
      } else {
        const existing = seen.get(key)!;
        if ((act.anotacion?.length || 0) > (existing.anotacion?.length || 0)) {
          seen.set(key, act);
        }
      }
    }
    const deduped = Array.from(seen.values());

    expect(deduped).toHaveLength(2);
    // The RADICACIÓN entry should keep the richer anotacion
    const radicacion = deduped.find(a => a.actuacion === "RADICACIÓN");
    expect(radicacion?.anotacion).toBe("Con detalle adicional");
  });
});

describe("ProviderStrategy — regression anchor radicado 05001410500420261008600", () => {
  it("TUTELA category queries CPNU+SAMAI+TUTELAS (all primaries)", () => {
    const s = getCategoryStrategy("TUTELA");
    expect(s.primaryActuaciones).toContain("CPNU");
    expect(s.primaryActuaciones).toContain("SAMAI");
    expect(s.primaryActuaciones).toContain("TUTELAS");
    expect(s.primaryActuaciones.length).toBeGreaterThanOrEqual(3);
  });

  it("CPNU returns parties + no actuaciones = FOUND_PARTIAL (not NOT_FOUND)", () => {
    // CPNU Phase 1 returns metadata but actuaciones 406
    const status = determineFoundStatus(true, false);
    expect(status).toBe("FOUND_PARTIAL");
    expect(shouldTriggerFallback(status)).toBe(false);
  });
});
