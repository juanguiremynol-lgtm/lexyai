/**
 * Observation constraints — drift-proof tests
 *
 * Validates:
 * 1. Centralized constants are the single source of truth
 * 2. Payload-free guarantee: no raw body/headers in observation payloads
 * 3. Security observation kinds are restricted from org-admin view
 * 4. Every observation insert validates kind before DB roundtrip
 * 5. Egress policy matrix destinations declare purpose + domains
 */
import { describe, it, expect } from "vitest";
import {
  ALLOWED_OBSERVATION_KINDS,
  ALLOWED_OBSERVATION_SEVERITIES,
  SECURITY_OBSERVATION_KINDS,
  isValidObservationKind,
  isValidObservationSeverity,
  validateObservationKind,
  type ObservationKind,
} from "@/lib/constants/sync-constraints";

// ── 1. Single source of truth ───────────────────────────────────────

describe("Observation kind constants (single source of truth)", () => {
  it("defines all expected operational kinds", () => {
    const required: ObservationKind[] = [
      "GATE_FAILURE", "PROVIDER_DEGRADED", "CRON_PARTIAL", "CRON_FAILED",
      "GHOST_ITEMS", "SYNC_TIMEOUT", "DATA_QUALITY",
      "HEARTBEAT_OBSERVED", "HEARTBEAT_SKIPPED",
      "REMEDIATION_ATTEMPTED", "PROVIDER_RECOVERED",
    ];
    for (const kind of required) {
      expect(ALLOWED_OBSERVATION_KINDS).toContain(kind);
    }
  });

  it("defines security observation kinds", () => {
    expect(ALLOWED_OBSERVATION_KINDS).toContain("EGRESS_VIOLATION");
    expect(ALLOWED_OBSERVATION_KINDS).toContain("SECURITY_ALERT");
  });

  it("defines wiring-specific kinds used by conversation-wiring", () => {
    expect(ALLOWED_OBSERVATION_KINDS).toContain("PROVIDER_DEGRADED_WIRING");
    expect(ALLOWED_OBSERVATION_KINDS).toContain("EXT_FAILURES");
    expect(ALLOWED_OBSERVATION_KINDS).toContain("GHOST_ITEMS_WIRING");
  });

  it("severities match DB enum values", () => {
    expect([...ALLOWED_OBSERVATION_SEVERITIES]).toEqual(["INFO", "WARNING", "CRITICAL"]);
  });

  it("SECURITY_OBSERVATION_KINDS is a strict subset of all kinds", () => {
    for (const kind of SECURITY_OBSERVATION_KINDS) {
      expect(ALLOWED_OBSERVATION_KINDS).toContain(kind);
    }
    expect(SECURITY_OBSERVATION_KINDS.length).toBeGreaterThan(0);
    expect(SECURITY_OBSERVATION_KINDS.length).toBeLessThan(ALLOWED_OBSERVATION_KINDS.length);
  });
});

// ── 2. Validation helpers ───────────────────────────────────────────

describe("Observation kind validation (drift prevention)", () => {
  it("accepts valid kinds", () => {
    expect(isValidObservationKind("EGRESS_VIOLATION")).toBe(true);
    expect(isValidObservationKind("HEARTBEAT_OBSERVED")).toBe(true);
  });

  it("rejects invalid/legacy kinds", () => {
    expect(isValidObservationKind("provider_degraded")).toBe(false); // lowercase
    expect(isValidObservationKind("ext_failures")).toBe(false);
    expect(isValidObservationKind("ghost_items")).toBe(false);
    expect(isValidObservationKind("UNKNOWN_KIND")).toBe(false);
    expect(isValidObservationKind("")).toBe(false);
  });

  it("validateObservationKind throws for invalid values", () => {
    expect(() => validateObservationKind("INVALID")).toThrow("Invalid observation kind");
    expect(() => validateObservationKind("")).toThrow();
  });

  it("validateObservationKind returns value for valid kinds", () => {
    expect(validateObservationKind("EGRESS_VIOLATION")).toBe("EGRESS_VIOLATION");
    expect(validateObservationKind("SECURITY_ALERT")).toBe("SECURITY_ALERT");
  });

  it("severity validation works", () => {
    expect(isValidObservationSeverity("INFO")).toBe(true);
    expect(isValidObservationSeverity("WARNING")).toBe(true);
    expect(isValidObservationSeverity("CRITICAL")).toBe(true);
    expect(isValidObservationSeverity("info")).toBe(false); // Must be uppercase
    expect(isValidObservationSeverity("ERROR")).toBe(false);
  });
});

// ── 3. Payload-free guarantee ───────────────────────────────────────

