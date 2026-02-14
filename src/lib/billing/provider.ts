/**
 * Billing Provider Abstraction
 * 
 * Provider-neutral interface for billing operations.
 * Allows swapping payment gateway providers without changing UI/business logic.
 */

import type {
  BillingProvider,
  BillingTier,
  CreateCheckoutSessionParams,
  CreateCheckoutSessionResult,
  CreatePortalSessionParams,
  CreatePortalSessionResult,
} from './types';

// Get configured billing provider from environment
export function getBillingProvider(): BillingProvider {
  const provider = import.meta.env.VITE_BILLING_PROVIDER || 'mock';
  return provider as BillingProvider;
}

// Provider interface that all implementations must follow
export interface IBillingProvider {
  getProviderName(): BillingProvider;
  
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CreateCheckoutSessionResult>;
  
  createBillingPortalSession(params: CreatePortalSessionParams): Promise<CreatePortalSessionResult>;
  
  // For future webhook handling
  syncSubscriptionFromProviderEvent(payload: unknown): Promise<void>;
}

// Mock provider implementation (default)
class MockBillingProvider implements IBillingProvider {
  getProviderName(): BillingProvider {
    return 'mock';
  }

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CreateCheckoutSessionResult> {
    // Generate a mock session ID
    const sessionId = `mock_session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Return a mock checkout URL that will be handled by the app
    const url = `/billing/checkout/mock?session=${sessionId}&tier=${params.tier}&org=${params.organizationId}`;
    
    return { url, sessionId };
  }

  async createBillingPortalSession(params: CreatePortalSessionParams): Promise<CreatePortalSessionResult> {
    // Return a mock portal URL
    const url = `/billing/portal/mock?org=${params.organizationId}&return=${encodeURIComponent(params.returnUrl)}`;
    
    return { url };
  }

  async syncSubscriptionFromProviderEvent(_payload: unknown): Promise<void> {
    // Mock implementation - no-op
    console.log('[MockBillingProvider] syncSubscriptionFromProviderEvent called (no-op in mock mode)');
  }
}

// Provider factory
let providerInstance: IBillingProvider | null = null;

export function getBillingProviderInstance(): IBillingProvider {
  if (!providerInstance) {
    const providerName = getBillingProvider();
    
    switch (providerName) {
      case 'mock':
      default:
        providerInstance = new MockBillingProvider();
        break;
      // Active providers are configured via platform_gateway_config.
      // When a real provider is activated, the billing edge functions
      // read credentials from platform_gateway_config and route accordingly.
      // The frontend factory always uses 'mock' for local operations;
      // actual payment processing happens server-side via edge functions.
    }
  }
  
  return providerInstance;
}

// Reset provider instance (useful when active gateway changes)
export function resetBillingProviderInstance(): void {
  providerInstance = null;
}

// Convenience exports
export const billingProvider = {
  getProviderName: () => getBillingProviderInstance().getProviderName(),
  createCheckoutSession: (params: CreateCheckoutSessionParams) => 
    getBillingProviderInstance().createCheckoutSession(params),
  createBillingPortalSession: (params: CreatePortalSessionParams) => 
    getBillingProviderInstance().createBillingPortalSession(params),
  syncSubscriptionFromProviderEvent: (payload: unknown) => 
    getBillingProviderInstance().syncSubscriptionFromProviderEvent(payload),
};
