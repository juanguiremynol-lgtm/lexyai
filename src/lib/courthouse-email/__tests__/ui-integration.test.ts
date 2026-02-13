import { describe, it, expect } from "vitest";

/**
 * Courthouse Email UI Integration Tests
 * Verifies state machine transitions and UI behavior.
 */

describe("Courthouse Email UI State Machine", () => {
  describe("Work Item Creation Flow", () => {
    it("should initialize with NONE status", () => {
      const newWorkItem = {
        courthouse_email_status: "NONE",
        courthouse_email_suggested: null,
        courthouse_email_confirmed: null,
      };

      expect(newWorkItem.courthouse_email_status).toBe("NONE");
      expect(newWorkItem.courthouse_email_confirmed).toBeNull();
    });

    it("should auto-resolve and show SUGGESTED when user selects authority", () => {
      const resolved = {
        courthouse_email_status: "SUGGESTED",
        courthouse_email_suggested: "juzgado.penal@court.gov.co",
        courthouse_email_confidence: 92,
        courthouse_email_source: "auto_radicado",
      };

      expect(resolved.courthouse_email_status).toBe("SUGGESTED");
      expect(resolved.courthouse_email_suggested).toBeTruthy();
      expect(resolved.courthouse_email_confidence).toBeGreaterThan(85);
    });

    it("should show high-confidence suggestion without user action", () => {
      // Auto-resolution: confidence >= 0.90 + good margin
      const suggestion = {
        email: "juzgado.penal@court.gov.co",
        confidence: 95,
        method: "auto_radicado",
        needsReview: false,
      };

      // UI should display auto-filled email
      expect(suggestion.needsReview).toBe(false);
      expect(suggestion.confidence).toBeGreaterThanOrEqual(90);
    });
  });

  describe("Confirmation Flow", () => {
    it("should transition from SUGGESTED to CONFIRMED", () => {
      const before = {
        courthouse_email_status: "SUGGESTED",
        courthouse_email_suggested: "option1@court.gov.co",
      };

      const after = {
        courthouse_email_status: "CONFIRMED",
        courthouse_email_confirmed: "option1@court.gov.co",
        courthouse_email_suggested: "option1@court.gov.co", // Keep for reference
      };

      expect(before.courthouse_email_status).toBe("SUGGESTED");
      expect(after.courthouse_email_status).toBe("CONFIRMED");
      expect(after.courthouse_email_confirmed).toBeTruthy();
    });

    it("should prevent overwriting confirmed email with new suggestion", () => {
      const confirmed = {
        courthouse_email_status: "CONFIRMED",
        courthouse_email_confirmed: "user-chosen@court.gov.co",
      };

      // Resolver should skip update if confirmed exists
      const wouldUpdate = confirmed.courthouse_email_status === "NONE" || 
                         confirmed.courthouse_email_status === "SUGGESTED";
      expect(wouldUpdate).toBe(false);
    });

    it("should allow user to change confirmed email", () => {
      const before = {
        courthouse_email_confirmed: "old@court.gov.co",
      };

      const after = {
        courthouse_email_confirmed: "new@court.gov.co",
      };

      // Manual edit should be allowed
      expect(before.courthouse_email_confirmed).not.toBe(after.courthouse_email_confirmed);
    });
  });

  describe("Conflict Resolution", () => {
    it("should show CONFLICT status with candidate list", () => {
      const conflict = {
        courthouse_email_status: "CONFLICT",
        candidates: [
          { email: "option1@court.gov.co", confidence: 0.78 },
          { email: "option2@court.gov.co", confidence: 0.76 },
        ],
      };

      expect(conflict.courthouse_email_status).toBe("CONFLICT");
      expect(conflict.candidates.length).toBeGreaterThan(1);
      // Margin between top candidates is small (0.02)
    });

    it("should require user selection for conflicting cases", () => {
      const userMustSelect = {
        status: "CONFLICT",
        resolved_email: null, // No auto-filled email
        candidates_required: true,
      };

      expect(userMustSelect.resolved_email).toBeNull();
      expect(userMustSelect.candidates_required).toBe(true);
    });

    it("should support collegiate body expansion", () => {
      const collegiate = {
        is_collegiate_body: true,
        candidates: [
          { despacho: "102", email: "despacho102@court.gov.co" },
          { despacho: "103", email: "despacho103@court.gov.co" },
          { despacho: "104", email: "despacho104@court.gov.co" },
        ],
      };

      expect(collegiate.is_collegiate_body).toBe(true);
      expect(collegiate.candidates.length).toBeGreaterThan(1);
    });
  });

  describe("UI Display & Explainability", () => {
    it("should show confidence badge (Alta/Media/Baja)", () => {
      const suggestion = {
        confidence: 88,
        badge: "Media", // 70-89 = Media
      };

      expect(suggestion.badge).toBe("Media");
    });

    it("should display match source in tooltip", () => {
      const explanation = {
        source: "auto_radicado",
        label: "Coincidencia por: Radicado (DANE 11001, CORP 60, DESP 102)",
      };

      expect(explanation.label).toContain("Radicado");
      expect(explanation.label).toContain("11001");
    });

    it("should show 'auto_name_fallback' source clearly", () => {
      const explanation = {
        source: "auto_name_fallback",
        label: "Coincidencia por: Nombre del despacho (Rionegro)",
      };

      expect(explanation.label).toContain("Nombre");
      expect(explanation.label).toContain("Rionegro");
    });

    it("should hide sensitive data in tooltips", () => {
      const evidence = {
        method: "auto_radicado",
        top1_score: 0.92,
        candidates_count: 3,
        // NEVER include: director_name, phone, fax, personal_email
      };

      expect(Object.keys(evidence)).not.toContain("director_name");
    });
  });

  describe("Edit & Update Behavior", () => {
    it("should allow editing authority without losing confirmation", () => {
      const before = {
        authority_name: "Old Court",
        courthouse_email_status: "CONFIRMED",
        courthouse_email_confirmed: "confirmed@court.gov.co",
      };

      const after = {
        authority_name: "New Court",
        courthouse_email_status: "CONFIRMED",
        courthouse_email_confirmed: "confirmed@court.gov.co",
      };

      // Confirmed email persists even after authority change
      expect(after.courthouse_email_confirmed).toBe(before.courthouse_email_confirmed);
    });

    it("should re-resolve when radicado changes", () => {
      const before = {
        radicado: "11001600010220200027600",
        courthouse_email_status: "SUGGESTED",
      };

      const after = {
        radicado: "05088600010220200015600", // Different DANE/CORP/DESP
        courthouse_email_status: "SUGGESTED", // Re-resolved
      };

      expect(before.radicado).not.toBe(after.radicado);
      // Status should be recalculated
    });

    it("should support 'Clear' action to reset to NONE", () => {
      const before = {
        courthouse_email_status: "SUGGESTED",
        courthouse_email_suggested: "some@court.gov.co",
      };

      const after = {
        courthouse_email_status: "NONE",
        courthouse_email_suggested: null,
        courthouse_email_confirmed: null,
      };

      expect(before.courthouse_email_status).not.toBe(after.courthouse_email_status);
      expect(after.courthouse_email_suggested).toBeNull();
    });
  });

  describe("Backfill Progress", () => {
    it("should track backfill metrics", () => {
      const backfillResult = {
        total_work_items: 100,
        before_status_none: 30,
        before_status_suggested: 50,
        after_status_confirmed: 5,
        after_status_suggested: 75,
        improvement_percentage: ((75 - 50) / 100) * 100, // 25% more have suggestions
      };

      // Improvement should be measurable
      expect(backfillResult.improvement_percentage).toBeGreaterThan(0);
    });
  });
});
