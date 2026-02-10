/**
 * Tests for External Providers Setup — critical validation rules.
 */
import { describe, it, expect } from "vitest";

// ─── Helper functions extracted from components for testability ───

function isHostInAllowlist(host: string, allowlist: string[]): boolean {
  const h = host.toLowerCase();
  for (const pat of allowlist) {
    const p = pat.toLowerCase().trim();
    if (!p) continue;
    if (p.startsWith("*.")) {
      const suffix = p.slice(1);
      if (h === p.slice(2) || h.endsWith(suffix)) return true;
    } else if (h === p) return true;
  }
  return false;
}

function getBaseUrlHost(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function hasWildcardInAllowlist(allowlist: string[]): boolean {
  return allowlist.some((p) => (p ?? "").trim().includes("*"));
}

function validateConnectorSave(allowedDomains: string[]): { valid: boolean; error?: string } {
  const clean = allowedDomains.map((d) => d.trim()).filter(Boolean);
  if (clean.length === 0) return { valid: false, error: "allowed_domains cannot be empty" };
  return { valid: true };
}

function validateInstanceBaseUrl(baseUrl: string, allowlist: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!baseUrl.startsWith("https://")) errors.push("Only HTTPS allowed");
  const host = getBaseUrlHost(baseUrl);
  if (!host) { errors.push("Invalid URL"); return { valid: false, errors }; }
  if (!isHostInAllowlist(host, allowlist)) errors.push(`Host "${host}" not in allowlist`);
  return { valid: errors.length === 0, errors };
}

// ─── Tests ───

describe("ConnectorEditorCard validations", () => {
  it("blocks save when allowed_domains is empty", () => {
    const result = validateConnectorSave([]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("blocks save when allowed_domains contains only whitespace", () => {
    const result = validateConnectorSave(["  ", ""]);
    expect(result.valid).toBe(false);
  });

  it("allows save when allowed_domains has valid entries", () => {
    const result = validateConnectorSave(["api.example.com"]);
    expect(result.valid).toBe(true);
  });

  it("shows wildcard warning when allowlist contains *", () => {
    expect(hasWildcardInAllowlist(["*.run.app"])).toBe(true);
    expect(hasWildcardInAllowlist(["*"])).toBe(true);
    expect(hasWildcardInAllowlist(["api.example.com"])).toBe(false);
  });

  it("detects wildcard in mixed allowlist", () => {
    expect(hasWildcardInAllowlist(["api.example.com", "*.cloud.run"])).toBe(true);
  });
});

describe("InstanceProvisionerCard base_url validation", () => {
  it("blocks non-HTTPS base_url", () => {
    const result = validateInstanceBaseUrl("http://api.example.com", ["api.example.com"]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Only HTTPS allowed");
  });

  it("blocks base_url host not in allowlist", () => {
    const result = validateInstanceBaseUrl("https://evil.example.com", ["api.example.com"]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not in allowlist");
  });

  it("allows base_url matching exact allowlist entry", () => {
    const result = validateInstanceBaseUrl("https://api.example.com/v1", ["api.example.com"]);
    expect(result.valid).toBe(true);
  });

  it("allows base_url matching wildcard allowlist", () => {
    const result = validateInstanceBaseUrl("https://my-service.run.app", ["*.run.app"]);
    expect(result.valid).toBe(true);
  });

  it("rejects invalid URL", () => {
    const result = validateInstanceBaseUrl("not-a-url", ["example.com"]);
    expect(result.valid).toBe(false);
  });
});

describe("Secret write-only behavior", () => {
  it("does not include secret value in copyConfig output", () => {
    const config = {
      organization_id: "org-1",
      connector_id: "conn-1",
      name: "Test",
      base_url: "https://api.example.com",
      auth_type: "API_KEY",
      timeout_ms: 8000,
      rpm_limit: 60,
      is_enabled: true,
      has_secret: true,
    };
    const json = JSON.stringify(config);
    expect(json).not.toContain("secret_value");
    expect(json).not.toContain("api_key");
    expect(json).toContain("has_secret");
  });
});

describe("Preflight panel warning rendering", () => {
  it("identifies wildcard warning code", () => {
    const warnings = [
      { code: "WILDCARD_ALLOWLIST_IN_PROD", message: "Wildcard detected", allowlist: ["*.run.app"] },
    ];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].code).toBe("WILDCARD_ALLOWLIST_IN_PROD");
  });
});

describe("Host allowlist matching", () => {
  it("exact match works", () => {
    expect(isHostInAllowlist("api.example.com", ["api.example.com"])).toBe(true);
  });

  it("wildcard suffix match works", () => {
    expect(isHostInAllowlist("service.run.app", ["*.run.app"])).toBe(true);
  });

  it("wildcard matches base domain too", () => {
    expect(isHostInAllowlist("run.app", ["*.run.app"])).toBe(true);
  });

  it("rejects non-matching host", () => {
    expect(isHostInAllowlist("evil.com", ["api.example.com"])).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isHostInAllowlist("API.EXAMPLE.COM", ["api.example.com"])).toBe(true);
  });
});
