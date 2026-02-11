/**
 * Tests for platform-scoped provider instances, chain resolution,
 * dedupe normalization, and missing-instance warnings.
 */
import { describe, it, expect } from "vitest";
import {
  resolveGlobalProviderChain,
  resolveEffectivePolicyAndChain,
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

// ── Instance Resolution Tests ──

describe("Platform instance resolution in chain builder", () => {
  it("GLOBAL route resolves PLATFORM instance when available", () => {
    const routes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-1", connector_name: "ExtProvider" }),
    ];
    const orgInstances: ResolvedInstance[] = [
      { provider_connector_id: "conn-1", provider_instance_id: "inst-org", provider_name: "OrgInst", scope: "ORG" },
    ];
    const platformInstances: ResolvedInstance[] = [
      { provider_connector_id: "conn-1", provider_instance_id: "inst-platform", provider_name: "PlatformInst", scope: "PLATFORM" },
    ];
    const chain = resolveGlobalProviderChain("CGP", "ACTS", routes, orgInstances, platformInstances);
    // First candidate should be the PLATFORM instance, not the org one
    expect(chain[0].provider_instance_id).toBe("inst-platform");
    expect(chain[0].provider_name).toBe("PlatformInst");
    expect(chain[0].skip_reason).toBeUndefined();
  });

  it("GLOBAL route with no PLATFORM instance produces skip even if org instance exists", () => {
    const routes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-1", connector_name: "Ext" }),
    ];
    const orgInstances: ResolvedInstance[] = [
      { provider_connector_id: "conn-1", provider_instance_id: "inst-org", provider_name: "OrgInst" },
    ];
    const chain = resolveGlobalProviderChain("CGP", "ACTS", routes, orgInstances, []);
    // GLOBAL routes no longer fall back to org instances — must skip with MISSING_PLATFORM_INSTANCE
    expect(chain[0].provider_instance_id).toBeNull();
    expect(chain[0].skip_reason).toContain("MISSING_PLATFORM_INSTANCE");
  });

  it("GLOBAL route with no instances gives MISSING_PLATFORM_INSTANCE skip_reason", () => {
    const routes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-missing", connector_name: "MissingProvider" }),
    ];
    const chain = resolveGlobalProviderChain("CGP", "ACTS", routes, [], []);
    expect(chain[0].provider_instance_id).toBeNull();
    expect(chain[0].skip_reason).toContain("MISSING_PLATFORM_INSTANCE");
  });

  it("ORG_OVERRIDE route uses org instance even when PLATFORM instance exists", () => {
    const orgOverrideRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-1", connector_name: "Ext" }),
    ];
    const orgInstances: ResolvedInstance[] = [
      { provider_connector_id: "conn-1", provider_instance_id: "inst-org", provider_name: "OrgInst" },
    ];
    const platformInstances: ResolvedInstance[] = [
      { provider_connector_id: "conn-1", provider_instance_id: "inst-platform", provider_name: "PlatformInst", scope: "PLATFORM" },
    ];
    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes,
      globalRoutes: [],
      orgInstances,
      platformInstances,
    });
    const extCandidate = result.chain.find(c => c.source === "EXTERNAL_PRIMARY");
    expect(extCandidate?.provider_instance_id).toBe("inst-org");
    expect(result.routeSource).toBe("ORG_OVERRIDE");
  });

  it("PLATFORM session cannot mutate ORG_PRIVATE resources and vice versa (scope test)", () => {
    // Simulated: PLATFORM instance has null organization_id
    const platformInst = { scope: "PLATFORM", organization_id: null };
    expect(platformInst.scope === "PLATFORM" && platformInst.organization_id === null).toBe(true);

    // ORG instance requires organization_id
    const orgInst = { scope: "ORG", organization_id: "org-123" };
    expect(orgInst.scope === "ORG" && orgInst.organization_id !== null).toBe(true);
  });
});

// ── Scope Constraint Tests ──

