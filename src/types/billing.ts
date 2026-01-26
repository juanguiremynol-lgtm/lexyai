/**
 * Billing Types - Canonical type definitions for the billing system
 */

// Plan codes supported by the system
export type PlanCode = "BASIC" | "PRO" | "ENTERPRISE";

// Legacy tier mapping (for backward compatibility with existing code)
export type BillingTier = "FREE_TRIAL" | "BASIC" | "PRO" | "ENTERPRISE";

// Billing cycle options
export type BillingCycleMonths = 1 | 24;

// Price type discriminator
export type PriceType = "INTRO" | "REGULAR";

// Account type for organization
export type AccountType = "INDIVIDUAL" | "FIRM";

// Checkout session status
export type CheckoutSessionStatus = "PENDING" | "COMPLETED" | "CANCELED" | "EXPIRED";

// Invoice status
export type InvoiceStatus = "DRAFT" | "OPEN" | "PAID" | "VOID" | "UNCOLLECTIBLE";

// Billing plan from DB
export interface BillingPlan {
  id: string;
  code: PlanCode;
  display_name: string;
  is_enterprise: boolean;
  max_members: number;
  created_at: string;
}

// Price point from DB
export interface BillingPricePoint {
  id: string;
  plan_id: string;
  currency: string;
  price_cop_incl_iva: number;
  billing_cycle_months: BillingCycleMonths;
  price_type: PriceType;
  valid_from: string;
  valid_to: string | null;
  promo_requires_commit_24m: boolean;
  price_lock_months: number;
  created_at: string;
}

// Subscription state from DB
export interface BillingSubscriptionState {
  organization_id: string;
  plan_code: PlanCode | string;
  billing_cycle_months: BillingCycleMonths;
  currency: string;
  current_price_cop_incl_iva: number;
  intro_offer_applied: boolean;
  price_lock_end_at: string | null;
  trial_end_at: string | null;
  created_at: string;
  updated_at: string;
}

// Checkout session from DB
export interface BillingCheckoutSession {
  id: string;
  organization_id: string;
  provider: string;
  tier: string;
  status: CheckoutSessionStatus;
  provider_session_id: string | null;
  checkout_url: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  billing_cycle_months: BillingCycleMonths;
  price_point_id: string | null;
  amount_cop_incl_iva: number | null;
  metadata: Record<string, unknown>;
}

// Invoice from DB
export interface BillingInvoice {
  id: string;
  organization_id: string;
  provider: string;
  provider_invoice_id: string | null;
  amount_usd: number | null;
  amount_cop_incl_iva: number | null;
  currency: string;
  status: InvoiceStatus;
  period_start: string | null;
  period_end: string | null;
  hosted_invoice_url: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

// Combined plan with price points for UI display
export interface BillingPlanWithPrices {
  plan: BillingPlan;
  regularPrice: BillingPricePoint | null;
  introPrice: BillingPricePoint | null;
}

// Checkout request params
export interface CreateCheckoutParams {
  organizationId: string;
  planCode: PlanCode;
  billingCycleMonths: BillingCycleMonths;
}

// Checkout response
export interface CreateCheckoutResult {
  ok: boolean;
  session_id?: string;
  checkout_url?: string;
  error?: string;
  code?: string;
  hint?: string;
}

// Grace enrollment request
export interface GraceEnrollParams {
  organizationId: string;
  accountType: AccountType;
}

// Grace enrollment response
export interface GraceEnrollResult {
  ok: boolean;
  trial_end_at?: string;
  error?: string;
  code?: string;
  hint?: string;
}
