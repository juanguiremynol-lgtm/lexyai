/**
 * Shared Pricing Engine for Edge Functions (Deno)
 * 
 * MIRROR of src/lib/billing/pricing-engine.ts
 * Keep in sync! All amounts are COP integers.
 */

// Types
export interface PricePointData {
  id: string;
  plan_id: string;
  price_cop_incl_iva: number;
  billing_cycle_months: number;
  price_type: string;
  valid_from: string;
  valid_to: string | null;
  version_number: number;
  is_active: boolean;
}

export interface DiscountCodeData {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  is_active: boolean;
  valid_from: string;
  valid_to: string | null;
  max_redemptions: number | null;
  current_redemptions: number;
  eligible_plans: string[] | null;
  eligible_cycles: number[] | null;
  target_org_id: string | null;
  target_user_email: string | null;
}

export interface AmountBreakdown {
  price_point_id: string;
  price_point_version: number;
  base_price_cop: number;
  discount_code_id: string | null;
  discount_code: string | null;
  discount_type: string | null;
  discount_value: number | null;
  discount_amount_cop: number;
  final_payable_cop: number;
  currency: "COP";
  computed_at: string;
  plan_id: string;
  billing_cycle_months: number;
  price_type: string;
}

export interface VoucherEligibilityResult {
  eligible: boolean;
  error_code?: string;
  error_message?: string;
}

// Resolve effective price point
export function resolveCurrentPricePoint(
  pricePoints: PricePointData[],
  planId: string,
  billingCycleMonths: number,
  priceType: string,
  atTime: Date
): PricePointData | null {
  const atTimeMs = atTime.getTime();
  const candidates = pricePoints.filter((pp) => {
    if (pp.plan_id !== planId) return false;
    if (pp.billing_cycle_months !== billingCycleMonths) return false;
    if (pp.price_type !== priceType) return false;
    if (!pp.is_active) return false;
    if (new Date(pp.valid_from).getTime() > atTimeMs) return false;
    if (pp.valid_to && new Date(pp.valid_to).getTime() < atTimeMs) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, pp) => pp.version_number > best.version_number ? pp : best);
}

// Validate discount eligibility
export function validateDiscountEligibility(
  discount: DiscountCodeData,
  planCode: string,
  billingCycleMonths: number,
  organizationId?: string,
  userEmail?: string,
  atTime: Date = new Date()
): VoucherEligibilityResult {
  if (!discount.is_active) return { eligible: false, error_code: "DISCOUNT_INACTIVE", error_message: "Código de descuento inactivo" };
  if (new Date(discount.valid_from) > atTime) return { eligible: false, error_code: "DISCOUNT_NOT_YET_VALID", error_message: "Código de descuento aún no es válido" };
  if (discount.valid_to && new Date(discount.valid_to) < atTime) return { eligible: false, error_code: "DISCOUNT_EXPIRED", error_message: "Código de descuento expirado" };
  if (discount.max_redemptions !== null && discount.current_redemptions >= discount.max_redemptions) return { eligible: false, error_code: "DISCOUNT_LIMIT_REACHED", error_message: "Código de descuento agotado" };
  if (discount.eligible_plans?.length && !discount.eligible_plans.includes(planCode)) return { eligible: false, error_code: "DISCOUNT_NOT_ELIGIBLE_PLAN", error_message: "Este código no aplica a este plan" };
  if (discount.eligible_cycles?.length && !discount.eligible_cycles.includes(billingCycleMonths)) return { eligible: false, error_code: "DISCOUNT_NOT_ELIGIBLE_CYCLE", error_message: "Este código no aplica a este ciclo de facturación" };
  if (discount.target_org_id && discount.target_org_id !== organizationId) return { eligible: false, error_code: "DISCOUNT_WRONG_ORG", error_message: "Este código no aplica a esta organización" };
  if (discount.target_user_email && userEmail && discount.target_user_email.toLowerCase() !== userEmail.toLowerCase()) return { eligible: false, error_code: "DISCOUNT_WRONG_USER", error_message: "Este código no aplica a este usuario" };
  return { eligible: true };
}

// Compute discount amount
export function computeDiscountAmountCop(basePriceCop: number, discountType: string, discountValue: number): number {
  if (discountType === "PERCENT") return Math.min(basePriceCop, Math.floor((basePriceCop * discountValue) / 100));
  return Math.min(discountValue, basePriceCop);
}

// Build amount breakdown
export function buildAmountBreakdown(pricePoint: PricePointData, discount: DiscountCodeData | null = null): AmountBreakdown {
  const basePriceCop = pricePoint.price_cop_incl_iva;
  let discountAmountCop = 0;
  let discountCodeId: string | null = null;
  let discountCode: string | null = null;
  let discountType: string | null = null;
  let discountValue: number | null = null;

  if (discount) {
    discountAmountCop = computeDiscountAmountCop(basePriceCop, discount.discount_type, discount.discount_value);
    discountCodeId = discount.id;
    discountCode = discount.code;
    discountType = discount.discount_type;
    discountValue = discount.discount_value;
  }

  return {
    price_point_id: pricePoint.id,
    price_point_version: pricePoint.version_number,
    base_price_cop: basePriceCop,
    discount_code_id: discountCodeId,
    discount_code: discountCode,
    discount_type: discountType,
    discount_value: discountValue,
    discount_amount_cop: discountAmountCop,
    final_payable_cop: Math.max(0, basePriceCop - discountAmountCop),
    currency: "COP",
    computed_at: new Date().toISOString(),
    plan_id: pricePoint.plan_id,
    billing_cycle_months: pricePoint.billing_cycle_months,
    price_type: pricePoint.price_type,
  };
}

// Verify amount match
export function verifyAmountMatch(paidAmountCop: number, breakdown: AmountBreakdown): { matches: boolean; expected: number; actual: number; detail: string } {
  const matches = paidAmountCop === breakdown.final_payable_cop;
  return {
    matches,
    expected: breakdown.final_payable_cop,
    actual: paidAmountCop,
    detail: matches
      ? `Monto correcto: $${paidAmountCop.toLocaleString("es-CO")} COP`
      : `⚠️ Monto incorrecto: esperado $${breakdown.final_payable_cop.toLocaleString("es-CO")}, recibido $${paidAmountCop.toLocaleString("es-CO")} COP`,
  };
}

// Redact secrets
const SENSITIVE_KEYS = ["card_number", "cvv", "cvc", "security_code", "pan", "token", "secret", "password", "api_key", "private_key", "access_token", "refresh_token", "authorization"];

export function redactSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...obj };
  for (const key of Object.keys(redacted)) {
    const lk = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lk.includes(s))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof redacted[key] === "object" && redacted[key] !== null && !Array.isArray(redacted[key])) {
      redacted[key] = redactSecrets(redacted[key] as Record<string, unknown>);
    }
  }
  return redacted;
}