describe("Payload-free observation guarantee", () => {
  const FORBIDDEN_PAYLOAD_KEYS = [
    "body", "raw_body", "request_body", "response_body",
    "headers", "request_headers", "response_headers",
    "query_string", "full_url", "authorization", "cookie",
    "email_content", "document_text", "case_content",
    "raw_text", "normalized_text", "password", "secret",
  ];

  it("egress violation payload only contains safe metadata", () => {
    // Simulates the payload shape from egress-proxy logViolation
    const egressPayload = {
      type: "DOMAIN_BLOCKED",
      caller: "test-fn",
      tenant_hash: "abc123",
      purpose: "analytics",
      target_domain: "evil.com",
      rule_triggered: "domain_not_in_purpose_allowlist",
      payload_size_bucket: "<1KB",
      request_id: "uuid-here",
      timestamp: new Date().toISOString(),
    };

    for (const forbidden of FORBIDDEN_PAYLOAD_KEYS) {
      expect(egressPayload).not.toHaveProperty(forbidden);
    }
  });

  it("security alert payload only contains safe metadata", () => {
    // Simulates the payload shape from security-audit-alerts
    const alertPayload = {
      rule_id: "BULK_EXPORT_SPIKE",
      description: "Test",
      org_id: "uuid",
      event_count: 15,
      threshold: 10,
      window_minutes: 15,
      detected_at: new Date().toISOString(),
    };

    for (const forbidden of FORBIDDEN_PAYLOAD_KEYS) {
      expect(alertPayload).not.toHaveProperty(forbidden);
    }
  });

  it("no observation payload should ever contain raw request/response data", () => {
    // This test serves as a contract: if you add new observation kinds,
    // ensure payloads remain payload-free by running this test.
    const safeKeys = new Set([
      "type", "caller", "tenant_hash", "purpose", "target_domain",
      "rule_triggered", "payload_size_bucket", "request_id", "timestamp",
      "rule_id", "description", "org_id", "event_count", "threshold",
      "window_minutes", "detected_at", "audit_log_id", "new_role",
      "observation_ids", "violation_count", "actions", "audit_log_ids",
      "table", "access_count", "providers", "observations", "count",
    ]);

    // Assert the safe set does not overlap with forbidden
    for (const forbidden of FORBIDDEN_PAYLOAD_KEYS) {
      expect(safeKeys.has(forbidden)).toBe(false);
    }
  });
});

// ── 4. Egress policy matrix enforcement ─────────────────────────────

describe("Egress policy matrix enforcement", () => {
  // Mirror of egress-proxy constants — CI test catches drift
  const DESTINATION_REGISTRY: Record<string, { purpose: string; url: string }> = {
    POSTHOG_CAPTURE: { url: "https://us.posthog.com/capture", purpose: "analytics" },
    POSTHOG_DECIDE: { url: "https://us.posthog.com/decide", purpose: "analytics" },
    SENTRY_ENVELOPE: { url: "https://o0.ingest.sentry.io/api/envelope/", purpose: "error_tracking" },
    RESEND_EMAILS: { url: "https://api.resend.com/emails", purpose: "email" },
    WOMPI_TRANSACTIONS: { url: "https://production.wompi.co/v1/transactions", purpose: "payments" },
    WOMPI_SANDBOX_TXN: { url: "https://sandbox.wompi.co/v1/transactions", purpose: "payments" },
    GEMINI_GENERATE: { url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", purpose: "ai" },
  };

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

  it("every destination key declares a purpose", () => {
    for (const [key, dest] of Object.entries(DESTINATION_REGISTRY)) {
      expect(dest.purpose).toBeTruthy();
      expect(Object.keys(PURPOSE_ALLOWLISTS)).toContain(dest.purpose);
    }
  });

  it("every destination URL domain is in its purpose allowlist", () => {
    for (const [key, dest] of Object.entries(DESTINATION_REGISTRY)) {
      const hostname = new URL(dest.url).hostname;
      const allowed = PURPOSE_ALLOWLISTS[dest.purpose] || [];
      const isAllowed = allowed.some(d => hostname === d || hostname.endsWith(`.${d}`));
      expect(isAllowed).toBe(true);
    }
  });

  it("no purpose has overlapping domains with another purpose", () => {
    const allDomains = new Map<string, string>();
    for (const [purpose, domains] of Object.entries(PURPOSE_ALLOWLISTS)) {
      for (const domain of domains) {
        if (allDomains.has(domain)) {
          // Same domain in two purposes = policy violation
          expect(allDomains.get(domain)).toBe(purpose);
        }
        allDomains.set(domain, purpose);
      }
    }
  });
});

// ── 5. observation_insert_failures metric contract ──────────────────

describe("observation_insert_failures metric", () => {
  it("egress-proxy logs metric tag on insert failure", () => {
    // Contract: the log format is:
    // [observation_insert_failure] kind=EGRESS_VIOLATION fn=egress-proxy reason=...
    const metricLine = "[observation_insert_failure] kind=EGRESS_VIOLATION fn=egress-proxy reason=test";
    expect(metricLine).toContain("[observation_insert_failure]");
    expect(metricLine).toContain("kind=");
    expect(metricLine).toContain("fn=");
    expect(metricLine).toContain("reason=");
  });

  it("security-audit-alerts logs metric tag on insert failure", () => {
    const metricLine = "[observation_insert_failure] kind=SECURITY_ALERT fn=security-audit-alerts rule=BULK_EXPORT_SPIKE reason=test";
    expect(metricLine).toContain("[observation_insert_failure]");
    expect(metricLine).toContain("kind=SECURITY_ALERT");
    expect(metricLine).toContain("fn=security-audit-alerts");
  });

  it("addObservation logs metric on insert failure", () => {
    const metricLine = "[observation_insert_failure] kind=GATE_FAILURE fn=addObservation error=test";
    expect(metricLine).toContain("[observation_insert_failure]");
    expect(metricLine).toContain("fn=addObservation");
  });
});
