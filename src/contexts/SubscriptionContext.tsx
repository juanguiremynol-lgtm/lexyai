import React, { createContext, useContext, useEffect, useCallback, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './OrganizationContext';
import type { Subscription, SubscriptionPlan, UsageLimits } from '@/lib/subscription-constants';

type SubscriptionStatus = 'PENDING_PAYMENT' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED' | 'CHURNED';

interface SubscriptionContextType {
  subscription: Subscription | null;
  billingSubscription: any | null;  // billing_subscription_state
  plan: SubscriptionPlan | null;
  plans: SubscriptionPlan[];
  usage: UsageLimits;
  isLoading: boolean;
  status: SubscriptionStatus | null;
  isTrialing: boolean;
  isActive: boolean;
  isExpired: boolean;
  isPastDue: boolean;
  isSuspended: boolean;
  trialDaysRemaining: number;
  refetch: () => void;
}

const defaultUsage: UsageLimits = {
  maxClients: 0,
  maxFilings: 0,
  currentClients: 0,
  currentFilings: 0,
  canAddClient: false,
  canAddFiling: false,
  clientsRemaining: 0,
  filingsRemaining: 0,
  usagePercentClients: 0,
  usagePercentFilings: 0,
};

const SubscriptionContext = createContext<SubscriptionContextType>({
  subscription: null,
  billingSubscription: null,
  plan: null,
  plans: [],
  usage: defaultUsage,
  isLoading: true,
  status: null,
  isTrialing: false,
  isActive: false,
  isExpired: false,
  isPastDue: false,
  isSuspended: false,
  trialDaysRemaining: 0,
  refetch: () => {},
});

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();

  // Fetch all plans
  const { data: plans = [] } = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('active', true)
        .order('price_cop', { ascending: true });

      if (error) throw error;
      return (data || []).map(p => ({
        ...p,
        features: Array.isArray(p.features) ? p.features : [],
      })) as SubscriptionPlan[];
    },
  });

  // Fetch subscription from legacy table
  const { data: subscription, isLoading: subLoading, refetch } = useQuery({
    queryKey: ['subscription', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return null;

      const { data, error } = await supabase
        .from('subscriptions')
        .select('*, plan:subscription_plans(*)')
        .eq('organization_id', organization.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // No subscription found
        throw error;
      }

      return data as Subscription & { plan: SubscriptionPlan };
    },
    enabled: !!organization?.id,
    refetchOnWindowFocus: false,
  });

  // Fetch billing subscription state (new table)
  const { data: billingSubscription, isLoading: billingLoading } = useQuery({
    queryKey: ['billing-subscription', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return null;

      const { data, error } = await supabase
        .from('billing_subscription_state')
        .select('*')
        .eq('organization_id', organization.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
      }

      return data;
    },
    enabled: !!organization?.id,
    refetchOnWindowFocus: false,
  });

  // Fetch usage counts - now uses work_items only
  const { data: usageCounts, isLoading: usageLoading } = useQuery({
    queryKey: ['usage-counts', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return { clients: 0, filings: 0 };

      // Count clients
      const { count: clientCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });

      // Count work_items (all judicial/legal items are now in work_items)
      const { count: workItemCount } = await supabase
        .from('work_items')
        .select('*', { count: 'exact', head: true });

      return {
        clients: clientCount || 0,
        filings: workItemCount || 0,
      };
    },
    enabled: !!organization?.id,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const plan = subscription?.plan || null;

  // Calculate usage limits
  const usage: UsageLimits = React.useMemo(() => {
    const maxClients = plan?.max_clients ?? null;
    const maxFilings = plan?.max_filings ?? null;
    const currentClients = usageCounts?.clients ?? 0;
    const currentFilings = usageCounts?.filings ?? 0;

    const clientsRemaining = maxClients === null ? null : Math.max(0, maxClients - currentClients);
    const filingsRemaining = maxFilings === null ? null : Math.max(0, maxFilings - currentFilings);

    return {
      maxClients,
      maxFilings,
      currentClients,
      currentFilings,
      canAddClient: maxClients === null || currentClients < maxClients,
      canAddFiling: maxFilings === null || currentFilings < maxFilings,
      clientsRemaining,
      filingsRemaining,
      usagePercentClients: maxClients ? Math.min(100, (currentClients / maxClients) * 100) : 0,
      usagePercentFilings: maxFilings ? Math.min(100, (currentFilings / maxFilings) * 100) : 0,
    };
  }, [plan, usageCounts]);

  // Calculate trial days remaining
  const trialDaysRemaining = React.useMemo(() => {
    if (!subscription?.trial_ends_at) return 0;
    const end = new Date(subscription.trial_ends_at);
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  }, [subscription?.trial_ends_at]);

  // Determine subscription status from billing state (new) or legacy subscription
  const status: SubscriptionStatus | null = billingSubscription?.status as SubscriptionStatus || null;
  const isTrialing = status === 'TRIAL' || subscription?.status === 'trialing';
  const isActive = status === 'ACTIVE' || status === 'TRIAL' || subscription?.status === 'active';
  const isPastDue = status === 'PAST_DUE';
  const isSuspended = status === 'SUSPENDED';
  const isExpired = status === 'EXPIRED' || status === 'CHURNED' || subscription?.status === 'expired';

  // ── Real-time listener for instant UI refresh after payment ──
  useEffect(() => {
    if (!organization?.id) return;

    const channel = supabase
      .channel(`billing-state-${organization.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'billing_subscription_state',
          filter: `organization_id=eq.${organization.id}`,
        },
        () => {
          // Invalidate both subscription queries for instant refresh
          queryClient.invalidateQueries({ queryKey: ['billing-subscription', organization.id] });
          queryClient.invalidateQueries({ queryKey: ['subscription', organization.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organization?.id, queryClient]);

  return (
    <SubscriptionContext.Provider
      value={{
        subscription: subscription || null,
        billingSubscription: billingSubscription || null,
        plan,
        plans,
        usage,
        isLoading: subLoading || billingLoading,
        status,
        isTrialing,
        isActive,
        isExpired,
        isPastDue,
        isSuspended,
        trialDaysRemaining,
        refetch,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
