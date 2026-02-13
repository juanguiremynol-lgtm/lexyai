/**
 * Billing E2E Harness Tests
 * 
 * Comprehensive tests verifying:
 * - computeBillingState is the single source of truth
 * - billingClock override is honored
 * - Boundary conditions: D-6, D-5, D-1, D0, D+1, D+2, D+3
 * - Role gating logic
 * - Status transitions
 * - Ticker message generation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeBillingState,
  computeStatusTransition,
  buildTickerMessages,
  PRE_DUE_NOTICE_DAYS,
  GRACE_PERIOD_DAYS,
  type BillingStateInput,
} from "../billing-state-machine";
import { billingClock } from "../billing-clock";

// ── Helpers ──

function makeInput(overrides: Partial<BillingStateInput> = {}): BillingStateInput {
  return {
    currentPeriodEnd: null,
    trialEndAt: null,
    compedUntilAt: null,
    status: "ACTIVE",
    suspendedAt: null,
    ...overrides,
  };
}

function dueAt(days: number, from: Date): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const BASE = new Date("2026-06-15T12:00:00Z");

// ── Section A: Verify billingClock override is honored ──

describe("billingClock", () => {
  afterEach(() => billingClock.reset());

  it("returns real time when not overridden", () => {
    const before = Date.now();
    const clockNow = billingClock.now().getTime();
    const after = Date.now();
    expect(clockNow).toBeGreaterThanOrEqual(before);
    expect(clockNow).toBeLessThanOrEqual(after + 10);
  });

  it("returns overridden time when set", () => {
    const override = new Date("2030-01-01T00:00:00Z");
    billingClock.setOverride(override);
    expect(billingClock.now().getTime()).toBe(override.getTime());
    expect(billingClock.isOverridden()).toBe(true);
  });

  it("resets to real time", () => {
    billingClock.setOverride(new Date("2030-01-01T00:00:00Z"));
    billingClock.reset();
    expect(billingClock.isOverridden()).toBe(false);
    const diff = Math.abs(billingClock.now().getTime() - Date.now());
    expect(diff).toBeLessThan(100);
  });

  it("returns independent copies (no shared mutation)", () => {
    billingClock.setOverride(new Date("2030-01-01T00:00:00Z"));
    const a = billingClock.now();
    const b = billingClock.now();
    expect(a).not.toBe(b); // Different object references
    expect(a.getTime()).toBe(b.getTime());
  });
});

// ── Section B: Full boundary coverage D-6 through D+3 ──

describe("computeBillingState boundary coverage", () => {
  it("D-6: no ticker, active", () => {
    const s = computeBillingState(makeInput({ currentPeriodEnd: dueAt(6, BASE) }), BASE);
    expect(s.urgency).toBe("none");
    expect(s.status).toBe("ACTIVE");
    expect(s.showTopTicker).toBe(false);
    expect(s.showBottomTicker).toBe(false);
    expect(s.showPaywall).toBe(false);
  });

  it("D-5: pre_due, single top ticker", () => {
    const s = computeBillingState(makeInput({ currentPeriodEnd: dueAt(5, BASE) }), BASE);
    expect(s.urgency).toBe("pre_due");
    expect(s.showTopTicker).toBe(true);
    expect(s.showBottomTicker).toBe(false);
    expect(s.showPaywall).toBe(false);
  });

  it("D-4: pre_due", () => {
    const s = computeBillingState(makeInput({ currentPeriodEnd: dueAt(4, BASE) }), BASE);
    expect(s.urgency).toBe("pre_due");
    expect(s.daysUntilDue).toBe(4);
  });

  it("D-1: pre_due", () => {
    const s = computeBillingState(makeInput({ currentPeriodEnd: dueAt(1, BASE) }), BASE);
    expect(s.urgency).toBe("pre_due");
    expect(s.daysUntilDue).toBe(1);
  });

  it("D0: due_today, double ticker", () => {
    const s = computeBillingState(makeInput({ currentPeriodEnd: BASE.toISOString() }), BASE);
    expect(s.urgency).toBe("due_today");
    expect(s.status).toBe("PAST_DUE");
    expect(s.showTopTicker).toBe(true);
    expect(s.showBottomTicker).toBe(true);
    expect(s.showPaywall).toBe(false);
  });

  it("D+1: grace period, double ticker", () => {
    const s = computeBillingState(makeInput({ currentPeriodEnd: dueAt(-1, BASE) }), BASE);
    expect(s.urgency).toBe("grace");
    expect(s.inGrace).toBe(true);
    expect(s.daysOverdue).toBe(1);
    expect(s.graceDaysRemaining).toBe(1);
    expect(s.showTopTicker).toBe(true);
    expect(s.showBottomTicker).toBe(true);
    expect(s.showPaywall).toBe(false);
  });

  it("D+2: grace boundary, double ticker, no paywall yet", () => {
    const s = computeBillingState(makeInput({ currentPeriodEnd: dueAt(-2, BASE) }), BASE);
    expect(s.urgency).toBe("grace");
    expect(s.inGrace).toBe(true);
    expect(s.graceDaysRemaining).toBe(0);
    expect(s.showPaywall).toBe(false);
  });

  it("D+3: suspended, paywall", () => {
    const s = computeBillingState(makeInput({ currentPeriodEnd: dueAt(-3, BASE) }), BASE);
    expect(s.urgency).toBe("suspended");
    expect(s.status).toBe("SUSPENDED");
    expect(s.showPaywall).toBe(true);
    expect(s.showTopTicker).toBe(true);
    expect(s.showBottomTicker).toBe(true);
  });

  it("D+10: still suspended", () => {
    const s = computeBillingState(makeInput({ currentPeriodEnd: dueAt(-10, BASE) }), BASE);
    expect(s.urgency).toBe("suspended");
    expect(s.showPaywall).toBe(true);
  });
});

// ── Section C: Status transitions (server-side cron logic) ──

describe("computeStatusTransition", () => {
  it("no transition for active with future due date", () => {
    expect(computeStatusTransition(makeInput({ currentPeriodEnd: dueAt(10, BASE), status: "ACTIVE" }), BASE)).toBeNull();
  });

  it("ACTIVE → PAST_DUE on D+1", () => {
    const t = computeStatusTransition(makeInput({ currentPeriodEnd: dueAt(-1, BASE), status: "ACTIVE" }), BASE);
    expect(t).not.toBeNull();
    expect(t!.newStatus).toBe("PAST_DUE");
    expect(t!.shouldSuspend).toBe(false);
    expect(t!.shouldNotify).toBe(true);
  });

  it("PAST_DUE → SUSPENDED on D+3", () => {
    const t = computeStatusTransition(makeInput({ currentPeriodEnd: dueAt(-3, BASE), status: "PAST_DUE" }), BASE);
    expect(t).not.toBeNull();
    expect(t!.newStatus).toBe("SUSPENDED");
    expect(t!.shouldSuspend).toBe(true);
  });

  it("no transition for already SUSPENDED", () => {
    const t = computeStatusTransition(makeInput({ currentPeriodEnd: dueAt(-5, BASE), status: "SUSPENDED" }), BASE);
    expect(t).toBeNull();
  });

  it("no transition for CANCELLED", () => {
    const t = computeStatusTransition(makeInput({ status: "CANCELLED" }), BASE);
    expect(t).toBeNull();
  });

  it("comped accounts skip transition", () => {
    const t = computeStatusTransition(makeInput({ 
      currentPeriodEnd: dueAt(-5, BASE), 
      status: "ACTIVE",
      compedUntilAt: dueAt(30, BASE) 
    }), BASE);
    expect(t).toBeNull();
  });
});

// ── Section D: Reactivation scenario ──

describe("reactivation after payment", () => {
  it("extending period removes all tickers and paywall", () => {
    // Before: suspended
    const before = computeBillingState(makeInput({ currentPeriodEnd: dueAt(-5, BASE), status: "SUSPENDED" }), BASE);
    expect(before.showPaywall).toBe(true);

    // After: payment extends period 30 days, status reset to ACTIVE
    const after = computeBillingState(makeInput({ currentPeriodEnd: dueAt(30, BASE), status: "ACTIVE" }), BASE);
    expect(after.urgency).toBe("none");
    expect(after.showPaywall).toBe(false);
    expect(after.showTopTicker).toBe(false);
    expect(after.showBottomTicker).toBe(false);
    expect(after.status).toBe("ACTIVE");
  });
});

// ── Section E: Ticker messages ──

describe("buildTickerMessages completeness", () => {
  it("pre_due: admin gets day count, member gets 'administrador'", () => {
    const m = buildTickerMessages("pre_due", 3, 0);
    expect(m.admin).toContain("3 días");
    expect(m.admin).toContain("Paga ahora");
    expect(m.member).toContain("administrador");
  });

  it("due_today: mentions 2 days suspension", () => {
    const m = buildTickerMessages("due_today", 0, 0);
    expect(m.admin).toContain("hoy");
    expect(m.admin).toContain("2 días");
  });

  it("grace: shows remaining days", () => {
    const m = buildTickerMessages("grace", 0, 1);
    expect(m.admin).toContain("1 día");
    expect(m.admin).toContain("Paga ahora");
  });

  it("suspended: mentions reactivation", () => {
    const m = buildTickerMessages("suspended", 0, 0);
    expect(m.admin).toContain("suspendida");
    expect(m.admin).toContain("Paga ahora");
  });

  it("none: empty strings", () => {
    const m = buildTickerMessages("none", 0, 0);
    expect(m.admin).toBe("");
    expect(m.member).toBe("");
  });

  it("singular day (1 día) vs plural (3 días)", () => {
    const singular = buildTickerMessages("pre_due", 1, 0);
    expect(singular.admin).toContain("1 día");
    expect(singular.admin).not.toContain("1 días");

    const plural = buildTickerMessages("pre_due", 3, 0);
    expect(plural.admin).toContain("3 días");
  });
});

// ── Section F: Constants verification ──

describe("billing constants", () => {
  it("PRE_DUE_NOTICE_DAYS is 5", () => {
    expect(PRE_DUE_NOTICE_DAYS).toBe(5);
  });

  it("GRACE_PERIOD_DAYS is 2", () => {
    expect(GRACE_PERIOD_DAYS).toBe(2);
  });
});
