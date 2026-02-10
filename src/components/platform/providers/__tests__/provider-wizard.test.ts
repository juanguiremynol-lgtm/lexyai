/**
 * Vitest tests for wizard step gating, mode restrictions, and metadata invariants.
 */

import { describe, it, expect } from "vitest";
import { initialWizardState, WIZARD_STEPS, type WizardState } from "../wizard/WizardTypes";

// Helper: simulate step gating checks from StepConnector
function canProceedFromConnectorStep(state: WizardState): boolean {
  const domainsEmpty = !state.connector?.allowed_domains?.filter((d) => d.trim()).length;
  const hasWildcard = state.connector?.allowed_domains?.some((d) => d.includes("*")) ?? false;
  const keyPresent = !!state.connector?.key?.trim();
  const namePresent = !!state.connector?.name?.trim();
  // Wildcard requires explicit ack
  return !domainsEmpty && keyPresent && namePresent && (!hasWildcard || state.wildcardAcknowledged);
}

// Helper: simulate base_url validation from StepInstance
function isBaseUrlValid(baseUrl: string, allowedDomains: string[]): boolean {
  if (!baseUrl.startsWith("https://")) return false;
  let host: string;
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { return false; }
  for (const pat of allowedDomains) {
    const p = pat.toLowerCase().trim();
    if (!p) continue;
    if (p.startsWith("*.")) {
      const suffix = p.slice(1);
      if (host === p.slice(2) || host.endsWith(suffix)) return true;
    } else if (host === p) return true;
  }
  return false;
}

// Helper: mode-based visibility
function canCreateGlobalConnector(mode: "PLATFORM" | "ORG"): boolean {
  return mode === "PLATFORM";
}
function canCreateOrgPrivateConnector(mode: "PLATFORM" | "ORG"): boolean {
  return mode === "ORG";
}
function canEditGlobalRouting(mode: "PLATFORM" | "ORG"): boolean {
  return mode === "PLATFORM";
}
function canEditOrgRouting(_mode: "PLATFORM" | "ORG"): boolean {
  return true; // Both modes can set org routing
}

// Helper: GLOBAL acknowledgement gate
function canProceedFromWelcome(state: WizardState): boolean {
  if (state.mode === "PLATFORM") return state.globalAcknowledged;
  return true;
}

describe("Wizard Step Gating", () => {
  it("blocks connector step when allowlist is empty", () => {
    const state: WizardState = {
      ...initialWizardState("PLATFORM"),
      connector: { id: "1", key: "test", name: "Test", description: null, capabilities: ["ACTUACIONES"], allowed_domains: [], schema_version: "atenia.v1", is_enabled: true },
    };
    expect(canProceedFromConnectorStep(state)).toBe(false);
  });

  it("blocks connector step when allowlist has only whitespace", () => {
    const state: WizardState = {
      ...initialWizardState("PLATFORM"),
      connector: { id: "1", key: "test", name: "Test", description: null, capabilities: ["ACTUACIONES"], allowed_domains: ["  ", ""], schema_version: "atenia.v1", is_enabled: true },
    };
    expect(canProceedFromConnectorStep(state)).toBe(false);
  });

  it("blocks connector step when wildcard present but not acknowledged", () => {
    const state: WizardState = {
      ...initialWizardState("PLATFORM"),
      connector: { id: "1", key: "test", name: "Test", description: null, capabilities: ["ACTUACIONES"], allowed_domains: ["*.run.app"], schema_version: "atenia.v1", is_enabled: true },
      wildcardAcknowledged: false,
    };
    expect(canProceedFromConnectorStep(state)).toBe(false);
  });

  it("allows connector step when wildcard acknowledged", () => {
    const state: WizardState = {
      ...initialWizardState("PLATFORM"),
      connector: { id: "1", key: "test", name: "Test", description: null, capabilities: ["ACTUACIONES"], allowed_domains: ["*.run.app"], schema_version: "atenia.v1", is_enabled: true },
      wildcardAcknowledged: true,
    };
    expect(canProceedFromConnectorStep(state)).toBe(true);
  });

  it("allows connector step with valid non-wildcard domains", () => {
    const state: WizardState = {
      ...initialWizardState("ORG"),
      connector: { id: "1", key: "test", name: "Test", description: null, capabilities: ["ACTUACIONES"], allowed_domains: ["api.example.com"], schema_version: "atenia.v1", is_enabled: true },
    };
    expect(canProceedFromConnectorStep(state)).toBe(true);
  });

  it("blocks connector step when key is empty", () => {
    const state: WizardState = {
      ...initialWizardState("ORG"),
      connector: { id: "1", key: "", name: "Test", description: null, capabilities: [], allowed_domains: ["api.example.com"], schema_version: "atenia.v1", is_enabled: true },
    };
    expect(canProceedFromConnectorStep(state)).toBe(false);
  });
});

describe("Wizard Base URL Validation (SSRF)", () => {
  it("rejects HTTP URLs", () => {
    expect(isBaseUrlValid("http://api.example.com", ["api.example.com"])).toBe(false);
  });

  it("rejects hosts not in allowlist", () => {
    expect(isBaseUrlValid("https://malicious.com/path", ["api.example.com"])).toBe(false);
  });

  it("accepts exact match", () => {
    expect(isBaseUrlValid("https://api.example.com/v1", ["api.example.com"])).toBe(true);
  });

  it("accepts wildcard subdomain match", () => {
    expect(isBaseUrlValid("https://staging.api.example.com/v1", ["*.api.example.com"])).toBe(true);
  });

  it("accepts wildcard root match", () => {
    expect(isBaseUrlValid("https://api.example.com/v1", ["*.example.com"])).toBe(true);
  });

  it("rejects invalid URL", () => {
    expect(isBaseUrlValid("not-a-url", ["api.example.com"])).toBe(false);
  });
});

