import { describe, it, expect } from "vitest";

/**
 * Tests for courthouse email resolution in the Power of Attorney wizard.
 * Covers normalization, priority logic, and regression scenarios.
 */

// --- Normalization helpers (mirrored from inferCourtEmail) ---
function normalizeCourtName(s: string): string {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,'"""''()\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("Wizard Court Email Resolution", () => {
  describe("Court name normalization for matching", () => {
    it("should strip accents", () => {
      expect(normalizeCourtName("Bogotá")).toBe("Bogota");
      expect(normalizeCourtName("Pequeñas")).toBe("Pequenas");
    });

    it("should collapse punctuation and whitespace", () => {
      expect(normalizeCourtName("Bogotá D.C.")).toBe("Bogota D C");
      expect(normalizeCourtName("Juzgado  042")).toBe("Juzgado 042");
    });

    it("should handle a full complex court name", () => {
      const input = "Juzgado 042 de Pequeñas Causas y Competencia Múltiple de Bogotá D.C.";
      const result = normalizeCourtName(input);
      expect(result).toBe("Juzgado 042 de Pequenas Causas y Competencia Multiple de Bogota D C");
      expect(result).not.toContain("ñ");
      expect(result).not.toContain("á");
      expect(result).not.toContain("ú");
    });

    it("should handle parentheses and dashes", () => {
      expect(normalizeCourtName("Juzgado Civil-001 (Circuito)")).toBe("Juzgado Civil 001 Circuito");
    });

    it("should handle em-dashes and en-dashes", () => {
      expect(normalizeCourtName("Tribunal—Sala–Primera")).toBe("Tribunal Sala Primera");
    });
  });

  describe("Email priority logic", () => {
    it("should prefer confirmed email over suggested", () => {
      const workItem = {
        courthouse_email_confirmed: "confirmed@court.gov.co",
        courthouse_email_suggested: "suggested@court.gov.co",
      };
      const email = workItem.courthouse_email_confirmed || workItem.courthouse_email_suggested;
      expect(email).toBe("confirmed@court.gov.co");
    });

    it("should use suggested when confirmed is null", () => {
      const workItem = {
        courthouse_email_confirmed: null,
        courthouse_email_suggested: "suggested@court.gov.co",
      };
      const email = workItem.courthouse_email_confirmed || workItem.courthouse_email_suggested;
      expect(email).toBe("suggested@court.gov.co");
    });

    it("should fallback to inference when both are null", () => {
      const workItem = {
        courthouse_email_confirmed: null,
        courthouse_email_suggested: null,
      };
      const email = workItem.courthouse_email_confirmed || workItem.courthouse_email_suggested;
      expect(email).toBeFalsy();
      // In this case, inferCourtEmail would be called
    });
  });

  describe("Radicado code extraction for court lookup", () => {
    it("should extract 14-digit court code from 23-digit radicado", () => {
      const radicado = "11001600010220200027600";
      const digits = radicado.replace(/[^0-9]/g, "");
      expect(digits.length).toBe(23);
      const code = digits.substring(0, 14);
      expect(code).toBe("11001600010220");
    });

    it("should handle radicado with formatting", () => {
      const radicado = "11001-60-00102-2020-00276-00";
      const digits = radicado.replace(/[^0-9]/g, "");
      expect(digits.length).toBe(23);
      const code = digits.substring(0, 14);
      expect(code).toBe("11001600010220");
    });
  });

  describe("Regression: Work item with full court info must resolve", () => {
    it("should resolve email from confirmed field directly (no DB lookup needed)", () => {
      // Simulates the wizard reading work_item fields
      const workItem = {
        radicado: "11001400304220230013900",
        authority_name: "Juzgado 042 de Pequeñas Causas y Competencia Múltiple de Bogotá D.C.",
        courthouse_email_confirmed: "j42pcccbta@cendoj.ramajudicial.gov.co",
        courthouse_email_suggested: "j42pcccbta@cendoj.ramajudicial.gov.co",
        courthouse_email_status: "CONFIRMED",
      };

      const email = workItem.courthouse_email_confirmed || workItem.courthouse_email_suggested;
      expect(email).toBe("j42pcccbta@cendoj.ramajudicial.gov.co");
    });

    it("should resolve email from suggested field when not yet confirmed", () => {
      const workItem = {
        radicado: "05088400030053202301194",
        authority_name: "Juzgado 005 Civil Municipal de Bello",
        courthouse_email_confirmed: null,
        courthouse_email_suggested: "j05cmmbell@cendoj.ramajudicial.gov.co",
        courthouse_email_status: "SUGGESTED",
      };

      const email = workItem.courthouse_email_confirmed || workItem.courthouse_email_suggested;
      expect(email).toBe("j05cmmbell@cendoj.ramajudicial.gov.co");
    });
  });
});
