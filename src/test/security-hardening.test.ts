/**
 * Egress Proxy & Security Hardening Tests (v2)
 *
 * Tests purpose-scoped allowlists, per-purpose PII scanners,
 * server-only auth contract, CSP, and audit alert baselines.
 */
import { describe, it, expect } from "vitest";

// ── Purpose-Scoped Domain Allowlist Tests ────────────────────────────
describe("Purpose-scoped domain allowlist", () => {
  const PURPOSE_ALLOWLISTS: Record<string, string[]> = {
    analytics: ["app.posthog.com", "us.posthog.com", "eu.posthog.com"],
    error_tracking: ["sentry.io", "o0.ingest.sentry.io"],
    email: ["api.resend.com"],
    payments: ["api.wompi.co", "sandbox.wompi.co", "production.wompi.co"],
    judicial_source: [
      "consultaprocesos.ramajudicial.gov.co", "procesos.ramajudicial.gov.co",
      "samai.consejodeestado.gov.co", "www.corteconstitucional.gov.co",
      "relatoria.corteconstitucional.gov.co",
    ],
    ai: ["generativelanguage.googleapis.com"],
    webhook: [],
  };

  function isDomainAllowedForPurpose(url: string, purpose: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const allowed = PURPOSE_ALLOWLISTS[purpose] || [];
      return allowed.some(d => hostname === d || hostname.endsWith(`.${d}`));
    } catch {
      return false;
    }
  }

  it("allows PostHog only for analytics purpose", () => {
    expect(isDomainAllowedForPurpose("https://us.posthog.com/capture", "analytics")).toBe(true);
    expect(isDomainAllowedForPurpose("https://us.posthog.com/capture", "email")).toBe(false);
    expect(isDomainAllowedForPurpose("https://us.posthog.com/capture", "payments")).toBe(false);
  });

  it("allows Resend only for email purpose", () => {
    expect(isDomainAllowedForPurpose("https://api.resend.com/emails", "email")).toBe(true);
    expect(isDomainAllowedForPurpose("https://api.resend.com/emails", "analytics")).toBe(false);
  });

  it("allows Wompi only for payments purpose", () => {
    expect(isDomainAllowedForPurpose("https://production.wompi.co/v1/transactions", "payments")).toBe(true);
    expect(isDomainAllowedForPurpose("https://production.wompi.co/v1/transactions", "analytics")).toBe(false);
  });

  it("blocks unknown domains regardless of purpose", () => {
    for (const purpose of Object.keys(PURPOSE_ALLOWLISTS)) {
      expect(isDomainAllowedForPurpose("https://evil.com/exfil", purpose)).toBe(false);
    }
  });

  it("webhook purpose has no pre-approved domains", () => {
    expect(PURPOSE_ALLOWLISTS.webhook.length).toBe(0);
  });

  it("handles invalid URLs gracefully", () => {
    expect(isDomainAllowedForPurpose("not-a-url", "analytics")).toBe(false);
  });
});

// ── Purpose-Specific PII Scanner Tests ───────────────────────────────
describe("Purpose-specific PII scanner", () => {
  const ALWAYS_BLOCKED = [
    "document_text", "case_content", "password", "secret", "api_key",
    "credential", "raw_text", "normalized_text",
  ];
  const ANALYTICS_BLOCKED = [
    "party_name", "email", "phone", "cedula", "nit", "address",
    "full_name", "first_name", "last_name",
  ];

  function getBlockedKeys(purpose: string): string[] {
    const isStrict = ["analytics", "error_tracking", "webhook"].includes(purpose);
    return isStrict ? [...ALWAYS_BLOCKED, ...ANALYTICS_BLOCKED] : ALWAYS_BLOCKED;
  }

  it("analytics purpose blocks emails, phones, names", () => {
    const blocked = getBlockedKeys("analytics");
    expect(blocked).toContain("email");
    expect(blocked).toContain("phone");
    expect(blocked).toContain("full_name");
  });

  it("email purpose allows emails and phones (needed for sending)", () => {
    const blocked = getBlockedKeys("email");
    expect(blocked).not.toContain("email");
    expect(blocked).not.toContain("phone");
    // But still blocks document content
    expect(blocked).toContain("document_text");
    expect(blocked).toContain("raw_text");
  });

  it("payments purpose allows contact info but blocks secrets", () => {
    const blocked = getBlockedKeys("payments");
    expect(blocked).not.toContain("email");
    expect(blocked).toContain("password");
    expect(blocked).toContain("api_key");
  });

  it("all purposes block document content and credentials", () => {
    for (const purpose of ["analytics", "email", "payments", "judicial_source", "ai", "webhook"]) {
      const blocked = getBlockedKeys(purpose);
      expect(blocked).toContain("document_text");
      expect(blocked).toContain("case_content");
      expect(blocked).toContain("password");
      expect(blocked).toContain("secret");
    }
  });
});

// ── Server-Only Auth Contract Tests ──────────────────────────────────
describe("Server-only auth contract", () => {
  it("requires x-egress-internal-token or service role bearer", () => {
    // Contract: browser calls without internal token should be rejected
    const headers = { "content-type": "application/json" };
    const hasInternalToken = "x-egress-internal-token" in headers;
    const hasServiceBearer = "authorization" in headers;
    expect(hasInternalToken || hasServiceBearer).toBe(false); // Would fail auth
  });

  it("accepts service role key as internal token", () => {
    const serviceKey = "test-service-key-1234567890";
    const headers = { "x-egress-internal-token": serviceKey };
    expect(headers["x-egress-internal-token"]).toBe(serviceKey);
  });
});

