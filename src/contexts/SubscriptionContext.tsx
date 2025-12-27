import React, { createContext, useContext, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './OrganizationContext';
import type { Subscription, SubscriptionPlan, UsageLimits } from '@/lib/subscription-constants';

interface SubscriptionContextType {
  subscription: Subscription | null;
  plan: SubscriptionPlan | null;
  plans: SubscriptionPlan[];
  usage: UsageLimits;
  isLoading: boolean;
  isTrialing: boolean;
  isActive: boolean;
  isExpired: boolean;
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
  plan: null,
  plans: [],
  usage: defaultUsage,
  isLoading: true,
  isTrialing: false,
  isActive: false,
  isExpired: false,
  trialDaysRemaining: 0,
  refetch: () => {},
});

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { organization } = useOrganization();

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

  // Fetch subscription
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
  });

  // Fetch usage counts
  const { data: usageCounts, isLoading: usageLoading } = useQuery({
    queryKey: ['usage-counts', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return { clients: 0, filings: 0 };

      // Count clients
      const { count: clientCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact', head: true });

      // Count filings (all types: CGP, tutelas, peticiones, admin)
      const { count: filingCount } = await supabase
        .from('filings')
        .select('*', { count: 'exact', head: true });

      // Count monitored processes
      const { count: processCount } = await supabase
        .from('monitored_processes')
        .select('*', { count: 'exact', head: true });

      return {
        clients: clientCount || 0,
        filings: (filingCount || 0) + (processCount || 0),
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

  const isTrialing = subscription?.status === 'trialing';
  const isActive = subscription?.status === 'active' || isTrialing;
  const isExpired = subscription?.status === 'expired' || 
    (isTrialing && trialDaysRemaining === 0);

  return (
    <SubscriptionContext.Provider
      value={{
        subscription: subscription || null,
        plan,
        plans,
        usage,
        isLoading: subLoading || usageLoading,
        isTrialing,
        isActive,
        isExpired,
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
