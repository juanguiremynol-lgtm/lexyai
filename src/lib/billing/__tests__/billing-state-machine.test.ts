/**
 * Unit tests for computeBillingState — Updated for trial-based billing model
 *
 * Tests boundary cases: Trial period, D-6, D-5, D-1, D0, D+1, D+2, D+3
 */

import { describe, it, expect } from "vitest";
import {
  computeBillingState,
  computeStatusTransition,
  buildTickerMessages,
  type BillingStateInput,
} from "../billing-state-machine";

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

/** Create a date N days from `now` */
function daysFromNow(days: number, now: Date = new Date("2026-03-15T12:00:00Z")): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const NOW = new Date("2026-03-15T12:00:00Z");

// ============================================================================
// TRIAL TESTS
// ============================================================================

describe("computeBillingState — TRIAL", () => {
  it("returns TRIAL with no tickers when trial has 30+ days remaining", () => {
    const result = computeBillingState(
      makeInput({ trialEndAt: daysFromNow(60, NOW), status: "TRIAL" }),
      NOW
    );
    expect(result.status).toBe("TRIAL");
    expect(result.isInTrial).toBe(true);
    expect(result.urgency).toBe("none");
    expect(result.showTopTicker).toBe(false);
    expect(result.showBottomTicker).toBe(false);
    expect(result.showPaywall).toBe(false);
    expect(result.trialDaysRemaining).toBe(60);
  });

  it("returns TRIAL with no tickers at D-6 before trial end", () => {
    const result = computeBillingState(
      makeInput({ trialEndAt: daysFromNow(6, NOW), status: "TRIAL" }),
      NOW
    );
    expect(result.status).toBe("TRIAL");
    expect(result.isInTrial).toBe(true);
    expect(result.urgency).toBe("none");
    expect(result.showTopTicker).toBe(false);
  });

  it("returns TRIAL with trial_ending at D-5 before trial end", () => {
    const result = computeBillingState(
      makeInput({ trialEndAt: daysFromNow(5, NOW), status: "TRIAL" }),
      NOW
    );
    expect(result.status).toBe("TRIAL");
    expect(result.isInTrial).toBe(true);
    expect(result.urgency).toBe("trial_ending");
    expect(result.showTopTicker).toBe(true);
    expect(result.showBottomTicker).toBe(false);
    expect(result.showPaywall).toBe(false);
  });

  it("returns TRIAL with trial_ending at D-1 before trial end", () => {
    const result = computeBillingState(
      makeInput({ trialEndAt: daysFromNow(1, NOW), status: "TRIAL" }),
      NOW
    );
    expect(result.status).toBe("TRIAL");
    expect(result.isInTrial).toBe(true);
    expect(result.urgency).toBe("trial_ending");
    expect(result.trialDaysRemaining).toBe(1);
  });

  it("trial ended with no billing period → falls to billing logic (due today)", () => {
    // trialEndAt = NOW, no currentPeriodEnd
    const result = computeBillingState(
      makeInput({ trialEndAt: NOW.toISOString(), status: "TRIAL" }),
      NOW
    );
    // Trial ended (trialDiffDays = 0, not > 0), so goes to billing logic
    // dueDateStr = trialEndAt, diffDays = 0 → due_today
    expect(result.isInTrial).toBe(false);
    expect(result.urgency).toBe("due_today");
    expect(result.status).toBe("PAST_DUE");
  });

  it("trial ended + 3 days → SUSPENDED (no billing period set)", () => {
    const result = computeBillingState(
      makeInput({ trialEndAt: daysFromNow(-3, NOW), status: "TRIAL" }),
      NOW
    );
    expect(result.isInTrial).toBe(false);
    expect(result.status).toBe("SUSPENDED");
    expect(result.showPaywall).toBe(true);
  });
});

// ============================================================================
// BILLING TESTS (post-trial)
// ============================================================================

