/**
 * Billing Hooks
 * 
 * React Query hooks for billing data and operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { 
  PlanDisplay, 
  BillingTier,
  CheckoutSession,
  BillingInvoice 
} from './types';

/**
 * Normalize a subscription plan name to BillingTier
 */
export function normalizeTierFromPlanName(planName: string | undefined | null): BillingTier | null {
  if (!planName) return null;
  
  const mapping: Record<string, BillingTier> = {
    trial: 'FREE_TRIAL',
    basic: 'BASIC',
    standard: 'PRO',
    unlimited: 'ENTERPRISE',
    // Also handle direct tier names
    free_trial: 'FREE_TRIAL',
    pro: 'PRO',
    enterprise: 'ENTERPRISE',
  };
  
  return mapping[planName.toLowerCase()] || null;
}

/**
 * Map BillingTier to subscription_plans.name
 */
export function tierToPlanName(tier: BillingTier): string {
  const mapping: Record<BillingTier, string> = {
    FREE_TRIAL: 'trial',
    BASIC: 'basic',
    PRO: 'standard',
    ENTERPRISE: 'unlimited',
  };
  return mapping[tier];
}

// Fetch public pricing data (no auth required)
export function usePricingData() {
  return useQuery({
    queryKey: ['billing', 'pricing'],
    queryFn: async (): Promise<PlanDisplay[]> => {
      // Fetch pricing config
      const { data: pricingData, error: pricingError } = await supabase
        .from('mrr_pricing_config')
        .select('*')
        .eq('is_active', true)
        .order('monthly_price_usd', { ascending: true });

      if (pricingError) throw pricingError;

      // Fetch plan limits
      const { data: limitsData, error: limitsError } = await supabase
        .from('plan_limits')
        .select('*');

      if (limitsError) throw limitsError;

      // Combine pricing and limits
      const plans: PlanDisplay[] = (pricingData || []).map((pricing) => {
        const limits = limitsData?.find((l) => l.tier === pricing.tier);
        const featuresArray = limits?.features;
        
        return {
          tier: pricing.tier as BillingTier,
          displayName: pricing.display_name || pricing.tier,
          description: pricing.description || '',
          monthlyPriceUsd: Number(pricing.monthly_price_usd) || 0,
          maxWorkItems: limits?.max_work_items ?? null,
          maxClients: limits?.max_clients ?? null,
          maxMembers: limits?.max_members ?? null,
          storageMb: limits?.storage_mb ?? null,
          features: Array.isArray(featuresArray) 
            ? featuresArray.filter((f): f is string => typeof f === 'string') 
            : [],
          isActive: pricing.is_active,
        };
      });

      return plans;
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}

// Fetch checkout sessions for an organization
export function useCheckoutSessions(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['billing', 'checkout-sessions', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      
      const { data, error } = await supabase
        .from('billing_checkout_sessions')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as CheckoutSession[];
    },
    enabled: !!organizationId,
  });
}

// Fetch invoices for an organization
export function useInvoices(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['billing', 'invoices', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      
      const { data, error } = await supabase
        .from('billing_invoices')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as BillingInvoice[];
    },
    enabled: !!organizationId,
  });
}

// Create checkout session mutation
export function useCreateCheckoutSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      organizationId, 
      tier 
    }: { 
      organizationId: string; 
      tier: BillingTier;
    }) => {
      const { data, error } = await supabase.functions.invoke('billing-create-checkout-session', {
        body: { organization_id: organizationId, tier },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || 'Failed to create checkout session');
      
      return data as { ok: true; session_id: string; checkout_url: string };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'checkout-sessions', variables.organizationId] });
      toast.success('Sesión de pago creada');
    },
    onError: (error: Error) => {
      toast.error(`Error: ${error.message}`);
    },
  });
}

// Complete mock checkout mutation
export function useCompleteMockCheckout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionId }: { sessionId: string }) => {
      const { data, error } = await supabase.functions.invoke('billing-complete-checkout', {
        body: { session_id: sessionId },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || 'Failed to complete checkout');
      
      return data as { ok: true; plan_id?: string; tier?: string };
    },
    onSuccess: () => {
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['subscription-plans'] });
      toast.success('¡Suscripción activada exitosamente!');
    },
    onError: (error: Error) => {
      toast.error(`Error: ${error.message}`);
    },
  });
}

// Create portal session mutation
export function useCreatePortalSession() {
  return useMutation({
    mutationFn: async ({ 
      organizationId, 
      returnUrl 
    }: { 
      organizationId: string; 
      returnUrl: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('billing-create-portal-session', {
        body: { organization_id: organizationId, return_url: returnUrl },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || 'Failed to create portal session');
      
      return data as { ok: true; portal_url: string };
    },
    onSuccess: (data) => {
      // In mock mode, show info toast
      if (data.portal_url?.includes('settings')) {
        toast.info('Portal de facturación (modo demo)');
      }
    },
    onError: (error: Error) => {
      toast.error(`Error: ${error.message}`);
    },
  });
}

/**
 * Get current organization's billing tier from subscription
 */
export function useCurrentTier() {
  return useQuery({
    queryKey: ['billing', 'current-tier'],
    queryFn: async (): Promise<{ tier: BillingTier | null; planName: string | null }> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { tier: null, planName: null };

      // Get user's organization
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!profile?.organization_id) return { tier: null, planName: null };

      // Get subscription with plan
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*, plan:subscription_plans(*)')
        .eq('organization_id', profile.organization_id)
        .single();

      if (!subscription?.plan) return { tier: null, planName: null };

      const planName = (subscription.plan as { name?: string })?.name || null;
      const tier = normalizeTierFromPlanName(planName);

      return { tier, planName };
    },
  });
}
