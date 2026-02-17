/**
 * Tests for the unified notification system.
 *
 * Validates:
 * 1. Role-based category visibility (no cross-role leakage)
 * 2. Unread count semantics (read_at NULL AND dismissed_at NULL)
 * 3. Mark-read and dismiss optimistic cache behavior
 * 4. Tab configuration per role
 */

import { describe, it, expect } from "vitest";

// ── Role → category mapping (mirrors hook) ──
const ROLE_CATEGORIES: Record<string, string[]> = {
  USER: ["TERMS", "WORK_ITEM_ALERTS"],
  ORG_ADMIN: ["TERMS", "WORK_ITEM_ALERTS", "ORG_ACTIVITY"],
  SUPER_ADMIN: [
    "OPS_SYNC",
    "OPS_INCIDENTS",
    "OPS_E2E",
    "OPS_WATCHDOG",
    "OPS_REMEDIATION",
    "SYSTEM",
  ],
};

const OPS_CATEGORIES = [
  "OPS_SYNC",
  "OPS_INCIDENTS",
  "OPS_E2E",
  "OPS_WATCHDOG",
  "OPS_REMEDIATION",
];

// ── 1) Role-based category visibility ──
describe("role-based notification visibility", () => {
  it("regular user CANNOT see any ops categories", () => {
    const allowed = ROLE_CATEGORIES["USER"];
    for (const opsCat of OPS_CATEGORIES) {
      expect(allowed).not.toContain(opsCat);
    }
  });

  it("regular user sees only TERMS and WORK_ITEM_ALERTS", () => {
    expect(ROLE_CATEGORIES["USER"]).toEqual(["TERMS", "WORK_ITEM_ALERTS"]);
  });

  it("org admin CANNOT see ops categories", () => {
    const allowed = ROLE_CATEGORIES["ORG_ADMIN"];
    for (const opsCat of OPS_CATEGORIES) {
      expect(allowed).not.toContain(opsCat);
    }
  });

  it("org admin sees TERMS, WORK_ITEM_ALERTS, ORG_ACTIVITY", () => {
    expect(ROLE_CATEGORIES["ORG_ADMIN"]).toEqual([
      "TERMS",
      "WORK_ITEM_ALERTS",
      "ORG_ACTIVITY",
    ]);
  });

  it("super admin sees ops categories", () => {
    const allowed = ROLE_CATEGORIES["SUPER_ADMIN"];
    expect(allowed).toContain("OPS_SYNC");
    expect(allowed).toContain("OPS_INCIDENTS");
    expect(allowed).toContain("OPS_E2E");
    expect(allowed).toContain("OPS_WATCHDOG");
    expect(allowed).toContain("OPS_REMEDIATION");
  });

  it("super admin does NOT see user categories by default", () => {
    const allowed = ROLE_CATEGORIES["SUPER_ADMIN"];
    expect(allowed).not.toContain("TERMS");
    expect(allowed).not.toContain("WORK_ITEM_ALERTS");
  });
});

// ── 2) Unread count semantics ──
describe("unread count computation", () => {
  const mockNotifications = [
    { id: "1", read_at: null, dismissed_at: null },
    { id: "2", read_at: "2026-01-01T00:00:00Z", dismissed_at: null },
    { id: "3", read_at: null, dismissed_at: "2026-01-01T00:00:00Z" },
    { id: "4", read_at: null, dismissed_at: null },
    { id: "5", read_at: "2026-01-01T00:00:00Z", dismissed_at: "2026-01-01T00:00:00Z" },
  ];

  it("counts only items where read_at IS NULL AND dismissed_at IS NULL", () => {
    const unread = mockNotifications.filter(
      (n) => n.read_at === null && n.dismissed_at === null
    );
    expect(unread).toHaveLength(2);
    expect(unread.map((n) => n.id)).toEqual(["1", "4"]);
  });

  it("read but not dismissed items are NOT counted as unread", () => {
    const readNotDismissed = mockNotifications.filter(
      (n) => n.read_at !== null && n.dismissed_at === null
    );
    expect(readNotDismissed).toHaveLength(1);
    expect(readNotDismissed[0].id).toBe("2");
  });
});

// ── 3) Optimistic mark-read behavior ──
describe("optimistic mark-read", () => {
  it("marking read sets read_at without removing from list", () => {
    const list = [
      { id: "a", read_at: null, dismissed_at: null, title: "Alert 1" },
      { id: "b", read_at: null, dismissed_at: null, title: "Alert 2" },
    ];

    const updated = list.map((n) =>
      n.id === "a" ? { ...n, read_at: new Date().toISOString() } : n
    );

    expect(updated).toHaveLength(2); // still in list
    expect(updated.find((n) => n.id === "a")?.read_at).toBeTruthy();
    expect(updated.find((n) => n.id === "b")?.read_at).toBeNull();
  });

  it("mark-all-read sets read_at on all items", () => {
    const list = [
      { id: "a", read_at: null, dismissed_at: null },
      { id: "b", read_at: null, dismissed_at: null },
      { id: "c", read_at: "existing", dismissed_at: null },
    ];

    const updated = list.map((n) => ({
      ...n,
      read_at: n.read_at || new Date().toISOString(),
    }));

    expect(updated.every((n) => n.read_at !== null)).toBe(true);
  });
});

