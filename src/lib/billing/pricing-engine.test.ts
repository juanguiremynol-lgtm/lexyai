/**
 * Pricing Engine Tests
 * Unit tests for price resolution, discount validation, and amount computation
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveCurrentPricePoint,
  validateDiscountEligibility,
  computeDiscountAmountCop,
  buildAmountBreakdown,
  verifyAmountMatch,
  PricePointData,
  DiscountCodeData,
} from "./pricing-engine";

describe("Pricing Engine", () => {
  let mockPricePoints: PricePointData[];
  let mockDiscount: DiscountCodeData;

  beforeEach(() => {
    // Create mock data with Bogota timezone awareness
    mockPricePoints = [
      {
        id: "pp1",
        plan_id: "plan-basic",
        price_cop_incl_iva: 100000,
        billing_cycle_months: 1,
        price_type: "REGULAR",
        valid_from: "2026-01-01T00:00:00-05:00",
        valid_to: null,
        version_number: 1,
        is_active: true,
      },
      {
        id: "pp2",
        plan_id: "plan-basic",
        price_cop_incl_iva: 150000,
        billing_cycle_months: 1,
        price_type: "REGULAR",
        valid_from: "2026-03-01T00:00:00-05:00",
        valid_to: null,
        version_number: 2,
        is_active: true,
      },
      {
        id: "pp3",
        plan_id: "plan-basic",
        price_cop_incl_iva: 200000,
        billing_cycle_months: 12,
        price_type: "REGULAR",
        valid_from: "2026-01-01T00:00:00-05:00",
        valid_to: null,
        version_number: 1,
        is_active: true,
      },
    ];

    mockDiscount = {
      id: "disc1",
      code: "EARLY2026",
      discount_type: "PERCENT",
      discount_value: 10,
      is_active: true,
      valid_from: "2026-01-01T00:00:00-05:00",
      valid_to: "2026-06-30T23:59:59-05:00",
      max_redemptions: 100,
      current_redemptions: 25,
      eligible_plans: ["plan-basic"],
      eligible_cycles: [1, 12],
      target_org_id: null,
      target_user_email: null,
    };
  });

  describe("resolveCurrentPricePoint", () => {
    it("should resolve the correct price point at a given time", () => {
      const atTime = new Date("2026-02-01T12:00:00-05:00");
      const result = resolveCurrentPricePoint(mockPricePoints, {
        planId: "plan-basic",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime,
      });

      expect(result).toBeDefined();
      expect(result?.price_cop_incl_iva).toBe(100000);
      expect(result?.version_number).toBe(1);
    });

    it("should use latest version after effective date", () => {
      const atTime = new Date("2026-04-01T12:00:00-05:00");
      const result = resolveCurrentPricePoint(mockPricePoints, {
        planId: "plan-basic",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime,
      });

      expect(result).toBeDefined();
      expect(result?.price_cop_incl_iva).toBe(150000);
      expect(result?.version_number).toBe(2);
    });

    it("should return null if no matching price point", () => {
      const atTime = new Date("2026-01-01T12:00:00-05:00");
      const result = resolveCurrentPricePoint(mockPricePoints, {
        planId: "non-existent-plan",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime,
      });

      expect(result).toBeNull();
    });

    it("should handle timezone boundaries correctly", () => {
      // Test right at the boundary of 2026-03-01 in Bogota
      const atTime = new Date("2026-02-28T23:59:59-05:00");
      const result = resolveCurrentPricePoint(mockPricePoints, {
        planId: "plan-basic",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime,
      });

      expect(result?.version_number).toBe(1);

      // One second later, should get version 2
      const atTimeAfter = new Date("2026-03-01T00:00:00-05:00");
      const resultAfter = resolveCurrentPricePoint(mockPricePoints, {
        planId: "plan-basic",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime: atTimeAfter,
      });

      expect(resultAfter?.version_number).toBe(2);
    });
  });

  describe("validateDiscountEligibility", () => {
    it("should validate eligible discount", () => {
      const result = validateDiscountEligibility(
        mockDiscount,
        "plan-basic",
        1
      );

      expect(result.eligible).toBe(true);
      expect(result.error_code).toBeUndefined();
    });

    it("should reject inactive discount", () => {
      const inactiveDiscount = { ...mockDiscount, is_active: false };
      const result = validateDiscountEligibility(inactiveDiscount, "plan-basic", 1);

      expect(result.eligible).toBe(false);
      expect(result.error_code).toBe("DISCOUNT_INACTIVE");
    });

    it("should reject expired discount", () => {
      const expiredDiscount = {
        ...mockDiscount,
        valid_to: "2026-01-01T00:00:00-05:00",
      };
      const atTime = new Date("2026-02-01T12:00:00-05:00");
      const result = validateDiscountEligibility(
        expiredDiscount,
        "plan-basic",
        1,
        undefined,
        undefined,
        atTime
      );

      expect(result.eligible).toBe(false);
      expect(result.error_code).toBe("DISCOUNT_EXPIRED");
    });

    it("should reject discount if max redemptions reached", () => {
      const maxedDiscount = {
        ...mockDiscount,
        max_redemptions: 10,
        current_redemptions: 10,
      };
      const result = validateDiscountEligibility(maxedDiscount, "plan-basic", 1);

      expect(result.eligible).toBe(false);
      expect(result.error_code).toBe("DISCOUNT_LIMIT_REACHED");
    });

    it("should reject if plan not eligible", () => {
      const result = validateDiscountEligibility(mockDiscount, "plan-enterprise", 1);

      expect(result.eligible).toBe(false);
      expect(result.error_code).toBe("DISCOUNT_NOT_ELIGIBLE_PLAN");
    });

    it("should reject if billing cycle not eligible", () => {
      const result = validateDiscountEligibility(mockDiscount, "plan-basic", 24);

      expect(result.eligible).toBe(false);
      expect(result.error_code).toBe("DISCOUNT_NOT_ELIGIBLE_CYCLE");
    });

    it("should validate org targeting", () => {
      const targetedDiscount = {
        ...mockDiscount,
        target_org_id: "org-123",
      };

      const result = validateDiscountEligibility(
        targetedDiscount,
        "plan-basic",
        1,
        "org-456"
      );

      expect(result.eligible).toBe(false);
      expect(result.error_code).toBe("DISCOUNT_WRONG_ORG");
    });

    it("should validate user email targeting", () => {
      const targetedDiscount = {
        ...mockDiscount,
        target_user_email: "user@example.com",
      };

      const result = validateDiscountEligibility(
        targetedDiscount,
        "plan-basic",
        1,
        undefined,
        "other@example.com"
      );

      expect(result.eligible).toBe(false);
      expect(result.error_code).toBe("DISCOUNT_WRONG_USER");
    });
  });

  describe("computeDiscountAmountCop", () => {
    it("should compute percent discount correctly", () => {
      const result = computeDiscountAmountCop(100000, "PERCENT", 10);
      expect(result).toBe(10000);
    });

    it("should cap percent discount at base price", () => {
      const result = computeDiscountAmountCop(100000, "PERCENT", 150);
      expect(result).toBe(100000);
    });

    it("should compute fixed discount correctly", () => {
      const result = computeDiscountAmountCop(100000, "FIXED_COP", 25000);
      expect(result).toBe(25000);
    });

    it("should cap fixed discount at base price", () => {
      const result = computeDiscountAmountCop(100000, "FIXED_COP", 150000);
      expect(result).toBe(100000);
    });

    it("should always return integer COP amounts", () => {
      const result = computeDiscountAmountCop(100000, "PERCENT", 17);
      expect(Number.isInteger(result)).toBe(true);
    });

    it("should never return negative discount", () => {
      const result1 = computeDiscountAmountCop(100000, "FIXED_COP", 0);
      const result2 = computeDiscountAmountCop(100000, "PERCENT", 0);

      expect(result1).toBeGreaterThanOrEqual(0);
      expect(result2).toBeGreaterThanOrEqual(0);
    });
  });

  describe("buildAmountBreakdown", () => {
    it("should build correct breakdown without discount", () => {
      const result = buildAmountBreakdown(mockPricePoints[0], null);

      expect(result.base_price_cop).toBe(100000);
      expect(result.discount_amount_cop).toBe(0);
      expect(result.final_payable_cop).toBe(100000);
      expect(result.currency).toBe("COP");
      expect(result.discount_code).toBeNull();
    });

    it("should build correct breakdown with percent discount", () => {
      const result = buildAmountBreakdown(mockPricePoints[0], mockDiscount);

      expect(result.base_price_cop).toBe(100000);
      expect(result.discount_amount_cop).toBe(10000); // 10% of 100000
      expect(result.final_payable_cop).toBe(90000);
      expect(result.discount_code).toBe("EARLY2026");
      expect(result.discount_value).toBe(10);
    });

    it("should ensure final payable is never negative", () => {
      const hugeDiscount: DiscountCodeData = {
        ...mockDiscount,
        discount_type: "FIXED_COP",
        discount_value: 999999,
      };

      const result = buildAmountBreakdown(mockPricePoints[0], hugeDiscount);

      expect(result.final_payable_cop).toBeGreaterThanOrEqual(0);
      expect(result.final_payable_cop).toBe(0);
    });

    it("should store historical version info", () => {
      const result = buildAmountBreakdown(mockPricePoints[1], null);

      expect(result.price_point_id).toBe("pp2");
      expect(result.price_point_version).toBe(2);
      expect(result.plan_id).toBe("plan-basic");
      expect(result.billing_cycle_months).toBe(1);
    });
  });

  describe("verifyAmountMatch", () => {
    it("should confirm matching amounts", () => {
      const breakdown = buildAmountBreakdown(mockPricePoints[0], null);
      const result = verifyAmountMatch(100000, breakdown);

      expect(result.matches).toBe(true);
      expect(result.expected).toBe(100000);
      expect(result.actual).toBe(100000);
    });

    it("should detect mismatched amounts", () => {
      const breakdown = buildAmountBreakdown(mockPricePoints[0], null);
      const result = verifyAmountMatch(95000, breakdown);

      expect(result.matches).toBe(false);
      expect(result.expected).toBe(100000);
      expect(result.actual).toBe(95000);
    });

    it("should provide formatted error message on mismatch", () => {
      const breakdown = buildAmountBreakdown(mockPricePoints[0], null);
      const result = verifyAmountMatch(95000, breakdown);

      expect(result.detail).toContain("incorrecto");
    });
  });

  describe("Timezone edge cases (Bogota America/Bogota)", () => {
    it("should correctly handle DST boundaries", () => {
      // Bogota is UTC-5 year-round, no DST
      const date1 = new Date("2026-01-01T23:59:59Z"); // 2026-01-01 18:59:59 Bogota
      const date2 = new Date("2026-03-01T00:00:00Z"); // 2026-02-28 19:00:00 Bogota

      expect(date1.getTime()).toBeLessThan(date2.getTime());
    });

    it("should resolve prices at midnight Bogota time correctly", () => {
      // 2026-03-01 00:00:00 Bogota = 2026-03-01 05:00:00 UTC
      const midnightBogota = new Date("2026-03-01T05:00:00Z");

      const result = resolveCurrentPricePoint(mockPricePoints, {
        planId: "plan-basic",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime: midnightBogota,
      });

      expect(result?.version_number).toBe(2);
    });
  });
});
