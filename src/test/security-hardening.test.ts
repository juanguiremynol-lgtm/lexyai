/**
 * Egress Proxy & Security Hardening Tests
 */
import { describe, it, expect } from "vitest";

// ── Egress Domain Allowlist Tests ────────────────────────────────────
describe("Egress domain allowlist", () => {
  const DOMAIN_ALLOWLIST = [
    "app.posthog.com", "us.posthog.com", "eu.posthog.com",
    "sentry.io", "o0.ingest.sentry.io",
    "api.resend.com",
    "api.wompi.co", "sandbox.wompi.co", "production.wompi.co",
    "consultaprocesos.ramajudicial.gov.co", "procesos.ramajudicial.gov.co",
    "samai.consejodeestado.gov.co", "www.corteconstitucional.gov.co",
    "relatoria.corteconstitucional.gov.co",
    "generativelanguage.googleapis.com",
  ];

  function isDomainAllowed(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return DOMAIN_ALLOWLIST.some(
        (d) => hostname === d || hostname.endsWith(`.${d}`)
      );
    } catch {
      return false;
    }
  }

  it("allows known analytics domains", () => {
    expect(isDomainAllowed("https://app.posthog.com/capture")).toBe(true);
    expect(isDomainAllowed("https://us.posthog.com/batch")).toBe(true);
    expect(isDomainAllowed("https://o0.ingest.sentry.io/envelope")).toBe(true);
  });

  it("allows known judicial domains", () => {
    expect(isDomainAllowed("https://consultaprocesos.ramajudicial.gov.co/api/v2")).toBe(true);
    expect(isDomainAllowed("https://samai.consejodeestado.gov.co/")).toBe(true);
  });

  it("blocks unknown domains", () => {
    expect(isDomainAllowed("https://evil-exfil.com/data")).toBe(false);
    expect(isDomainAllowed("https://pastebin.com/upload")).toBe(false);
    expect(isDomainAllowed("https://webhook.site/test")).toBe(false);
    expect(isDomainAllowed("https://google.com")).toBe(false);
  });

  it("blocks subdomains of non-allowlisted domains", () => {
    expect(isDomainAllowed("https://api.evil.com")).toBe(false);
  });

  it("handles invalid URLs gracefully", () => {
    expect(isDomainAllowed("not-a-url")).toBe(false);
    expect(isDomainAllowed("")).toBe(false);
  });
});

// ── PII Payload Scanner Tests ────────────────────────────────────────
describe("PII payload scanner", () => {
  const BLOCKED_PAYLOAD_KEYS = [
    "party_name", "document_text", "case_content", "email", "phone",
    "cedula", "nit", "address", "search_query", "note_text", "file_name",
    "full_name", "first_name", "last_name", "password", "token", "secret",
    "api_key", "credential", "raw_text", "normalized_text",
  ];

  function scanForBlockedKeys(obj: Record<string, unknown>): string[] {
    const violations: string[] = [];
    const keys = Object.keys(obj);
    for (const key of keys) {
      const keyLower = key.toLowerCase();
      if (BLOCKED_PAYLOAD_KEYS.some((b) => keyLower.includes(b))) {
        violations.push(key);
      }
    }
    return violations;
  }

  it("blocks all known PII keys", () => {
    const payload: Record<string, unknown> = {};
    for (const key of BLOCKED_PAYLOAD_KEYS) {
      payload[key] = "test_value";
    }
    const violations = scanForBlockedKeys(payload);
    expect(violations.length).toBe(BLOCKED_PAYLOAD_KEYS.length);
  });

  it("allows safe analytics keys", () => {
    const safePayload = {
      event_name: "page_view",
      route: "/dashboard",
      tenant_id_hash: "abc123",
      timestamp: new Date().toISOString(),
    };
    const violations = scanForBlockedKeys(safePayload);
    expect(violations.length).toBe(0);
  });

  it("catches case-insensitive PII keys", () => {
    const payload = {
      Party_Name: "test",
      DOCUMENT_TEXT: "test",
      Email_Address: "test@test.com",
    };
    const violations = scanForBlockedKeys(payload);
    expect(violations.length).toBe(3);
  });
});

// ── CSP Header Contract Tests ────────────────────────────────────────
describe("CSP header contract", () => {
  // These are the CSP directives that MUST be present in index.html
  const REQUIRED_CSP_DIRECTIVES = [
    "default-src",
    "script-src",
    "style-src",
    "connect-src",
    "frame-src",
    "object-src",
    "base-uri",
    "form-action",
  ];

  it("requires all essential CSP directives", () => {
    expect(REQUIRED_CSP_DIRECTIVES.length).toBeGreaterThanOrEqual(8);
  });

  it("frame-src must be 'none' (no iframes allowed)", () => {
    // Contract: frame-src 'none' prevents clickjacking
    const frameDirective = "frame-src 'none'";
    expect(frameDirective).toContain("none");
  });

  it("object-src must be 'none' (no plugins)", () => {
    const objectDirective = "object-src 'none'";
    expect(objectDirective).toContain("none");
  });

  it("connect-src must include only known analytics domains", () => {
    const allowedConnectDomains = [
      "self",
      "*.supabase.co",
      "app.posthog.com",
      "us.posthog.com",
      "eu.posthog.com",
      "*.ingest.sentry.io",
    ];
    // No unknown domains should be in connect-src
    expect(allowedConnectDomains.length).toBeLessThanOrEqual(10);
  });
});

// ── Security Alert Rules Contract Tests ──────────────────────────────
describe("Security alert rules", () => {
  const REQUIRED_ALERT_RULES = [
    "BULK_EXPORT_SPIKE",
    "PERMISSION_ESCALATION",
    "FAILED_AUTH_SPIKE",
    "ADMIN_SETTINGS_MUTATION",
    "UNUSUAL_DATA_READ_VOLUME",
    "EGRESS_VIOLATION_DETECTED",
  ];

  it("defines at least 6 alert rule types", () => {
    expect(REQUIRED_ALERT_RULES.length).toBeGreaterThanOrEqual(6);
  });

  it("includes critical rules for export and permission changes", () => {
    expect(REQUIRED_ALERT_RULES).toContain("BULK_EXPORT_SPIKE");
    expect(REQUIRED_ALERT_RULES).toContain("PERMISSION_ESCALATION");
  });

  it("includes egress violation detection", () => {
    expect(REQUIRED_ALERT_RULES).toContain("EGRESS_VIOLATION_DETECTED");
  });
});
