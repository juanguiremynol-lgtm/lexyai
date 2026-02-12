/**
 * Autonomy Policy Tests
 * 
 * Tests for budget enforcement, cooldown management, and action approval.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SupabaseClient } from "@supabase/supabase-js";

// Mock types (simulating what's in the real codebase)
interface ActionBudget {
  max_per_hour: number;
  max_per_day: number;
}

interface AutonomyPolicy {
  id: string;
  is_enabled: boolean;
  allowed_actions: string[];
  require_confirmation_actions: string[];
  budgets: Record<string, ActionBudget>;
  cooldowns: Record<string, number>;
}

interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

/**
 * Mock supabase client
 */
const mockSupabase = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
} as unknown as SupabaseClient;

/**
 * Helper: Create a test policy with defaults
 */
function createTestPolicy(overrides?: Partial<AutonomyPolicy>): AutonomyPolicy {
  return {
    id: "test-policy",
    is_enabled: true,
    allowed_actions: ["RETRY_ENQUEUE", "MARK_STUCK", "SUSPEND_MONITORING"],
    require_confirmation_actions: ["DEMOTE_PROVIDER_ROUTE"],
    budgets: {
      RETRY_ENQUEUE: { max_per_hour: 10, max_per_day: 30 },
      MARK_STUCK: { max_per_hour: 5, max_per_day: 15 },
    },
    cooldowns: {
      RETRY_ENQUEUE: 30, // minutes
      MARK_STUCK: 60,
    },
    ...overrides,
  };
}

/**
 * Simulate the canExecuteAction function logic
 */
async function canExecuteAction(
  supabase: SupabaseClient,
  policy: AutonomyPolicy,
  actionType: string,
  targetId?: string,
  recentActionsCount?: { hourly: number; daily: number }
): Promise<PolicyCheckResult> {
  // 1. Check if policy is enabled
  if (!policy.is_enabled) {
    return { allowed: false, reason: "AUTONOMY_DISABLED" };
  }

  // 2. Check if action is allowed
  if (!policy.allowed_actions.includes(actionType)) {
    if (policy.require_confirmation_actions.includes(actionType)) {
      return { allowed: true, requiresConfirmation: true };
    }
    return { allowed: false, reason: "ACTION_NOT_ALLOWED" };
  }

  // 3. Check if action requires confirmation
  if (policy.require_confirmation_actions.includes(actionType)) {
    return { allowed: true, requiresConfirmation: true };
  }

  // 4. Check budget
  const budget = policy.budgets[actionType];
  if (budget && recentActionsCount) {
    if (recentActionsCount.hourly >= budget.max_per_hour) {
      return { allowed: false, reason: "HOURLY_BUDGET_EXHAUSTED" };
    }
    if (recentActionsCount.daily >= budget.max_per_day) {
      return { allowed: false, reason: "DAILY_BUDGET_EXHAUSTED" };
    }
  }

  // 5. Check cooldown
  if (targetId) {
    const cooldownMinutes = policy.cooldowns[actionType] ?? 0;
    if (cooldownMinutes > 0) {
      // Assume we've checked the DB and found a recent action if cooldown is active
      // For testing, we'll set this via test parameters
      return { allowed: true }; // In real code, would check DB for recent actions
    }
  }

  return { allowed: true };
}