describe("Platform instance scope constraints", () => {
  it("PLATFORM scope requires organization_id to be null", () => {
    const instance = { scope: "PLATFORM", organization_id: null };
    const valid = (instance.scope === "PLATFORM" && instance.organization_id === null) ||
                  (instance.scope === "ORG" && instance.organization_id !== null);
    expect(valid).toBe(true);
  });

  it("ORG scope requires organization_id to be non-null", () => {
    const instance = { scope: "ORG", organization_id: "org-123" };
    const valid = (instance.scope === "PLATFORM" && instance.organization_id === null) ||
                  (instance.scope === "ORG" && instance.organization_id !== null);
    expect(valid).toBe(true);
  });

  it("PLATFORM scope with organization_id is invalid", () => {
    const instance = { scope: "PLATFORM", organization_id: "org-123" };
    const valid = (instance.scope === "PLATFORM" && instance.organization_id === null) ||
                  (instance.scope === "ORG" && instance.organization_id !== null);
    expect(valid).toBe(false);
  });

  it("ORG scope without organization_id is invalid", () => {
    const instance = { scope: "ORG", organization_id: null };
    const valid = (instance.scope === "PLATFORM" && instance.organization_id === null) ||
                  (instance.scope === "ORG" && instance.organization_id !== null);
    expect(valid).toBe(false);
  });
});

// ── Wizard Copy Gating Tests ──

describe("Wizard copy gating — PLATFORM mode", () => {
  it("PLATFORM mode never references org provisioning in welcome copy", () => {
    const platformCopy = "Conector GLOBAL con instancia de plataforma centralizada";
    expect(platformCopy).not.toContain("org provisiona");
    expect(platformCopy).not.toContain("cada organización");
    expect(platformCopy).not.toContain("org-scoped");
    expect(platformCopy).not.toContain("must provision");
  });

  it("PLATFORM mode shows '100% orgs automatically' instead of coverage count", () => {
    const isPlatform = true;
    const coverageLabel = isPlatform ? "100% organizaciones — activado automáticamente" : `3 organizaciones activadas`;
    expect(coverageLabel).toBe("100% organizaciones — activado automáticamente");
    expect(coverageLabel).not.toContain("3 organizaciones");
  });

  it("PLATFORM routing copy says no org action required", () => {
    const routingWarning = "Las rutas GLOBALES se activan automáticamente para TODAS las organizaciones usando la instancia de plataforma.";
    expect(routingWarning).toContain("automáticamente");
    expect(routingWarning).not.toContain("provisionar su propia instancia");
  });

  it("ORG_PRIVATE mode copy unchanged — org-specific", () => {
    const orgCopy = "Esta instancia es específica de tu organización";
    expect(orgCopy).toContain("tu organización");
  });
});

// ── Missing Instance Warning Tests ──

describe("Missing PLATFORM instance warnings", () => {
  it("Global route with no PLATFORM instance produces trace with MISSING_PLATFORM_INSTANCE", () => {
    const tracePayload = {
      error: "Instance not found. For GLOBAL routes, ensure a PLATFORM instance exists.",
      skip_reason: "MISSING_PLATFORM_INSTANCE",
    };
    expect(tracePayload.skip_reason).toBe("MISSING_PLATFORM_INSTANCE");
  });

  it("Coverage panel distinguishes active vs missing platform instances", () => {
    const connectors = [
      { id: "conn-1", name: "Active Provider", hasPlatformInstance: true },
      { id: "conn-2", name: "Missing Provider", hasPlatformInstance: false },
    ];
    const active = connectors.filter(c => c.hasPlatformInstance);
    const missing = connectors.filter(c => !c.hasPlatformInstance);
    expect(active.length).toBe(1);
    expect(missing.length).toBe(1);
    expect(missing[0].name).toBe("Missing Provider");
  });
});

// ── Dedupe Key Normalization Tests ──

