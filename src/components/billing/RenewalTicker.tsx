/**
 * RenewalTicker — Fixed top/bottom banners for payment renewal urgency
 * 
 * Shows contextual banners based on billing urgency:
 * - Pre-due (1-5 days): single top ticker
 * - Due today: top + bottom tickers
 * - Grace period: top + bottom tickers (red)
 * - Suspended: top + bottom tickers (blocked)
 */

import { AlertTriangle, Clock, CreditCard, XCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRenewalStatus, type RenewalUrgency } from '@/hooks/use-renewal-status';
import { useCreateCheckoutSessionV2 } from '@/lib/billing/hooks';
import { useOrganization } from '@/contexts/OrganizationContext';
import { cn } from '@/lib/utils';
import type { PlanCode } from '@/types/billing';

const URGENCY_STYLES: Record<RenewalUrgency, string> = {
  none: '',
  pre_due: 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-100 border-b border-amber-200 dark:border-amber-800',
  due_today: 'bg-orange-50 dark:bg-orange-950/50 text-orange-900 dark:text-orange-100 border-b border-orange-200 dark:border-orange-800',
  grace_period: 'bg-destructive/10 text-destructive border-b border-destructive/20',
  suspended: 'bg-destructive/15 text-destructive border-b border-destructive/30',
};

const URGENCY_ICONS: Record<RenewalUrgency, typeof Clock> = {
  none: Clock,
  pre_due: Clock,
  due_today: AlertTriangle,
  grace_period: AlertTriangle,
  suspended: XCircle,
};

function TickerBar({ 
  position, 
  message, 
  urgency, 
  canPay, 
  isMemberOnly,
  onPayNow,
  isLoading,
}: {
  position: 'top' | 'bottom';
  message: string;
  urgency: RenewalUrgency;
  canPay: boolean;
  isMemberOnly: boolean;
  onPayNow: () => void;
  isLoading: boolean;
}) {
  const Icon = URGENCY_ICONS[urgency];
  const isBottom = position === 'bottom';

  return (
    <div className={cn(
      'flex items-center justify-between gap-4 px-4 py-2.5 text-sm',
      URGENCY_STYLES[urgency],
      isBottom && 'fixed bottom-0 left-0 right-0 z-50 border-t border-b-0'
    )}>
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{message}</span>
      </div>
      <div className="flex-shrink-0">
        {canPay ? (
          <Button
            size="sm"
            variant={urgency === 'suspended' || urgency === 'grace_period' ? 'default' : 'outline'}
            onClick={onPayNow}
            disabled={isLoading}
            className="gap-1.5"
          >
            <CreditCard className="h-3.5 w-3.5" />
            {isLoading ? 'Creando...' : 'Pagar Ahora'}
          </Button>
        ) : isMemberOnly ? (
          <div className="flex items-center gap-1.5 text-xs opacity-75">
            <Info className="h-3.5 w-3.5" />
            <span>Contacta al admin</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RenewalTickerTop() {
  const status = useRenewalStatus();
  const createCheckout = useCreateCheckoutSessionV2();
  const { organization } = useOrganization();

  if (!status.showTopTicker || status.urgency === 'none') return null;

  const message = status.isMemberOnly ? status.tickerMessageMember : status.tickerMessage;

  const handlePayNow = () => {
    if (!organization?.id || !status.planCode) return;
    createCheckout.mutate({
      organizationId: organization.id,
      planCode: status.planCode as PlanCode,
      billingCycleMonths: status.billingCycleMonths as 1 | 24,
    });
  };

  return (
    <TickerBar
      position="top"
      message={message}
      urgency={status.urgency}
      canPay={status.canPay}
      isMemberOnly={status.isMemberOnly}
      onPayNow={handlePayNow}
      isLoading={createCheckout.isPending}
    />
  );
}

export function RenewalTickerBottom() {
  const status = useRenewalStatus();
  const createCheckout = useCreateCheckoutSessionV2();
  const { organization } = useOrganization();

  if (!status.showBottomTicker || status.urgency === 'none') return null;

  const message = status.isMemberOnly ? status.tickerMessageMember : status.tickerMessage;

  const handlePayNow = () => {
    if (!organization?.id || !status.planCode) return;
    createCheckout.mutate({
      organizationId: organization.id,
      planCode: status.planCode as PlanCode,
      billingCycleMonths: status.billingCycleMonths as 1 | 24,
    });
  };

  return (
    <TickerBar
      position="bottom"
      message={message}
      urgency={status.urgency}
      canPay={status.canPay}
      isMemberOnly={status.isMemberOnly}
      onPayNow={handlePayNow}
      isLoading={createCheckout.isPending}
    />
  );
}
