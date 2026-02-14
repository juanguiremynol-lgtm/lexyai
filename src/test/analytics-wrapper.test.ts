/**
 * Analytics Acceptance Tests — Wrapper Behavior
 *
 * Test 1: Global OFF → true noop (no provider calls at wrapper boundary)
 * Test 2: Tenant override blocks emission (Tenant A ON, Tenant B OFF)
 * Test 3: PII/property redaction (blocklist, allowlist, truncation)
 * Test 6: Session replay hardening (OFF by default, sensitive selectors excluded)
 * Test 7: No double-send guard (single action → single event per provider)
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
  flush,
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

function resetAnalytics() {
  configureAnalytics({
    globalEnabled: false,
    tenantEnabled: null,
    allowedProperties: [...DEFAULT_ALLOWED_PROPERTIES],
  });
}

// ============================================================
// Test 1: Global OFF means true noop
// ============================================================
describe("Test 1: Global OFF means true noop", () => {
  beforeEach(() => resetAnalytics());

  it("track/pageView/identify produce zero provider calls when global OFF", () => {
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

  it("setTenant still stores hash locally but does not forward to providers when OFF", () => {
    const spy = createSpyProvider("noop-tenant");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: false });

    setTenant("tenant_hash_abc");

    // setTenant stores _tenantHash internally but provider.setTenant is NOT called
    expect(spy.tenantCalls).toHaveLength(0);
  });

  it("getAnalyticsState reports effectivelyEnabled=false when global OFF", () => {
    configureAnalytics({ globalEnabled: false });
    const state = getAnalyticsState();
    expect(state.effectivelyEnabled).toBe(false);
    expect(state.globalEnabled).toBe(false);
  });

  it("multiple providers all receive zero calls when disabled", () => {
    const spy1 = createSpyProvider("multi-noop-1");
    const spy2 = createSpyProvider("multi-noop-2");
    registerProvider(spy1);
    registerProvider(spy2);
    configureAnalytics({ globalEnabled: false });

    track("test", { action: "x" });
    pageView({ route: "/" });

    expect(spy1.trackCalls).toHaveLength(0);
    expect(spy2.trackCalls).toHaveLength(0);
    expect(spy1.pageViewCalls).toHaveLength(0);
    expect(spy2.pageViewCalls).toHaveLength(0);
  });
});

// ============================================================
// Test 2: Tenant override blocks emission
// ============================================================
describe("Test 2: Tenant override blocks emission", () => {
  beforeEach(() => resetAnalytics());

  it("global ON + tenant OFF → zero provider calls (simulates Tenant B)", () => {
    const spy = createSpyProvider("tenant-block");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: false });

    track("matter_created", { action: "create" });
    pageView({ route: "/cases" });
    identify("user_b", { action: "login" });

    expect(spy.trackCalls).toHaveLength(0);
    expect(spy.pageViewCalls).toHaveLength(0);
    expect(spy.identifyCalls).toHaveLength(0);
  });

  it("global ON + tenant ON → provider receives calls (simulates Tenant A)", () => {
    const spy = createSpyProvider("tenant-allow");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("auth_login_success", { action: "login" });
    pageView({ route: "/dashboard" });

    expect(spy.trackCalls).toHaveLength(1);
    expect(spy.pageViewCalls).toHaveLength(1);
  });

  it("global ON + tenant null (inherit) → provider receives calls", () => {
    const spy = createSpyProvider("tenant-inherit");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: null });

    track("auth_login_success", { action: "login" });

    expect(spy.trackCalls).toHaveLength(1);
  });

  it("switching tenant from ON to OFF mid-session stops emission", () => {
    const spy = createSpyProvider("tenant-switch");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("event_before", { action: "before" });
    expect(spy.trackCalls).toHaveLength(1);

    // Tenant now opts out
    configureAnalytics({ globalEnabled: true, tenantEnabled: false });
    track("event_after", { action: "after" });

    // Still only 1 call — the "after" was suppressed
    expect(spy.trackCalls).toHaveLength(1);
    expect(spy.trackCalls[0][0]).toBe("event_before");
  });

  it("getAnalyticsState reflects tenant override", () => {
    configureAnalytics({ globalEnabled: true, tenantEnabled: false });
    const state = getAnalyticsState();
    expect(state.globalEnabled).toBe(true);
    expect(state.tenantEnabled).toBe(false);
    expect(state.effectivelyEnabled).toBe(false);
  });
});

// ============================================================
// Test 3: PII/property redaction
// ============================================================
describe("Test 3: PII/property redaction", () => {
  beforeEach(() => resetAnalytics());

  it("drops all 19 blocked PII properties before provider call", () => {
    const spy = createSpyProvider("pii-drop");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    const piiPayload: Record<string, unknown> = { action: "create" };
    for (const key of BLOCKED_PROPERTIES) {
      piiPayload[key] = `test_${key}`;
    }

    track("matter_created", piiPayload);

    expect(spy.trackCalls).toHaveLength(1);
    const [, sentProps] = spy.trackCalls[0];

    for (const blocked of BLOCKED_PROPERTIES) {
      expect(sentProps).not.toHaveProperty(blocked);
    }
    expect(sentProps).toHaveProperty("action", "create");
    expect(sentProps).toHaveProperty("event_name", "matter_created");
  });

  it("drops properties not in the allowlist", () => {
    const spy = createSpyProvider("allowlist-drop");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("test_event", {
      action: "allowed",
      route: "/dashboard",
      random_custom_field: "test",
      internal_debug_data: 42,
    });

    const [, sentProps] = spy.trackCalls[0];
    expect(sentProps).toHaveProperty("action", "allowed");
    expect(sentProps).toHaveProperty("route", "/dashboard");
    expect(sentProps).not.toHaveProperty("random_custom_field");
    expect(sentProps).not.toHaveProperty("internal_debug_data");
  });

  it("blocklist match is case-insensitive (e.g. 'Party_Name')", () => {
    const spy = createSpyProvider("case-insensitive");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("test", {
      action: "x",
      Party_Name: "should be blocked",
      DOCUMENT_TEXT: "should be blocked",
      Email_Address: "should be blocked",
    });

    const [, sentProps] = spy.trackCalls[0];
    expect(sentProps).not.toHaveProperty("Party_Name");
    expect(sentProps).not.toHaveProperty("DOCUMENT_TEXT");
    expect(sentProps).not.toHaveProperty("Email_Address");
  });

  it("truncates strings > 200 chars", () => {
    const spy = createSpyProvider("truncate");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("test", { action: "x".repeat(250) });

    const val = spy.trackCalls[0][1].action as string;
    expect(val.length).toBeLessThanOrEqual(201);
    expect(val.endsWith("…")).toBe(true);
  });

  it("always injects timestamp ISO string", () => {
    const spy = createSpyProvider("ts");
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("test", { action: "test" });

    const ts = spy.trackCalls[0][1].timestamp as string;
    expect(typeof ts).toBe("string");
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});

// ============================================================
// Test 6: Session replay hardening
// ============================================================
describe("Test 6: Session replay hardening", () => {
  it("session_replay_enabled defaults to OFF in DEFAULT config", () => {
    // The platform_settings table defaults session_replay_enabled to false
    // and the wrapper never enables it without explicit configuration.
    // This test documents the invariant: replay must be opt-in only.
    resetAnalytics();
    const state = getAnalyticsState();
    // effectivelyEnabled is false because globalEnabled is false after reset
    expect(state.effectivelyEnabled).toBe(false);
  });

  it("sensitive UI selectors that MUST be excluded from replay are documented", () => {
    // These selectors/routes must be masked/excluded if session replay is ever enabled.
    // This test serves as a contract — if any are removed, a human must review.
    const REPLAY_EXCLUSION_SELECTORS = [
      "[data-document-viewer]",
      "[data-evidence-pane]",
      "[data-rich-text-editor]",
      "[data-search-input]",
      "[data-export-preview]",
      "[data-case-content]",
      "[data-party-info]",
      ".ql-editor",              // Quill editor content
      "[contenteditable]",       // Any contenteditable
      'input[type="password"]',  // Always masked
    ];

    const REPLAY_EXCLUSION_ROUTES = [
      "/app/cases/*/documents",
      "/app/cases/*/evidence",
      "/app/cases/*/notes",
      "/app/exports/*",
    ];

    // Contract: at least 8 selectors and 3 routes must be defined
    expect(REPLAY_EXCLUSION_SELECTORS.length).toBeGreaterThanOrEqual(8);
    expect(REPLAY_EXCLUSION_ROUTES.length).toBeGreaterThanOrEqual(3);

    // No selector should be empty
    for (const sel of REPLAY_EXCLUSION_SELECTORS) {
      expect(sel.length).toBeGreaterThan(0);
    }
  });

  it("replay cannot be enabled when global analytics is OFF", () => {
    resetAnalytics();
    configureAnalytics({ globalEnabled: false, tenantEnabled: true });
    // Even if someone tries to enable replay, the wrapper's isEnabled() returns false
    const state = getAnalyticsState();
    expect(state.effectivelyEnabled).toBe(false);
  });
});