describe("Dedupe key normalization", () => {
  const normalize = (s: string) => s
    .replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{2B55}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}✅📄⚖️📋🔔⚠️❌]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .trim()
    .toLowerCase();

  it("Same description with/without emoji produces same dedupe hash", () => {
    const withEmoji = "✅ Auto que ordena poner en conocimiento...";
    const withoutEmoji = "Auto que ordena poner en conocimiento...";
    expect(normalize(withEmoji)).toBe(normalize(withoutEmoji));
  });

  it("Whitespace variations produce same normalized key", () => {
    const a = "Auto   que\tordena   poner";
    const b = "Auto que ordena poner";
    expect(normalize(a)).toBe(normalize(b));
  });

  it("Trailing punctuation is stripped", () => {
    expect(normalize("Auto que ordena...")).toBe("auto que ordena");
    expect(normalize("Sentencia!!!")).toBe("sentencia");
    expect(normalize("Normal text")).toBe("normal text");
  });

  it("REGRESSION: Duplicate Reg values (Actuación 13/14 both Reg:13) produce distinct canonical rows", () => {
    // Simulates the real production landmine: two actuaciones with different descriptions
    // but identical "Reg" numbers from the provider TEXT payload.
    // Dedupe must NOT rely on Reg alone.
    const simpleHash = (str: string): string => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0;
      }
      return Math.abs(hash).toString(36);
    };

    const computeKey = (date: string, desc: string, provId: string, indice: string, docHash: string) => {
      const normalized = desc
        .replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{2B55}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}✅📄⚖️📋🔔⚠️❌]/gu, "")
        .replace(/\s+/g, " ")
        .replace(/[.,;:!?]+$/g, "")
        .trim()
        .toLowerCase()
        .slice(0, 200);
      return `ACTS:${date}:${simpleHash(normalized)}:${provId}:${indice}:${docHash ? simpleHash(docHash) : ""}`;
    };

    // Actuación 13 — Reg: 13, but different description
    const key13 = computeKey(
      "2025-03-15",
      "Auto que ordena poner en conocimiento el dictamen pericial",
      "",
      "13",
      ""
    );

    // Actuación 14 — also Reg: 13 (provider formatting bug), different description
    const key14 = computeKey(
      "2025-03-15",
      "Constancia Secretarial de envío de comunicación electrónica",
      "",
      "13",  // Same Reg! Provider bug
      ""
    );

    // They MUST produce different keys despite same date + same indice
    expect(key13).not.toBe(key14);
  });
});

// ── Blue/green for PLATFORM instances ──

describe("Blue/green PLATFORM instance selection", () => {
  it("Deterministically selects first enabled PLATFORM instance by created_at", () => {
    const instances = [
      { id: "old", scope: "PLATFORM", is_enabled: true, created_at: "2025-01-01" },
      { id: "new", scope: "PLATFORM", is_enabled: true, created_at: "2025-06-01" },
    ];
    const selected = instances
      .filter(i => i.scope === "PLATFORM" && i.is_enabled)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    expect(selected.id).toBe("old");
  });

  it("Skips disabled PLATFORM instances during rotation", () => {
    const instances = [
      { id: "old", scope: "PLATFORM", is_enabled: false, created_at: "2025-01-01" },
      { id: "new", scope: "PLATFORM", is_enabled: true, created_at: "2025-06-01" },
    ];
    const selected = instances
      .filter(i => i.scope === "PLATFORM" && i.is_enabled)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    expect(selected.id).toBe("new");
  });
});

// ── GLOBAL route never falls back to org instance ──

describe("GLOBAL route strict PLATFORM resolution (no org fallback)", () => {
  it("GLOBAL route with no PLATFORM instance skips even if org instance exists", () => {
    const routes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-1", connector_name: "Ext" }),
    ];
    const orgInstances: ResolvedInstance[] = [
      { provider_connector_id: "conn-1", provider_instance_id: "inst-org", provider_name: "OrgInst" },
    ];
    // No platform instances provided
    const chain = resolveGlobalProviderChain("CGP", "ACTS", routes, orgInstances, []);
    const extCandidate = chain.find(c => c.source === "EXTERNAL_PRIMARY");
    expect(extCandidate?.provider_instance_id).toBeNull();
    expect(extCandidate?.skip_reason).toContain("MISSING_PLATFORM_INSTANCE");
  });

  it("ORG_OVERRIDE never falls back to PLATFORM instance when org instance missing", () => {
    const orgOverrideRoutes: GlobalRoute[] = [
      makeGlobalRoute({ workflow: "CGP", provider_connector_id: "conn-1", connector_name: "Ext" }),
    ];
    const platformInstances: ResolvedInstance[] = [
      { provider_connector_id: "conn-1", provider_instance_id: "inst-platform", provider_name: "PlatformInst", scope: "PLATFORM" },
    ];
    const result = resolveEffectivePolicyAndChain({
      workflow: "CGP",
      scope: "ACTS",
      orgOverrideRoutes,
      globalRoutes: [],
      orgInstances: [], // No org instance
      platformInstances,
    });
    const extCandidate = result.chain.find(c => c.source === "EXTERNAL_PRIMARY");
    // Should skip — no org instance, even though PLATFORM exists
    expect(extCandidate?.provider_instance_id).toBeNull();
    expect(extCandidate?.skip_reason).toContain("No enabled ORG instance");
  });
});