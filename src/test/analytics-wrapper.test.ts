/**
 * Analytics Acceptance Tests
 *
 * Test 1: Global OFF → true noop (no provider calls)
 * Test 2: Tenant override blocks emission
 * Test 3: PII/property redaction
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  configureAnalytics,
  track,
  pageView,
  identify,
  setTenant,
  registerProvider,
  getAnalyticsState,
  type AnalyticsProvider,
} from "@/lib/analytics/wrapper";
import { BLOCKED_PROPERTIES, DEFAULT_ALLOWED_PROPERTIES } from "@/lib/analytics/types";

// Helper: create a spy provider
function createSpyProvider(name = "test"): AnalyticsProvider & {
  trackCalls: Array<[string, Record<string, unknown>]>;
  pageViewCalls: Array<Record<string, unknown>[]>;
  identifyCalls: Array<[string, Record<string, unknown>]>;
  tenantCalls: string[];
} {
  const provider = {
    name,
    trackCalls: [] as Array<[string, Record<string, unknown>]>,
    pageViewCalls: [] as Array<Record<string, unknown>[]>,
    identifyCalls: [] as Array<[string, Record<string, unknown>]>,
    tenantCalls: [] as string[],
    track(event: string, props: Record<string, unknown>) {
      provider.trackCalls.push([event, props]);
    },
    pageView(props: Record<string, unknown>) {
      provider.pageViewCalls.push([props]);
    },
    identify(hash: string, traits: Record<string, unknown>) {
      provider.identifyCalls.push([hash, traits]);
    },
    setTenant(hash: string) {
      provider.tenantCalls.push(hash);
    },
  };
  return provider;
}

// We need to reset module state between tests.
// The wrapper uses module-level variables, so we re-import fresh each time
// by calling configureAnalytics to reset state.
function resetAnalytics() {
  // Reset to disabled, clear providers by reconfiguring
  configureAnalytics({
    globalEnabled: false,
    tenantEnabled: null,
    allowedProperties: [...DEFAULT_ALLOWED_PROPERTIES],
  });
}

describe("Test 1: Global OFF means true noop", () => {
  beforeEach(() => resetAnalytics());

  it("track() does not call any provider when global is OFF", () => {
    const spy = createSpyProvider("noop-test");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: false });

    track("auth_login_success", { action: "login" });
    track("matter_created", { action: "create" });
    pageView({ route: "/dashboard" });
    identify("user123", { action: "test" });

    expect(spy.trackCalls).toHaveLength(0);
    expect(spy.pageViewCalls).toHaveLength(0);
    expect(spy.identifyCalls).toHaveLength(0);
  });

  it("getAnalyticsState reports effectivelyEnabled=false when global OFF", () => {
    configureAnalytics({ globalEnabled: false });
    const state = getAnalyticsState();
    expect(state.effectivelyEnabled).toBe(false);
    expect(state.globalEnabled).toBe(false);
  });
});

describe("Test 2: Tenant override blocks emission", () => {
  beforeEach(() => resetAnalytics());

  it("global ON + tenant OFF → no provider calls", () => {
    const spy = createSpyProvider("tenant-block");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: false });

    track("matter_created", { action: "create" });
    pageView({ route: "/cases" });

    expect(spy.trackCalls).toHaveLength(0);
    expect(spy.pageViewCalls).toHaveLength(0);
  });

  it("global ON + tenant ON → provider receives calls", () => {
    const spy = createSpyProvider("tenant-allow");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("auth_login_success", { action: "login" });

    expect(spy.trackCalls.length).toBeGreaterThan(0);
  });

  it("global ON + tenant null (inherit) → provider receives calls", () => {
    const spy = createSpyProvider("tenant-inherit");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: null });

    track("auth_login_success", { action: "login" });

    expect(spy.trackCalls.length).toBeGreaterThan(0);
  });

  it("getAnalyticsState reflects tenant override", () => {
    configureAnalytics({ globalEnabled: true, tenantEnabled: false });
    const state = getAnalyticsState();
    expect(state.globalEnabled).toBe(true);
    expect(state.tenantEnabled).toBe(false);
    expect(state.effectivelyEnabled).toBe(false);
  });
});

describe("Test 3: PII/property redaction", () => {
  beforeEach(() => resetAnalytics());

  it("drops blocked PII properties before provider call", () => {
    const spy = createSpyProvider("pii-drop");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("matter_created", {
      action: "create",
      party_name: "Juan Pérez",
      document_text: "Confidential legal document...",
      email: "juan@example.com",
      phone: "+573001234567",
      cedula: "12345678",
      note_text: "Internal note content",
      file_name: "evidence.pdf",
      full_name: "Juan Pérez García",
      password: "supersecret123",
      token: "eyJhbGci...",
      secret: "sk_live_xxx",
      api_key: "phc_xxxx",
      credential: "basic_auth_value",
    });

    expect(spy.trackCalls).toHaveLength(1);
    const [, sentProps] = spy.trackCalls[0];

    // None of the PII keys should be present
    for (const blocked of BLOCKED_PROPERTIES) {
      expect(sentProps).not.toHaveProperty(blocked);
    }

    // The allowed property "action" should be present
    expect(sentProps).toHaveProperty("action", "create");
    // event_name is injected by wrapper
    expect(sentProps).toHaveProperty("event_name", "matter_created");
  });

  it("drops properties not in the allowlist", () => {
    const spy = createSpyProvider("allowlist-drop");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("test_event", {
      action: "allowed",           // in DEFAULT_ALLOWED_PROPERTIES
      route: "/dashboard",         // in DEFAULT_ALLOWED_PROPERTIES
      random_custom_field: "test", // NOT in allowlist
      internal_debug_data: 42,     // NOT in allowlist
    });

    expect(spy.trackCalls).toHaveLength(1);
    const [, sentProps] = spy.trackCalls[0];

    expect(sentProps).toHaveProperty("action", "allowed");
    expect(sentProps).toHaveProperty("route", "/dashboard");
    expect(sentProps).not.toHaveProperty("random_custom_field");
    expect(sentProps).not.toHaveProperty("internal_debug_data");
  });

  it("truncates string values longer than 200 characters", () => {
    const spy = createSpyProvider("truncate-test");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    const longValue = "x".repeat(250);
    track("test_event", { action: longValue });

    expect(spy.trackCalls).toHaveLength(1);
    const [, sentProps] = spy.trackCalls[0];
    const actionVal = sentProps.action as string;
    expect(actionVal.length).toBeLessThanOrEqual(201); // 200 + '…'
  });

  it("always includes timestamp in sanitized properties", () => {
    const spy = createSpyProvider("timestamp-test");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("test_event", { action: "test" });

    const [, sentProps] = spy.trackCalls[0];
    expect(sentProps).toHaveProperty("timestamp");
    expect(typeof sentProps.timestamp).toBe("string");
  });

  it("every BLOCKED_PROPERTIES entry is caught by sanitizer", () => {
    const spy = createSpyProvider("full-blocklist");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    // Build an object with every blocked key
    const piiPayload: Record<string, unknown> = {};
    for (const key of BLOCKED_PROPERTIES) {
      piiPayload[key] = `test_value_for_${key}`;
    }

    track("pii_test", piiPayload);

    const [, sentProps] = spy.trackCalls[0];
    for (const key of BLOCKED_PROPERTIES) {
      expect(sentProps).not.toHaveProperty(key);
    }
  });
});