describe("computeBillingState — Billing", () => {
  it("returns 'none' urgency when due date > 5 days away (D-6)", () => {
    const result = computeBillingState(
      makeInput({ currentPeriodEnd: daysFromNow(6, NOW) }),
      NOW
    );
    expect(result.urgency).toBe("none");
    expect(result.status).toBe("ACTIVE");
    expect(result.showTopTicker).toBe(false);
    expect(result.showBottomTicker).toBe(false);
    expect(result.showPaywall).toBe(false);
  });

  it("returns 'pre_due' at D-5", () => {
    const result = computeBillingState(
      makeInput({ currentPeriodEnd: daysFromNow(5, NOW) }),
      NOW
    );
    expect(result.urgency).toBe("pre_due");
    expect(result.status).toBe("ACTIVE");
    expect(result.showTopTicker).toBe(true);
    expect(result.showBottomTicker).toBe(false);
  });

  it("returns 'pre_due' at D-1", () => {
    const result = computeBillingState(
      makeInput({ currentPeriodEnd: daysFromNow(1, NOW) }),
      NOW
    );
    expect(result.urgency).toBe("pre_due");
    expect(result.daysUntilDue).toBe(1);
  });

  it("returns 'due_today' at D0", () => {
    const result = computeBillingState(
      makeInput({ currentPeriodEnd: NOW.toISOString() }),
      NOW
    );
    expect(result.urgency).toBe("due_today");
    expect(result.status).toBe("PAST_DUE");
    expect(result.showTopTicker).toBe(true);
    expect(result.showBottomTicker).toBe(true);
  });

  it("returns 'grace' at D+1 (1 day overdue)", () => {
    const result = computeBillingState(
      makeInput({ currentPeriodEnd: daysFromNow(-1, NOW) }),
      NOW
    );
    expect(result.urgency).toBe("grace");
    expect(result.inGrace).toBe(true);
    expect(result.daysOverdue).toBe(1);
    expect(result.graceDaysRemaining).toBe(1);
    expect(result.status).toBe("PAST_DUE");
    expect(result.showTopTicker).toBe(true);
    expect(result.showBottomTicker).toBe(true);
  });

  it("returns 'grace' at D+2 (2 days overdue)", () => {
    const result = computeBillingState(
      makeInput({ currentPeriodEnd: daysFromNow(-2, NOW) }),
      NOW
    );
    expect(result.urgency).toBe("grace");
    expect(result.inGrace).toBe(true);
    expect(result.daysOverdue).toBe(2);
    expect(result.graceDaysRemaining).toBe(0);
  });

  it("returns 'suspended' at D+3 (beyond grace)", () => {
    const result = computeBillingState(
      makeInput({ currentPeriodEnd: daysFromNow(-3, NOW) }),
      NOW
    );
    expect(result.urgency).toBe("suspended");
    expect(result.status).toBe("SUSPENDED");
    expect(result.inGrace).toBe(false);
    expect(result.showPaywall).toBe(true);
    expect(result.showTopTicker).toBe(true);
    expect(result.showBottomTicker).toBe(true);
  });

  it("treats comped accounts as active before expiry", () => {
    const result = computeBillingState(
      makeInput({ compedUntilAt: daysFromNow(30, NOW) }),
      NOW
    );
    expect(result.status).toBe("ACTIVE");
    expect(result.urgency).toBe("none");
  });

  it("handles already-suspended status", () => {
    const result = computeBillingState(
      makeInput({
        currentPeriodEnd: daysFromNow(-1, NOW),
        status: "SUSPENDED",
      }),
      NOW
    );
    expect(result.urgency).toBe("suspended");
    expect(result.status).toBe("SUSPENDED");
    expect(result.showPaywall).toBe(true);
  });

  it("handles cancelled status", () => {
    const result = computeBillingState(
      makeInput({ status: "CANCELLED" }),
      NOW
    );
    expect(result.status).toBe("CANCELLED");
    expect(result.showPaywall).toBe(true);
  });

  it("returns active when no due date is set", () => {
    const result = computeBillingState(makeInput(), NOW);
    expect(result.status).toBe("ACTIVE");
    expect(result.urgency).toBe("none");
  });
});

// ============================================================================
// STATUS TRANSITIONS
// ============================================================================