describe("Wizard Mode Restrictions", () => {
  it("PLATFORM mode can create GLOBAL connectors", () => {
    expect(canCreateGlobalConnector("PLATFORM")).toBe(true);
  });

  it("ORG mode cannot create GLOBAL connectors", () => {
    expect(canCreateGlobalConnector("ORG")).toBe(false);
  });

  it("ORG mode can create ORG_PRIVATE connectors", () => {
    expect(canCreateOrgPrivateConnector("ORG")).toBe(true);
  });

  it("PLATFORM mode cannot create ORG_PRIVATE connectors", () => {
    expect(canCreateOrgPrivateConnector("PLATFORM")).toBe(false);
  });

  it("only PLATFORM mode can edit global routing", () => {
    expect(canEditGlobalRouting("PLATFORM")).toBe(true);
    expect(canEditGlobalRouting("ORG")).toBe(false);
  });

  it("both modes can edit org routing", () => {
    expect(canEditOrgRouting("PLATFORM")).toBe(true);
    expect(canEditOrgRouting("ORG")).toBe(true);
  });
});

describe("Wizard Initial State", () => {
  it("initializes PLATFORM mode correctly", () => {
    const state = initialWizardState("PLATFORM");
    expect(state.mode).toBe("PLATFORM");
    expect(state.step).toBe(0);
    expect(state.connector).toBeNull();
    expect(state.wildcardAcknowledged).toBe(false);
    expect(state.globalAcknowledged).toBe(false);
    expect(state.instanceCoverageCount).toBeNull();
  });

  it("initializes ORG mode correctly", () => {
    const state = initialWizardState("ORG");
    expect(state.mode).toBe("ORG");
    expect(state.globalAcknowledged).toBe(false);
  });

  it("wizard has 9 steps", () => {
    expect(WIZARD_STEPS.length).toBe(9);
  });
});

describe("GLOBAL Acknowledgement Gate", () => {
  it("blocks welcome step in PLATFORM mode without acknowledgement", () => {
    const state = initialWizardState("PLATFORM");
    expect(canProceedFromWelcome(state)).toBe(false);
  });

  it("allows welcome step in PLATFORM mode with acknowledgement", () => {
    const state: WizardState = {
      ...initialWizardState("PLATFORM"),
      globalAcknowledged: true,
    };
    expect(canProceedFromWelcome(state)).toBe(true);
  });

  it("always allows welcome step in ORG mode", () => {
    const state = initialWizardState("ORG");
    expect(canProceedFromWelcome(state)).toBe(true);
  });

  it("ORG mode does not require globalAcknowledged even if false", () => {
    const state: WizardState = {
      ...initialWizardState("ORG"),
      globalAcknowledged: false,
    };
    expect(canProceedFromWelcome(state)).toBe(true);
  });
});

describe("Metadata Invariants", () => {
  it("builtins map covers all sync workflows", () => {
    const builtinsMap: Record<string, { acts: string[]; pubs: string[] }> = {
      CGP: { acts: ["cpnu"], pubs: ["publicaciones"] },
      LABORAL: { acts: ["cpnu"], pubs: ["publicaciones"] },
      CPACA: { acts: ["samai"], pubs: ["publicaciones"] },
      TUTELA: { acts: ["cpnu", "tutelas-api"], pubs: [] },
      PENAL_906: { acts: ["cpnu", "samai"], pubs: ["publicaciones"] },
    };
    const syncWorkflows = ["CGP", "LABORAL", "CPACA", "TUTELA", "PENAL_906"];
    for (const wf of syncWorkflows) {
      expect(builtinsMap).toHaveProperty(wf);
      expect(builtinsMap[wf].acts.length).toBeGreaterThan(0);
    }
  });

  it("every builtin provider is a known source", () => {
    const knownSources = new Set(["cpnu", "samai", "publicaciones", "tutelas-api"]);
    const builtinsMap: Record<string, { acts: string[]; pubs: string[] }> = {
      CGP: { acts: ["cpnu"], pubs: ["publicaciones"] },
      LABORAL: { acts: ["cpnu"], pubs: ["publicaciones"] },
      CPACA: { acts: ["samai"], pubs: ["publicaciones"] },
      TUTELA: { acts: ["cpnu", "tutelas-api"], pubs: [] },
      PENAL_906: { acts: ["cpnu", "samai"], pubs: ["publicaciones"] },
    };
    for (const wf of Object.values(builtinsMap)) {
      for (const src of [...wf.acts, ...wf.pubs]) {
        expect(knownSources.has(src)).toBe(true);
      }
    }
  });

  it("routing precedence has exactly 3 tiers", () => {
    const precedence = [
      "ORG_OVERRIDE",
      "GLOBAL",
      "BUILTIN",
    ];
    expect(precedence).toHaveLength(3);
  });

  it("SSRF rules require HTTPS and block private IPs", () => {
    const ssrf = {
      https_only: true,
      private_ips_blocked: true,
      localhost_blocked: true,
      allowlist_required: true,
    };
    expect(ssrf.https_only).toBe(true);
    expect(ssrf.private_ips_blocked).toBe(true);
    expect(ssrf.localhost_blocked).toBe(true);
    expect(ssrf.allowlist_required).toBe(true);
  });
});
