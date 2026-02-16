import { AlertTriangle, Calendar } from 'lucide-react';
import { useSubscriptionLimits } from '@/hooks/use-subscription-limits';

export function UpgradeBanner() {
  const { isExpired, isTrialing, trialDaysRemaining, getUsageWarning } = useSubscriptionLimits();

  const usageWarning = getUsageWarning();

  // Don't show if no issues
  if (!isExpired && !usageWarning && !(isTrialing && trialDaysRemaining <= 14)) {
    return null;
  }

  const isUrgent = isExpired || (isTrialing && trialDaysRemaining <= 3);

  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-2 text-sm ${
      isUrgent 
        ? 'bg-destructive/10 text-destructive border-b border-destructive/20' 
        : 'bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200 border-b border-yellow-200 dark:border-yellow-800'
    }`}>
      <div className="flex items-center gap-2">
        {isUrgent ? <AlertTriangle className="h-4 w-4 flex-shrink-0" /> : <Calendar className="h-4 w-4 flex-shrink-0" />}
        <span>
          {isExpired
            ? 'Tu período beta trial ha terminado. Contacta a soporte para continuar.'
            : isTrialing && trialDaysRemaining <= 14
            ? `Tu beta trial termina en ${trialDaysRemaining} día${trialDaysRemaining > 1 ? 's' : ''}.`
            : usageWarning?.message
          }
        </span>
      </div>
    </div>
  );
}