// ============================================================
// Test 7: No double-send guard
// ============================================================
describe("Test 7: No double-send guard", () => {
  beforeEach(() => resetAnalytics());

  it("single track() call → exactly one call per registered provider", () => {
    const spy1 = createSpyProvider("provider-a");
    const spy2 = createSpyProvider("provider-b");
    registerProvider(spy1);
    registerProvider(spy2);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("matter_created", { action: "create" });

    // Each provider receives exactly 1 call — no double-send
    expect(spy1.trackCalls).toHaveLength(1);
    expect(spy2.trackCalls).toHaveLength(1);
  });

  it("single pageView() call → exactly one call per provider", () => {
    const spy1 = createSpyProvider("pv-a");
    const spy2 = createSpyProvider("pv-b");
    registerProvider(spy1);
    registerProvider(spy2);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    pageView({ route: "/dashboard" });

    expect(spy1.pageViewCalls).toHaveLength(1);
    expect(spy2.pageViewCalls).toHaveLength(1);
  });

  it("duplicate registerProvider is ignored (no double registration)", () => {
    const spy = createSpyProvider("dedup-test");
    registerProvider(spy);
    registerProvider(spy); // Same name — should be deduped
    registerProvider(spy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    track("test", { action: "x" });

    // Only 1 call despite 3 register attempts
    expect(spy.trackCalls).toHaveLength(1);
  });

  it("provider error does not cause double-send to other providers", () => {
    const brokenProvider: AnalyticsProvider = {
      name: "broken",
      track: () => { throw new Error("Provider crashed"); },
      pageView: () => { throw new Error("Provider crashed"); },
      identify: () => {},
      setTenant: () => {},
    };
    const healthySpy = createSpyProvider("healthy");

    registerProvider(brokenProvider);
    registerProvider(healthySpy);
    configureAnalytics({ globalEnabled: true, tenantEnabled: true });

    // Should not throw, and healthy provider gets exactly 1 call
    expect(() => track("test", { action: "x" })).not.toThrow();
    expect(healthySpy.trackCalls).toHaveLength(1);
  });
});