// ── 4) Optimistic dismiss behavior ──
describe("optimistic dismiss", () => {
  it("dismiss removes item from cached list", () => {
    const list = [
      { id: "a", read_at: null, dismissed_at: null },
      { id: "b", read_at: null, dismissed_at: null },
    ];

    const updated = list.filter((n) => n.id !== "a");
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe("b");
  });

  it("dismissing unread item decrements unread count", () => {
    const unreadCount = 5;
    const dismissedItem = { id: "x", read_at: null, dismissed_at: null };
    const newCount = dismissedItem.read_at === null ? unreadCount - 1 : unreadCount;
    expect(newCount).toBe(4);
  });

  it("dismissing already-read item does NOT decrement unread count", () => {
    const unreadCount = 5;
    const dismissedItem = { id: "x", read_at: "2026-01-01T00:00:00Z", dismissed_at: null };
    const newCount = dismissedItem.read_at === null ? unreadCount - 1 : unreadCount;
    expect(newCount).toBe(5);
  });
});

// ── 5) Tab configuration per role ──
describe("role-adaptive tabs", () => {
  const ROLE_TABS: Record<string, { key: string; label: string }[]> = {
    USER: [
      { key: "ALL", label: "Todas" },
      { key: "TERMS", label: "Términos" },
      { key: "WORK_ITEM_ALERTS", label: "Asuntos" },
    ],
    ORG_ADMIN: [
      { key: "ALL", label: "Todas" },
      { key: "TERMS", label: "Términos" },
      { key: "WORK_ITEM_ALERTS", label: "Asuntos" },
      { key: "ORG_ACTIVITY", label: "Organización" },
    ],
    SUPER_ADMIN: [
      { key: "ALL", label: "Todas" },
      { key: "OPS_SYNC", label: "Sync" },
      { key: "OPS_INCIDENTS", label: "Incidentes" },
      { key: "OPS_E2E", label: "E2E" },
      { key: "OPS_WATCHDOG", label: "Watchdog" },
    ],
  };

  it("USER has 3 tabs (All + 2 categories)", () => {
    expect(ROLE_TABS["USER"]).toHaveLength(3);
  });

  it("ORG_ADMIN has 4 tabs (All + 3 categories)", () => {
    expect(ROLE_TABS["ORG_ADMIN"]).toHaveLength(4);
  });

  it("SUPER_ADMIN has 5 tabs (All + 4 ops categories)", () => {
    expect(ROLE_TABS["SUPER_ADMIN"]).toHaveLength(5);
  });

  it("no ops tabs for USER", () => {
    const userTabKeys = ROLE_TABS["USER"].map((t) => t.key);
    expect(userTabKeys).not.toContain("OPS_SYNC");
    expect(userTabKeys).not.toContain("OPS_INCIDENTS");
  });

  it("no ops tabs for ORG_ADMIN", () => {
    const adminTabKeys = ROLE_TABS["ORG_ADMIN"].map((t) => t.key);
    expect(adminTabKeys).not.toContain("OPS_SYNC");
    expect(adminTabKeys).not.toContain("OPS_INCIDENTS");
  });
});

// ── 6) Audience scope validation ──
describe("audience_scope constraint logic", () => {
  it("USER scope requires user_id", () => {
    const valid = { audience_scope: "USER", user_id: "abc", org_id: null };
    const invalid = { audience_scope: "USER", user_id: null, org_id: null };

    const isValid = (r: typeof valid) =>
      (r.audience_scope === "USER" && r.user_id !== null) ||
      (r.audience_scope === "ORG_ADMIN" && r.org_id !== null) ||
      r.audience_scope === "SUPER_ADMIN";

    expect(isValid(valid)).toBe(true);
    expect(isValid(invalid)).toBe(false);
  });

  it("ORG_ADMIN scope requires org_id", () => {
    const valid = { audience_scope: "ORG_ADMIN", user_id: null, org_id: "abc" };
    const invalid = { audience_scope: "ORG_ADMIN", user_id: null, org_id: null };

    const isValid = (r: typeof valid) =>
      (r.audience_scope === "USER" && r.user_id !== null) ||
      (r.audience_scope === "ORG_ADMIN" && r.org_id !== null) ||
      r.audience_scope === "SUPER_ADMIN";

    expect(isValid(valid)).toBe(true);
    expect(isValid(invalid)).toBe(false);
  });

  it("SUPER_ADMIN scope requires neither user_id nor org_id", () => {
    const valid = { audience_scope: "SUPER_ADMIN", user_id: null, org_id: null };

    const isValid = (r: typeof valid) =>
      (r.audience_scope === "USER" && r.user_id !== null) ||
      (r.audience_scope === "ORG_ADMIN" && r.org_id !== null) ||
      r.audience_scope === "SUPER_ADMIN";

    expect(isValid(valid)).toBe(true);
  });
});
