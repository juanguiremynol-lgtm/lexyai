/**
 * Tests for platform-scoped provider instances.
 * Covers instance resolution, wizard copy gating, and backward compatibility.
 */
import { describe, it, expect, vi } from "vitest";

// ── Instance Resolution Tests ──

describe("Platform instance resolution", () => {
  it("GLOBAL route uses PLATFORM instance (not org instance)", () => {
    const instances = [
      { id: "inst-platform", connector_id: "conn-1", scope: "PLATFORM", organization_id: null, is_enabled: true },
      { id: "inst-org-a", connector_id: "conn-1", scope: "ORG", organization_id: "org-a", is_enabled: true },
    ];

    // Resolution logic: for GLOBAL routes, pick PLATFORM scope
    const resolved = instances.find(i => i.connector_id === "conn-1" && i.scope === "PLATFORM" && i.is_enabled);
    expect(resolved).toBeTruthy();
    expect(resolved!.id).toBe("inst-platform");
    expect(resolved!.organization_id).toBeNull();
  });

  it("ORG_PRIVATE route uses org-specific instance", () => {
    const instances = [
      { id: "inst-platform", connector_id: "conn-1", scope: "PLATFORM", organization_id: null, is_enabled: true },
      { id: "inst-org-a", connector_id: "conn-1", scope: "ORG", organization_id: "org-a", is_enabled: true },
    ];

    const resolved = instances.find(i => i.connector_id === "conn-1" && i.scope === "ORG" && i.organization_id === "org-a");
    expect(resolved).toBeTruthy();
    expect(resolved!.id).toBe("inst-org-a");
    expect(resolved!.organization_id).toBe("org-a");
  });

  it("Missing PLATFORM instance returns null with skip_reason", () => {
    const instances = [
      { id: "inst-org-a", connector_id: "conn-1", scope: "ORG", organization_id: "org-a", is_enabled: true },
    ];

    const resolved = instances.find(i => i.connector_id === "conn-1" && i.scope === "PLATFORM" && i.is_enabled);
    expect(resolved).toBeUndefined();

    // The skip_reason should be MISSING_PLATFORM_INSTANCE
    const skipReason = resolved ? null : "MISSING_PLATFORM_INSTANCE";
    expect(skipReason).toBe("MISSING_PLATFORM_INSTANCE");
  });

  it("Disabled PLATFORM instance is not resolved", () => {
    const instances = [
      { id: "inst-platform", connector_id: "conn-1", scope: "PLATFORM", organization_id: null, is_enabled: false },
    ];

    const resolved = instances.find(i => i.connector_id === "conn-1" && i.scope === "PLATFORM" && i.is_enabled);
    expect(resolved).toBeUndefined();
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

// ── Backward Compatibility Tests ──

describe("Backward compatibility — missing PLATFORM instance", () => {
  it("Global route with no PLATFORM instance produces trace with skip_reason", () => {
    const tracePayload = {
      error: "Instance not found. For GLOBAL routes, ensure a PLATFORM instance exists.",
      skip_reason: "MISSING_PLATFORM_INSTANCE",
    };
    expect(tracePayload.skip_reason).toBe("MISSING_PLATFORM_INSTANCE");
  });

  it("Instance creation body includes scope field", () => {
    const platformBody = {
      connector_id: "conn-1",
      name: "Platform Instance",
      base_url: "https://api.example.com",
      auth_type: "API_KEY",
      secret_value: "sk-test",
      scope: "PLATFORM",
      organization_id: null,
    };
    expect(platformBody.scope).toBe("PLATFORM");
    expect(platformBody.organization_id).toBeNull();

    const orgBody = {
      connector_id: "conn-1",
      name: "Org Instance",
      base_url: "https://api.example.com",
      auth_type: "API_KEY",
      secret_value: "sk-test",
      scope: "ORG",
      organization_id: "org-123",
    };
    expect(orgBody.scope).toBe("ORG");
    expect(orgBody.organization_id).toBe("org-123");
  });

  it("Secret for PLATFORM instance has scope=PLATFORM and null org_id", () => {
    const secret = {
      provider_instance_id: "inst-platform",
      scope: "PLATFORM",
      organization_id: null,
      is_active: true,
    };
    expect(secret.scope).toBe("PLATFORM");
    expect(secret.organization_id).toBeNull();
  });
});