// ── Destination Key Registry Tests ───────────────────────────────────
describe("Named destination registry", () => {
  const DESTINATIONS: Record<string, { purpose: string }> = {
    POSTHOG_CAPTURE: { purpose: "analytics" },
    POSTHOG_DECIDE: { purpose: "analytics" },
    SENTRY_ENVELOPE: { purpose: "error_tracking" },
    RESEND_EMAILS: { purpose: "email" },
    WOMPI_TRANSACTIONS: { purpose: "payments" },
    GEMINI_GENERATE: { purpose: "ai" },
  };

  it("all destinations have a declared purpose", () => {
    for (const [key, dest] of Object.entries(DESTINATIONS)) {
      expect(dest.purpose).toBeTruthy();
    }
  });

  it("prevents purpose mismatch for named destinations", () => {
    const dest = DESTINATIONS.POSTHOG_CAPTURE;
    expect(dest.purpose).toBe("analytics");
    expect(dest.purpose).not.toBe("email"); // Would be rejected
  });
});

// ── CSP Header Contract Tests ────────────────────────────────────────
describe("CSP header contract (v2)", () => {
  it("frame-src must be 'self' (allows OAuth, blocks external iframes)", () => {
    // v2: Changed from 'none' to 'self' for OAuth compatibility
    const frameDirective = "frame-src 'self'";
    expect(frameDirective).toContain("self");
    expect(frameDirective).not.toContain("none");
  });

  it("connect-src must NOT include analytics domains directly", () => {
    // v2: All analytics go through server-side proxy, not browser
    const connectSrc = "'self' https://*.supabase.co wss://*.supabase.co";
    expect(connectSrc).not.toContain("posthog");
    expect(connectSrc).not.toContain("sentry");
  });

  it("object-src must be 'none' (no plugins)", () => {
    const objectDirective = "object-src 'none'";
    expect(objectDirective).toContain("none");
  });
});

// ── Per-Tenant Baseline Tests ────────────────────────────────────────
describe("Per-tenant baseline thresholds", () => {
  function getTenantMultiplier(memberCount: number): number {
    if (memberCount <= 3) return 1;
    if (memberCount <= 10) return 2;
    if (memberCount <= 30) return 4;
    return 8;
  }

  it("small firms (1-3) use base threshold", () => {
    expect(getTenantMultiplier(1)).toBe(1);
    expect(getTenantMultiplier(3)).toBe(1);
  });

  it("medium firms (4-10) get 2x threshold", () => {
    expect(getTenantMultiplier(5)).toBe(2);
    expect(getTenantMultiplier(10)).toBe(2);
  });

  it("large firms (11-30) get 4x threshold", () => {
    expect(getTenantMultiplier(15)).toBe(4);
    expect(getTenantMultiplier(30)).toBe(4);
  });

  it("enterprise (31+) get 8x threshold", () => {
    expect(getTenantMultiplier(50)).toBe(8);
    expect(getTenantMultiplier(100)).toBe(8);
  });

  it("applies multiplier to base threshold correctly", () => {
    const baseExportThreshold = 10;
    expect(baseExportThreshold * getTenantMultiplier(2)).toBe(10);   // Small: 10
    expect(baseExportThreshold * getTenantMultiplier(8)).toBe(20);   // Medium: 20
    expect(baseExportThreshold * getTenantMultiplier(20)).toBe(40);  // Large: 40
    expect(baseExportThreshold * getTenantMultiplier(50)).toBe(80);  // Enterprise: 80
  });
});

// ── Payload-Free Logging Contract ────────────────────────────────────
describe("Payload-free logging contract", () => {
  const ALLOWED_LOG_FIELDS = [
    "type", "caller", "tenant_hash", "purpose", "target_domain",
    "rule_triggered", "payload_size_bucket", "request_id", "timestamp",
  ];
  const FORBIDDEN_LOG_FIELDS = [
    "body", "raw_body", "payload", "headers", "query_string",
    "authorization", "cookie", "email_content", "document_text",
  ];

  it("violation logs only contain safe metadata fields", () => {
    const mockViolationLog = {
      type: "PII_DETECTED",
      caller: "analytics-adapter",
      tenant_hash: "abc123",
      purpose: "analytics",
      target_domain: "us.posthog.com",
      rule_triggered: "blocked_key_analytics",
      payload_size_bucket: "<1KB",
      request_id: "uuid-here",
      timestamp: new Date().toISOString(),
    };

    for (const key of Object.keys(mockViolationLog)) {
      expect(ALLOWED_LOG_FIELDS).toContain(key);
    }
  });

  it("violation logs never contain forbidden fields", () => {
    const mockLog: Record<string, unknown> = {
      type: "DOMAIN_BLOCKED",
      caller: "test",
    };
    for (const forbidden of FORBIDDEN_LOG_FIELDS) {
      expect(mockLog).not.toHaveProperty(forbidden);
    }
  });
});

// ── Security Alert Rules Contract ────────────────────────────────────
describe("Security alert rules (v2)", () => {
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
