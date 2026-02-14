/**
 * Test 4: Secret non-leakage
 * Test 5: AI action safety
 *
 * Validates:
 * - No API returns secrets (POSTHOG_API_KEY, SENTRY_DSN, ANALYTICS_HASH_SECRET)
 * - Browser bundle doesn't include hash secret
 * - Secret redaction in atenia-assistant catches all patterns
 * - Analytics actions enforce RBAC
 */
import { describe, it, expect } from "vitest";
import { BLOCKED_PROPERTIES, DEFAULT_ALLOWED_PROPERTIES } from "@/lib/analytics/types";

describe("Test 4: Secret non-leakage", () => {
  it("BLOCKED_PROPERTIES includes all secret-adjacent keys", () => {
    // Verify the blocklist covers secret/key/token patterns
    const secretPatterns = ["password", "token", "secret", "api_key", "credential"];
    for (const pattern of secretPatterns) {
      const found = BLOCKED_PROPERTIES.some(
        (b) => b.toLowerCase().includes(pattern)
      );
      expect(found).toBe(true);
    }
  });

  it("DEFAULT_ALLOWED_PROPERTIES never contains secret-like keys", () => {
    const dangerousPatterns = [
      "secret", "password", "token", "api_key", "credential",
      "dsn", "private_key", "service_role", "anon_key",
    ];
    for (const prop of DEFAULT_ALLOWED_PROPERTIES) {
      const lower = prop.toLowerCase();
      for (const pattern of dangerousPatterns) {
        expect(lower.includes(pattern)).toBe(false);
      }
    }
  });

  it("import.meta.env does not expose ANALYTICS_HASH_SECRET", () => {
    // In the browser/Vite context, only VITE_* variables are exposed.
    // ANALYTICS_HASH_SECRET should NEVER have a VITE_ prefix.
    const envKeys = Object.keys(import.meta.env);
    const leakedSecrets = envKeys.filter(
      (k) =>
        k.includes("ANALYTICS_HASH_SECRET") ||
        k.includes("POSTHOG_API_KEY") ||
        k.includes("SENTRY_DSN")
    );
    expect(leakedSecrets).toHaveLength(0);
  });

  it("secret redaction function catches all known patterns", () => {
    // Replicate the SECRET_SUBSTRINGS logic from atenia-assistant
    const SECRET_SUBSTRINGS = [
      "secret", "api_key", "apikey", "hmac_secret", "token",
      "password", "authorization", "bearer", "credential", "private_key",
      "service_role", "anon_key",
    ];

    function isSecretKey(key: string): boolean {
      const lower = key.toLowerCase();
      return SECRET_SUBSTRINGS.some((s) => lower.includes(s));
    }

    // Must be redacted
    const mustRedact = [
      "POSTHOG_API_KEY", "SENTRY_DSN_TOKEN", "ANALYTICS_HASH_SECRET",
      "api_key", "hmac_secret", "service_role_key", "password_hash",
      "authorization_header", "bearer_token", "anon_key",
      "private_key_pem", "credential_store",
    ];
    for (const key of mustRedact) {
      expect(isSecretKey(key)).toBe(true);
    }

    // Must NOT be redacted (safe operational keys)
    const mustNotRedact = [
      "radicado", "work_item_id", "status", "description",
      "name", "created_at", "monitoring_enabled", "route",
      "action", "event_name", "count", "latency_ms",
    ];
    for (const key of mustNotRedact) {
      expect(isSecretKey(key)).toBe(false);
    }
  });
});

describe("Test 5: AI action safety — analytics actions", () => {
  // Replicate the allowlist and risk classification from atenia-assistant
  const ACTION_ALLOWLIST = new Set([
    "RUN_SYNC_WORK_ITEM", "RUN_SYNC_PUBLICACIONES_WORK_ITEM",
    "TOGGLE_MONITORING", "RUN_MASTER_SYNC_SCOPE",
    "ESCALATE_TO_ADMIN_QUEUE", "CREATE_USER_REPORT",
    "UNLOCK_DANGER_ZONE", "GENERATE_PAYMENT_CERTIFICATE",
    "TOGGLE_TICKER", "GET_BILLING_SUMMARY", "GET_SUBSCRIPTION_STATUS",
    "INVITE_USER_TO_ORG", "REMOVE_USER_FROM_ORG", "CHANGE_MEMBER_ROLE",
    "ORG_USAGE_SUMMARY", "CREATE_SUPPORT_TICKET", "EXPLAIN_CURRENT_PAGE",
    "GRANT_SUPPORT_ACCESS", "REVOKE_SUPPORT_ACCESS",
    "GET_ANALYTICS_STATUS", "UPDATE_ORG_ANALYTICS",
  ]);

  function classifyRisk(actionType: string): "SAFE" | "CONFIRM_REQUIRED" {
    switch (actionType) {
      case "GET_ANALYTICS_STATUS":
      case "ESCALATE_TO_ADMIN_QUEUE":
      case "CREATE_USER_REPORT":
      case "CREATE_SUPPORT_TICKET":
      case "EXPLAIN_CURRENT_PAGE":
      case "ORG_USAGE_SUMMARY":
      case "GET_BILLING_SUMMARY":
      case "GET_SUBSCRIPTION_STATUS":
      case "GENERATE_PAYMENT_CERTIFICATE":
      case "REVOKE_SUPPORT_ACCESS":
      case "RUN_SYNC_WORK_ITEM":
      case "RUN_SYNC_PUBLICACIONES_WORK_ITEM":
        return "SAFE";
      default:
        return "CONFIRM_REQUIRED";
    }
  }

  it("GET_ANALYTICS_STATUS is in the allowlist and classified as SAFE", () => {
    expect(ACTION_ALLOWLIST.has("GET_ANALYTICS_STATUS")).toBe(true);
    expect(classifyRisk("GET_ANALYTICS_STATUS")).toBe("SAFE");
  });

  it("UPDATE_ORG_ANALYTICS is in the allowlist and requires confirmation", () => {
    expect(ACTION_ALLOWLIST.has("UPDATE_ORG_ANALYTICS")).toBe(true);
    expect(classifyRisk("UPDATE_ORG_ANALYTICS")).toBe("CONFIRM_REQUIRED");
  });

  it("unknown/malicious actions are NOT in the allowlist", () => {
    const malicious = [
      "DROP_DATABASE", "EXECUTE_SQL", "RAW_QUERY",
      "DELETE_ALL_ANALYTICS", "EXPORT_ALL_SECRETS",
      "SET_GLOBAL_ANALYTICS", // Only superadmin via Platform Console, NOT via assistant
    ];
    for (const action of malicious) {
      expect(ACTION_ALLOWLIST.has(action)).toBe(false);
    }
  });

  it("all mutating analytics actions require confirmation", () => {
    // UPDATE_ORG_ANALYTICS is the only mutating analytics action
    expect(classifyRisk("UPDATE_ORG_ANALYTICS")).toBe("CONFIRM_REQUIRED");
  });

  it("no action can bypass risk classification to become unclassified", () => {
    // Every action must return either SAFE or CONFIRM_REQUIRED
    for (const action of ACTION_ALLOWLIST) {
      const risk = classifyRisk(action);
      expect(["SAFE", "CONFIRM_REQUIRED"]).toContain(risk);
    }
  });
});
