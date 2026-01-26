/**
 * Billing System Types
 * 
 * Type definitions for the billing provider abstraction layer
 */

export type BillingTier = 'FREE_TRIAL' | 'BASIC' | 'PRO' | 'ENTERPRISE';

export type CheckoutSessionStatus = 'PENDING' | 'COMPLETED' | 'CANCELED' | 'EXPIRED';

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';

export type BillingProvider = 'mock' | 'stripe' | 'wompi' | 'payu' | 'placetopay';

export interface PricingConfig {
  id: string;
  tier: BillingTier;
  monthly_price_usd: number;
  display_name: string | null;
  description: string | null;
  is_active: boolean;
}

export interface PlanLimits {
  id: string;
  tier: BillingTier;
  max_work_items: number | null;
  max_clients: number | null;
  max_members: number | null;
  storage_mb: number | null;
  features: string[];
}

export interface BillingCustomer {
  id: string;
  organization_id: string;
  provider: BillingProvider;
  provider_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckoutSession {
  id: string;
  organization_id: string;
  provider: BillingProvider;
  tier: BillingTier;
  status: CheckoutSessionStatus;
  provider_session_id: string | null;
  checkout_url: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface BillingInvoice {
  id: string;
  organization_id: string;
  provider: BillingProvider;
  provider_invoice_id: string | null;
  amount_usd: number | null;
  currency: string;
  status: InvoiceStatus;
  period_start: string | null;
  period_end: string | null;
  hosted_invoice_url: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

// Provider interface for billing operations
export interface CreateCheckoutSessionParams {
  organizationId: string;
  tier: BillingTier;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutSessionResult {
  url: string;
  sessionId: string;
}

export interface CreatePortalSessionParams {
  organizationId: string;
  returnUrl: string;
}

export interface CreatePortalSessionResult {
  url: string;
}

// Combined pricing display type
export interface PlanDisplay {
  tier: BillingTier;
  displayName: string;
  description: string;
  monthlyPriceUsd: number;
  maxWorkItems: number | null;
  maxClients: number | null;
  maxMembers: number | null;
  storageMb: number | null;
  features: string[];
  isActive: boolean;
}
