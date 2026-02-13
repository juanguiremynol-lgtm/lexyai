/**
 * Integration Tests for Billing System
 * Tests checkout, invoice creation, verification, and renewal workflows
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildAmountBreakdown, verifyAmountMatch, resolveCurrentPricePoint } from "./pricing-engine";
import type { PricePointData, DiscountCodeData, AmountBreakdown } from "./pricing-engine";

describe("Billing Integration Tests", () => {
  describe("Checkout & Invoice Idempotency", () => {
    it("should create identical breakdowns for same inputs (idempotency)", () => {
      const pricePoint: PricePointData = {
        id: "pp-test",
        plan_id: "plan-basic",
        price_cop_incl_iva: 150000,
        billing_cycle_months: 1,
        price_type: "REGULAR",
        valid_from: "2026-01-01T00:00:00-05:00",
        valid_to: null,
        version_number: 1,
        is_active: true,
      };

      const discount: DiscountCodeData = {
        id: "disc-test",
        code: "EARLYBIRD",
        discount_type: "PERCENT",
        discount_value: 15,
        is_active: true,
        valid_from: "2026-01-01T00:00:00-05:00",
        valid_to: "2026-12-31T23:59:59-05:00",
        max_redemptions: 1000,
        current_redemptions: 100,
        eligible_plans: ["plan-basic"],
        eligible_cycles: [1],
        target_org_id: null,
        target_user_email: null,
      };

      // Create breakdown twice
      const breakdown1 = buildAmountBreakdown(pricePoint, discount);
      const breakdown2 = buildAmountBreakdown(pricePoint, discount);

      // Should be identical
      expect(breakdown1.final_payable_cop).toBe(breakdown2.final_payable_cop);
      expect(breakdown1.discount_amount_cop).toBe(breakdown2.discount_amount_cop);
      expect(breakdown1.base_price_cop).toBe(breakdown2.base_price_cop);
      expect(breakdown1.price_point_id).toBe(breakdown2.price_point_id);
      expect(breakdown1.price_point_version).toBe(breakdown2.price_point_version);
    });

    it("should verify identical payments as matching", () => {
      const breakdown = buildAmountBreakdown(
        {
          id: "pp1",
          plan_id: "plan-pro",
          price_cop_incl_iva: 300000,
          billing_cycle_months: 1,
          price_type: "REGULAR",
          valid_from: "2026-01-01T00:00:00-05:00",
          valid_to: null,
          version_number: 1,
          is_active: true,
        },
        null
      );

      // Simulate repeated verification calls (from webhook retry)
      const verify1 = verifyAmountMatch(300000, breakdown);
      const verify2 = verifyAmountMatch(300000, breakdown);
      const verify3 = verifyAmountMatch(300000, breakdown);

      expect(verify1.matches).toBe(true);
      expect(verify2.matches).toBe(true);
      expect(verify3.matches).toBe(true);
    });
  });

  describe("Price Version Resolution Across Time", () => {
    let priceHistory: PricePointData[];

    beforeEach(() => {
      priceHistory = [
        {
          id: "pp-v1",
          plan_id: "plan-business",
          price_cop_incl_iva: 500000,
          billing_cycle_months: 1,
          price_type: "REGULAR",
          valid_from: "2026-01-01T00:00:00-05:00",
          valid_to: "2026-02-28T23:59:59-05:00",
          version_number: 1,
          is_active: true,
        },
        {
          id: "pp-v2",
          plan_id: "plan-business",
          price_cop_incl_iva: 600000,
          billing_cycle_months: 1,
          price_type: "REGULAR",
          valid_from: "2026-03-01T00:00:00-05:00",
          valid_to: null,
          version_number: 2,
          is_active: true,
        },
      ];
    });

    it("should use historical price for past invoices", () => {
      // Invoice created on 2026-02-15
      const invoiceTime = new Date("2026-02-15T12:00:00-05:00");
      const resolved = resolveCurrentPricePoint(priceHistory, {
        planId: "plan-business",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime: invoiceTime,
      });

      expect(resolved?.price_cop_incl_iva).toBe(500000);
      expect(resolved?.version_number).toBe(1);
    });

    it("should use new price for post-effective-date invoices", () => {
      // Invoice created on 2026-03-15
      const invoiceTime = new Date("2026-03-15T12:00:00-05:00");
      const resolved = resolveCurrentPricePoint(priceHistory, {
        planId: "plan-business",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime: invoiceTime,
      });

      expect(resolved?.price_cop_incl_iva).toBe(600000);
      expect(resolved?.version_number).toBe(2);
    });

    it("should handle concurrent versions without overlap", () => {
      // At exactly the boundary (should use v1 at 23:59:59, v2 at 00:00:00)
      const endOfV1 = new Date("2026-02-28T23:59:59-05:00");
      const startOfV2 = new Date("2026-03-01T00:00:00-05:00");

      const resolvedV1 = resolveCurrentPricePoint(priceHistory, {
        planId: "plan-business",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime: endOfV1,
      });

      const resolvedV2 = resolveCurrentPricePoint(priceHistory, {
        planId: "plan-business",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime: startOfV2,
      });

      expect(resolvedV1?.version_number).toBe(1);
      expect(resolvedV2?.version_number).toBe(2);
    });
  });

  describe("Payment Verification Workflow", () => {
    it("should reject amount mismatches strictly", () => {
      const breakdown: AmountBreakdown = {
        price_point_id: "pp1",
        price_point_version: 1,
        base_price_cop: 100000,
        discount_code_id: null,
        discount_code: null,
        discount_type: null,
        discount_value: null,
        discount_amount_cop: 0,
        final_payable_cop: 100000,
        currency: "COP",
        computed_at: new Date().toISOString(),
        plan_id: "plan-test",
        billing_cycle_months: 1,
        price_type: "REGULAR",
      };

      const testCases = [
        { amount: 100000, shouldMatch: true },
        { amount: 99999, shouldMatch: false },
        { amount: 100001, shouldMatch: false },
        { amount: 95000, shouldMatch: false }, // Even close amounts don't match
      ];

      for (const testCase of testCases) {
        const result = verifyAmountMatch(testCase.amount, breakdown);
        expect(result.matches).toBe(testCase.shouldMatch);
      }
    });

    it("should be idempotent: repeated verifications don't change state", () => {
      const breakdown: AmountBreakdown = {
        price_point_id: "pp1",
        price_point_version: 1,
        base_price_cop: 200000,
        discount_code_id: null,
        discount_code: null,
        discount_type: null,
        discount_value: null,
        discount_amount_cop: 0,
        final_payable_cop: 200000,
        currency: "COP",
        computed_at: new Date().toISOString(),
        plan_id: "plan-test",
        billing_cycle_months: 1,
        price_type: "REGULAR",
      };

      // Simulate webhook retry (3 identical attempts)
      const results = [
        verifyAmountMatch(200000, breakdown),
        verifyAmountMatch(200000, breakdown),
        verifyAmountMatch(200000, breakdown),
      ];

      // All should be identical
      expect(results[0].matches).toBe(results[1].matches);
      expect(results[1].matches).toBe(results[2].matches);
      expect(results[0].actual).toBe(results[1].actual);
      expect(results[1].actual).toBe(results[2].actual);
    });
  });

  describe("Renewal Workflow", () => {
    it("should apply correct price version for renewal date", () => {
      const versions: PricePointData[] = [
        {
          id: "pp-v1",
          plan_id: "plan-renewal-test",
          price_cop_incl_iva: 100000,
          billing_cycle_months: 1,
          price_type: "REGULAR",
          valid_from: "2026-01-01T00:00:00-05:00",
          valid_to: "2026-03-31T23:59:59-05:00",
          version_number: 1,
          is_active: true,
        },
        {
          id: "pp-v2",
          plan_id: "plan-renewal-test",
          price_cop_incl_iva: 120000,
          billing_cycle_months: 1,
          price_type: "REGULAR",
          valid_from: "2026-04-01T00:00:00-05:00",
          valid_to: null,
          version_number: 2,
          is_active: true,
        },
      ];

      // Subscription created with v1 on Jan 15
      const createdAt = new Date("2026-01-15T10:00:00-05:00");
      const created = resolveCurrentPricePoint(versions, {
        planId: "plan-renewal-test",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime: createdAt,
      });

      expect(created?.version_number).toBe(1);

      // Renewal on March 15 (still v1)
      const renewalMarch = new Date("2026-03-15T10:00:00-05:00");
      const renewedMarch = resolveCurrentPricePoint(versions, {
        planId: "plan-renewal-test",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime: renewalMarch,
      });

      expect(renewedMarch?.version_number).toBe(1);

      // Renewal on April 15 (now v2)
      const renewalApril = new Date("2026-04-15T10:00:00-05:00");
      const renewedApril = resolveCurrentPricePoint(versions, {
        planId: "plan-renewal-test",
        billingCycleMonths: 1,
        priceType: "REGULAR",
        atTime: renewalApril,
      });

      expect(renewedApril?.version_number).toBe(2);
    });
  });

  describe("Amount Computation Determinism", () => {
    it("should always compute the same discount for same inputs", () => {
      const basePrice = 250000;
      const discount = {
        id: "test-disc",
        code: "TEST",
        discount_type: "PERCENT" as const,
        discount_value: 20,
        is_active: true,
        valid_from: "2026-01-01T00:00:00-05:00",
        valid_to: null,
        max_redemptions: null,
        current_redemptions: 0,
        eligible_plans: null,
        eligible_cycles: null,
        target_org_id: null,
        target_user_email: null,
      };

      const results = Array(10)
        .fill(null)
        .map(() => {
          const pp: PricePointData = {
            id: "pp-test",
            plan_id: "plan-test",
            price_cop_incl_iva: basePrice,
            billing_cycle_months: 1,
            price_type: "REGULAR",
            valid_from: "2026-01-01T00:00:00-05:00",
            valid_to: null,
            version_number: 1,
            is_active: true,
          };
          return buildAmountBreakdown(pp, discount);
        });

      // All results should be identical
      const first = results[0];
      for (const result of results.slice(1)) {
        expect(result.final_payable_cop).toBe(first.final_payable_cop);
        expect(result.discount_amount_cop).toBe(first.discount_amount_cop);
      }
    });
  });
});
