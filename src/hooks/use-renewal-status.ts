/**
 * Billing Renewal Status Hook
 * 
 * Computes renewal urgency, ticker visibility, and role-based gating
 * for the "Pay & Play" embedded payment flow.
 */

import { useMemo } from 'react';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { usePlatformAdmin } from '@/hooks/use-platform-admin';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type RenewalUrgency = 
  | 'none'           // Active, due date > 5 days away
  | 'pre_due'        // 1-5 days before due date
  | 'due_today'      // Due date is today
  | 'grace_period'   // Past due, within grace (2 days)
  | 'suspended';     // Beyond grace period

export interface RenewalStatus {
  urgency: RenewalUrgency;
  daysUntilDue: number;
  daysOverdue: number;
  graceDaysRemaining: number;
  nextPaymentDueAt: Date | null;
  amountCop: number;
  planCode: string | null;
  billingCycleMonths: number;
  // Role-based visibility
  canPay: boolean;         // Only org admins / individual users
  showTicker: boolean;     // false for super admins
  showTopTicker: boolean;
  showBottomTicker: boolean;
  showPaywall: boolean;    // Only when suspended
  isOrgAdmin: boolean;
  isMemberOnly: boolean;   // Org member who can't pay
  // Display
  tickerMessage: string;
  tickerMessageMember: string; // For non-admin org members
}

const PRE_DUE_NOTICE_DAYS = 5;
const GRACE_PERIOD_DAYS = 2;

export function useRenewalStatus(): RenewalStatus {
  const { subscription, billingSubscription, isActive, isPastDue, isSuspended } = useSubscription();
  const { isPlatformAdmin } = usePlatformAdmin();
  const { organization } = useOrganization();

  // Fetch org membership role for current user
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

    // Default safe state
    const defaults: RenewalStatus = {
      urgency: 'none',
      daysUntilDue: 999,
      daysOverdue: 0,
      graceDaysRemaining: GRACE_PERIOD_DAYS,
      nextPaymentDueAt: null,
      amountCop: billingSubscription?.current_price_cop_incl_iva || 0,
      planCode: billingSubscription?.plan_code || null,
      billingCycleMonths: billingSubscription?.billing_cycle_months || 1,
      canPay: false,
      showTicker: false,
      showTopTicker: false,
      showBottomTicker: false,
      showPaywall: false,
      isOrgAdmin,
      isMemberOnly,
      tickerMessage: '',
      tickerMessageMember: '',
    };

    // Super admins never see tickers or paywalls
    if (isPlatformAdmin) return defaults;

    // Determine due date from billing_subscription_state or legacy subscription
    const dueDateStr = billingSubscription?.current_period_end 
      || subscription?.current_period_end 
      || subscription?.trial_ends_at;
    
    if (!dueDateStr) return defaults;

    const dueDate = new Date(dueDateStr);
    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    const daysUntilDue = Math.max(0, diffDays);
    const daysOverdue = Math.max(0, -diffDays);
    const graceDaysRemaining = Math.max(0, GRACE_PERIOD_DAYS - daysOverdue);

    // Determine urgency
    let urgency: RenewalUrgency = 'none';
    if (isSuspended || (daysOverdue > GRACE_PERIOD_DAYS)) {
      urgency = 'suspended';
    } else if (daysOverdue > 0) {
      urgency = 'grace_period';
    } else if (diffDays === 0) {
      urgency = 'due_today';
    } else if (diffDays > 0 && diffDays <= PRE_DUE_NOTICE_DAYS) {
      urgency = 'pre_due';
    }

    // Ticker visibility
    const showTicker = urgency !== 'none';
    const showTopTicker = showTicker;
    const showBottomTicker = urgency === 'due_today' || urgency === 'grace_period' || urgency === 'suspended';
    const showPaywall = urgency === 'suspended';

    // Can pay: org admin or individual (no org). Members can't pay.
    const canPay = isOrgAdmin || !isMemberOnly;

    // Messages
    let tickerMessage = '';
    let tickerMessageMember = '';

    switch (urgency) {
      case 'pre_due':
        tickerMessage = `Tu renovación vence en ${daysUntilDue} día${daysUntilDue > 1 ? 's' : ''}. Paga ahora para evitar interrupciones.`;
        tickerMessageMember = `La renovación de la cuenta vence en ${daysUntilDue} día${daysUntilDue > 1 ? 's' : ''}. Contacta al administrador de tu organización.`;
        break;
      case 'due_today':
        tickerMessage = 'El pago vence hoy. El servicio se suspenderá en 2 días si no se realiza el pago.';
        tickerMessageMember = 'El pago de la cuenta vence hoy. Contacta al administrador de tu organización.';
        break;
      case 'grace_period':
        tickerMessage = `Pago vencido. El período de gracia termina en ${graceDaysRemaining} día${graceDaysRemaining > 1 ? 's' : ''}. Paga ahora para mantener el acceso.`;
        tickerMessageMember = `Pago de la cuenta vencido. Contacta al administrador de tu organización.`;
        break;
      case 'suspended':
        tickerMessage = 'Tu cuenta está suspendida por falta de pago. Paga ahora para reactivar el servicio.';
        tickerMessageMember = 'La cuenta está suspendida. Contacta al administrador de tu organización.';
        break;
    }

    return {
      urgency,
      daysUntilDue,
      daysOverdue,
      graceDaysRemaining,
      nextPaymentDueAt: dueDate,
      amountCop: billingSubscription?.current_price_cop_incl_iva || 0,
      planCode: billingSubscription?.plan_code || null,
      billingCycleMonths: billingSubscription?.billing_cycle_months || 1,
      canPay,
      showTicker,
      showTopTicker,
      showBottomTicker,
      showPaywall,
      isOrgAdmin,
      isMemberOnly,
      tickerMessage,
      tickerMessageMember,
    };
  }, [subscription, billingSubscription, isPlatformAdmin, membershipRole, isSuspended]);
}
