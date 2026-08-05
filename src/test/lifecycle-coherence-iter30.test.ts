/**
 * ITERATION 30 — the lifecycle is ONE fact, not three.
 *
 * The UI derivation must never promise a recovery window that the row does
 * not have. ARCHIVED without deleted_at is not the papelera.
 */
import { describe, it, expect } from "vitest";
import "./helpers/localstorage-polyfill";
import { deriveLifecycleView } from "@/hooks/use-work-item-actions";

describe("deriveLifecycleView", () => {
  it("treats only DELETED as the papelera", () => {
    expect(deriveLifecycleView({ lifecycle_state: "DELETED", deleted_at: "2026-01-01" } as never)).toBe("DELETED");
  });

  it("does NOT render the trash screen for an ARCHIVED row without deleted_at", () => {
    // The 874dea9a regression: ARCHIVED + deleted_at NULL + status ACTIVE.
    expect(deriveLifecycleView({ lifecycle_state: "ARCHIVED", deleted_at: null } as never)).toBe("CLOSED");
  });

  it("still honours a legacy ARCHIVED row that really was trashed", () => {
    expect(deriveLifecycleView({ lifecycle_state: "ARCHIVED", deleted_at: "2026-01-01" } as never)).toBe("DELETED");
  });

  it("maps the remaining states", () => {
    expect(deriveLifecycleView({ lifecycle_state: "ACTIVE" } as never)).toBe("ACTIVE");
    expect(deriveLifecycleView({ lifecycle_state: "PAUSED" } as never)).toBe("PAUSED");
    expect(deriveLifecycleView({ lifecycle_state: "CLOSED" } as never)).toBe("CLOSED");
  });

  it("falls back to the legacy fields when lifecycle_state is absent", () => {
    expect(deriveLifecycleView({ deleted_at: "2026-01-01" } as never)).toBe("DELETED");
    expect(deriveLifecycleView({ monitoring_enabled: false } as never)).toBe("PAUSED");
    expect(deriveLifecycleView({ monitoring_enabled: true } as never)).toBe("ACTIVE");
  });
});