describe("computeStatusTransition", () => {
  it("returns null when no transition needed", () => {
    const result = computeStatusTransition(
      makeInput({ currentPeriodEnd: daysFromNow(10, NOW), status: "ACTIVE" }),
      NOW
    );
    expect(result).toBeNull();
  });

  it("transitions ACTIVE → PAST_DUE when grace starts", () => {
    const result = computeStatusTransition(
      makeInput({ currentPeriodEnd: daysFromNow(-1, NOW), status: "ACTIVE" }),
      NOW
    );
    expect(result).not.toBeNull();
    expect(result!.newStatus).toBe("PAST_DUE");
    expect(result!.shouldSuspend).toBe(false);
    expect(result!.shouldNotify).toBe(true);
  });

  it("transitions PAST_DUE → SUSPENDED when grace ends", () => {
    const result = computeStatusTransition(
      makeInput({ currentPeriodEnd: daysFromNow(-3, NOW), status: "PAST_DUE" }),
      NOW
    );
    expect(result).not.toBeNull();
    expect(result!.newStatus).toBe("SUSPENDED");
    expect(result!.shouldSuspend).toBe(true);
  });

  it("transitions TRIAL → PAST_DUE when trial ends (no billing period)", () => {
    const result = computeStatusTransition(
      makeInput({ trialEndAt: daysFromNow(-1, NOW), status: "TRIAL" }),
      NOW
    );
    expect(result).not.toBeNull();
    expect(result!.newStatus).toBe("PAST_DUE");
  });

  it("transitions TRIAL → SUSPENDED when trial ended + grace expired", () => {
    const result = computeStatusTransition(
      makeInput({ trialEndAt: daysFromNow(-3, NOW), status: "TRIAL" }),
      NOW
    );
    expect(result).not.toBeNull();
    expect(result!.newStatus).toBe("SUSPENDED");
    expect(result!.shouldSuspend).toBe(true);
  });

  it("no transition when TRIAL is still active", () => {
    const result = computeStatusTransition(
      makeInput({ trialEndAt: daysFromNow(30, NOW), status: "TRIAL" }),
      NOW
    );
    expect(result).toBeNull();
  });
});

// ============================================================================
// TICKER MESSAGES
// ============================================================================

describe("buildTickerMessages", () => {
  it("builds trial_ending messages", () => {
    const msgs = buildTickerMessages("trial_ending", 3, 0);
    expect(msgs.admin).toContain("3 días");
    expect(msgs.admin).toContain("prueba gratuito");
    expect(msgs.member).toContain("administrador");
  });

  it("builds pre_due messages", () => {
    const msgs = buildTickerMessages("pre_due", 3, 0);
    expect(msgs.admin).toContain("3 días");
    expect(msgs.member).toContain("administrador");
  });

  it("builds due_today messages", () => {
    const msgs = buildTickerMessages("due_today", 0, 0);
    expect(msgs.admin).toContain("hoy");
  });

  it("builds grace messages", () => {
    const msgs = buildTickerMessages("grace", 0, 1);
    expect(msgs.admin).toContain("1 día");
  });

  it("builds suspended messages", () => {
    const msgs = buildTickerMessages("suspended", 0, 0);
    expect(msgs.admin).toContain("suspendida");
  });

  it("returns empty for none", () => {
    const msgs = buildTickerMessages("none", 0, 0);
    expect(msgs.admin).toBe("");
  });
});

// ============================================================================
// DISCOUNT HELPERS
// ============================================================================

describe("discount helpers", () => {
  it("getBetaDiscountPercent returns 50 for monthly", async () => {
    const { getBetaDiscountPercent } = await import("../pricing-windows");
    expect(getBetaDiscountPercent(1)).toBe(50);
  });

  it("getBetaDiscountPercent returns 60 for annual", async () => {
    const { getBetaDiscountPercent } = await import("../pricing-windows");
    expect(getBetaDiscountPercent(12)).toBe(60);
    expect(getBetaDiscountPercent(24)).toBe(60);
  });

  it("computeDiscountedPrice calculates correctly", async () => {
    const { computeDiscountedPrice } = await import("../pricing-windows");
    expect(computeDiscountedPrice(100000, 50)).toBe(50000);
    expect(computeDiscountedPrice(100000, 60)).toBe(40000);
  });

  it("isWithinGracePeriod always returns false (deprecated)", async () => {
    const { isWithinGracePeriod } = await import("../pricing-windows");
    expect(isWithinGracePeriod()).toBe(false);
    expect(isWithinGracePeriod(new Date("2026-03-15"))).toBe(false);
  });
});
