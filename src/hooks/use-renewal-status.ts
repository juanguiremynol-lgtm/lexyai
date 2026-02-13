/**
 * Billing Renewal Status Hook
 *
 * Uses the shared computeBillingState pure function + billingClock for time-travel.
 */

import { useMemo } from 'react';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { usePlatformAdmin } from '@/hooks/use-platform-admin';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  computeBillingState,
  buildTickerMessages,
  type RenewalUrgency as CoreUrgency,
} from '@/lib/billing/billing-state-machine';
import { billingClock } from '@/lib/billing/billing-clock';

// Re-export with legacy name mapping
export type RenewalUrgency = 'none' | 'pre_due' | 'due_today' | 'grace_period' | 'suspended';

export interface RenewalStatus {
  urgency: RenewalUrgency;
  daysUntilDue: number;
  daysOverdue: number;
  graceDaysRemaining: number;
  nextPaymentDueAt: Date | null;
  amountCop: number;
  planCode: string | null;
  billingCycleMonths: number;
  canPay: boolean;
  showTicker: boolean;
  showTopTicker: boolean;
  showBottomTicker: boolean;
  showPaywall: boolean;
  isOrgAdmin: boolean;
  isMemberOnly: boolean;
  tickerMessage: string;
  tickerMessageMember: string;
}

function mapUrgency(core: CoreUrgency): RenewalUrgency {
  if (core === 'grace') return 'grace_period';
  return core as RenewalUrgency;
}

export function useRenewalStatus(): RenewalStatus {
  const { subscription, billingSubscription, isSuspended } = useSubscription();
  const { isPlatformAdmin } = usePlatformAdmin();
  const { organization } = useOrganization();

  const { data: membershipRole } = useQuery({
    queryKey: ['org-membership-role', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return null;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('organization_memberships')
        .select('role')
        .eq('organization_id', organization.id)
        .eq('user_id', user.id)
        .maybeSingle();
      return data?.role as string | null;
    },
    enabled: !!organization?.id,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const isOrgAdmin = membershipRole === 'OWNER' || membershipRole === 'ADMIN';
    const isMemberOnly = !!membershipRole && !isOrgAdmin;

    const defaults: RenewalStatus = {
      urgency: 'none', daysUntilDue: 999, daysOverdue: 0, graceDaysRemaining: 2,
      nextPaymentDueAt: null, amountCop: billingSubscription?.current_price_cop_incl_iva || 0,
      planCode: billingSubscription?.plan_code || null,
      billingCycleMonths: billingSubscription?.billing_cycle_months || 1,
      canPay: false, showTicker: false, showTopTicker: false, showBottomTicker: false,
      showPaywall: false, isOrgAdmin, isMemberOnly, tickerMessage: '', tickerMessageMember: '',
    };

    if (isPlatformAdmin) return defaults;

    const now = billingClock.now();
    const computed = computeBillingState({
      currentPeriodEnd: billingSubscription?.current_period_end || subscription?.current_period_end || null,
      trialEndAt: billingSubscription?.trial_end_at || subscription?.trial_ends_at || null,
      compedUntilAt: billingSubscription?.comped_until_at || null,
      status: billingSubscription?.status || (isSuspended ? 'SUSPENDED' : null),
      suspendedAt: billingSubscription?.suspended_at || null,
    }, now);

    const urgency = mapUrgency(computed.urgency);
    const canPay = isOrgAdmin || !isMemberOnly;
    const msgs = buildTickerMessages(computed.urgency, computed.daysUntilDue, computed.graceDaysRemaining);

    return {
      urgency, daysUntilDue: computed.daysUntilDue, daysOverdue: computed.daysOverdue,
      graceDaysRemaining: computed.graceDaysRemaining, nextPaymentDueAt: computed.dueDate,
      amountCop: billingSubscription?.current_price_cop_incl_iva || 0,
      planCode: billingSubscription?.plan_code || null,
      billingCycleMonths: billingSubscription?.billing_cycle_months || 1,
      canPay, showTicker: computed.showTopTicker, showTopTicker: computed.showTopTicker,
      showBottomTicker: computed.showBottomTicker, showPaywall: computed.showPaywall,
      isOrgAdmin, isMemberOnly, tickerMessage: msgs.admin, tickerMessageMember: msgs.member,
    };
  }, [subscription, billingSubscription, isPlatformAdmin, membershipRole, isSuspended]);
}