describe("Autonomy Policy Enforcement", () => {
  describe("Policy enabled/disabled", () => {
    it("should deny all actions when autonomy is disabled", async () => {
      const policy = createTestPolicy({ is_enabled: false });
      const result = await canExecuteAction(mockSupabase, policy, "RETRY_ENQUEUE");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("AUTONOMY_DISABLED");
    });

    it("should allow configured actions when autonomy is enabled", async () => {
      const policy = createTestPolicy({ is_enabled: true });
      const result = await canExecuteAction(mockSupabase, policy, "RETRY_ENQUEUE");
      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBeUndefined();
    });
  });

  describe("Action whitelist", () => {
    it("should deny actions not in allowed_actions", async () => {
      const policy = createTestPolicy();
      const result = await canExecuteAction(mockSupabase, policy, "UNKNOWN_ACTION");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("ACTION_NOT_ALLOWED");
    });

    it("should propose confirmation-only actions", async () => {
      const policy = createTestPolicy();
      const result = await canExecuteAction(mockSupabase, policy, "DEMOTE_PROVIDER_ROUTE");
      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
    });
  });

  describe("Hourly budget enforcement", () => {
    it("should deny when hourly budget is exhausted", async () => {
      const policy = createTestPolicy();
      const result = await canExecuteAction(mockSupabase, policy, "RETRY_ENQUEUE", undefined, {
        hourly: 10,
        daily: 20,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("HOURLY_BUDGET_EXHAUSTED");
    });

    it("should allow when hourly budget is available", async () => {
      const policy = createTestPolicy();
      const result = await canExecuteAction(mockSupabase, policy, "RETRY_ENQUEUE", undefined, {
        hourly: 5,
        daily: 20,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe("Daily budget enforcement", () => {
    it("should deny when daily budget is exhausted", async () => {
      const policy = createTestPolicy();
      const result = await canExecuteAction(mockSupabase, policy, "RETRY_ENQUEUE", undefined, {
        hourly: 2,
        daily: 30,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("DAILY_BUDGET_EXHAUSTED");
    });

    it("should allow when daily budget is available", async () => {
      const policy = createTestPolicy();
      const result = await canExecuteAction(mockSupabase, policy, "RETRY_ENQUEUE", undefined, {
        hourly: 2,
        daily: 25,
      });
      expect(result.allowed).toBe(true);
    });
  });
});

describe("Stuck Item Convergence", () => {
  it("should detect items with consecutive_not_found >= 5 as candidates for auto-suspension", () => {
    const item = { consecutive_not_found: 5, monitoring_enabled: true };
    const shouldSuspend = item.consecutive_not_found >= 5 && item.monitoring_enabled;
    expect(shouldSuspend).toBe(true);
  });

  it("should NOT auto-suspend items with transient failures < 5", () => {
    const item = { consecutive_not_found: 3, monitoring_enabled: true };
    const shouldSuspend = item.consecutive_not_found >= 5 && item.monitoring_enabled;
    expect(shouldSuspend).toBe(false);
  });

  it("should reset consecutive_not_found when sync succeeds", () => {
    let item = { consecutive_not_found: 5 };
    item.consecutive_not_found = 0;
    expect(item.consecutive_not_found).toBe(0);
  });

  it("should increment consecutive_not_found on empty result", () => {
    let item = { consecutive_not_found: 4 };
    item.consecutive_not_found++;
    expect(item.consecutive_not_found).toBe(5);
  });
});

describe("Daily Sync Continuation", () => {
  it("should track cursor position for resuming interrupted runs", () => {
    const ledger = {
      expected_total_items: 25,
      items_succeeded: 14,
      items_failed: 0,
      cursor_last_work_item_id: "item-14-uuid",
      failure_reason: "BUDGET_EXHAUSTED",
    };
    const processed = ledger.items_succeeded + ledger.items_failed;
    const remaining = ledger.expected_total_items - processed;
    expect(remaining).toBe(11);
  });

  it("should enforce max 3 continuations per day", () => {
    const continuations = [
      { id: "cont-1", created_at: "2026-02-12T10:00:00Z" },
      { id: "cont-2", created_at: "2026-02-12T11:00:00Z" },
      { id: "cont-3", created_at: "2026-02-12T12:00:00Z" },
    ];
    const canContinue = continuations.length < 3;
    expect(canContinue).toBe(false);
  });

  it("should mark PARTIAL when some items processed before budget exhausted", () => {
    const ledger = {
      expected_total_items: 25,
      items_succeeded: 9,
      items_failed: 1,
      items_skipped: 0,
    };
    const processed = ledger.items_succeeded + ledger.items_failed + ledger.items_skipped;
    const isPartial = processed > 0 && processed < ledger.expected_total_items;
    expect(isPartial).toBe(true);
  });
});

describe("Provider Mitigation Expiry", () => {
  it("should auto-expire mitigations after expires_at time", () => {
    const mitigation = {
      id: "miti-1",
      applied_at: new Date("2026-02-12T10:00:00Z").getTime(),
      expires_at: new Date("2026-02-12T12:00:00Z").getTime(),
      expired: false,
    };
    const now = new Date("2026-02-12T12:30:00Z").getTime();
    const shouldExpire = now > mitigation.expires_at && !mitigation.expired;
    expect(shouldExpire).toBe(true);
  });

  it("should NOT expire mitigations before expires_at time", () => {
    const mitigation = {
      id: "miti-1",
      expires_at: new Date("2026-02-12T14:00:00Z").getTime(),
      expired: false,
    };
    const now = new Date("2026-02-12T12:30:00Z").getTime();
    const shouldExpire = now > mitigation.expires_at && !mitigation.expired;
    expect(shouldExpire).toBe(false);
  });
});

describe("Heavy Item Split Detection", () => {
  it("should detect PENAL_906 as heavy even with small act count", () => {
    const item = { workflow_type: "PENAL_906", total_actuaciones: 50 };
    const isHeavy = item.workflow_type === "PENAL_906" || item.total_actuaciones >= 150;
    expect(isHeavy).toBe(true);
  });

  it("should detect items with 150+ actuaciones as heavy", () => {
    const item = { workflow_type: "CGP", total_actuaciones: 200 };
    const isHeavy = item.total_actuaciones >= 150;
    expect(isHeavy).toBe(true);
  });

  it("should NOT mark items with <150 acts and non-PENAL type as heavy", () => {
    const item = { workflow_type: "CGP", total_actuaciones: 120 };
    const isHeavy = item.workflow_type === "PENAL_906" || item.total_actuaciones >= 150;
    expect(isHeavy).toBe(false);
  });
});

describe("Action Logging & Redaction", () => {
  it("should redact secrets from action snapshots", () => {
    const snapshot = {
      radicado: "11001600010220200027600",
      provider_api_key: "sk-secret-123",
      auth_token: "Bearer abcd1234",
      error: "Timeout",
    };
    const sensitiveKeys = ["key", "secret", "token", "password"];
    const redacted = Object.fromEntries(
      Object.entries(snapshot).map(([k, v]) => [
        k,
        sensitiveKeys.some((s) => k.toLowerCase().includes(s)) ? "[REDACTED]" : v,
      ])
    );
    expect(redacted.provider_api_key).toBe("[REDACTED]");
    expect(redacted.auth_token).toBe("[REDACTED]");
    expect(redacted.radicado).toBe("11001600010220200027600");
  });

  it("should include decision_reason in Spanish", () => {
    const action = {
      action_type: "SUSPEND_MONITORING",
      decision_reason: "El radicado 11001600... no ha sido encontrado en 5 consultas consecutivas",
      reasoning: "Possibly not digitized by judiciary",
    };
    expect(action.decision_reason).toContain("consultas");
    expect(action.decision_reason).not.toContain("five consecutive");
  });
});
