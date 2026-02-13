/**
 * Unit tests for computeBillingState
 *
 * Tests boundary cases: D-6, D-5, D-1, D0, D+1, D+2, D+3
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

describe("computeBillingState", () => {
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
    // Due date is exactly now
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
});

describe("buildTickerMessages", () => {
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
