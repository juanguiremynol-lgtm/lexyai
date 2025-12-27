import { AlertTriangle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscriptionLimits } from '@/hooks/use-subscription-limits';
import { useNavigate } from 'react-router-dom';

export function UpgradeBanner() {
  const { isExpired, isTrialing, trialDaysRemaining, getUsageWarning } = useSubscriptionLimits();
  const navigate = useNavigate();

  const usageWarning = getUsageWarning();

  // Don't show if no issues
  if (!isExpired && !usageWarning && !(isTrialing && trialDaysRemaining <= 7)) {
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
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span>
          {isExpired
            ? 'Tu suscripción ha expirado. Actualiza tu plan para continuar usando ATENIA.'
            : isTrialing && trialDaysRemaining <= 7
            ? `Tu período de prueba termina en ${trialDaysRemaining} día${trialDaysRemaining > 1 ? 's' : ''}.`
            : usageWarning?.message
          }
        </span>
      </div>
      <Button
        size="sm"
        variant={isUrgent ? 'default' : 'outline'}
        onClick={() => navigate('/pricing')}
        className="flex-shrink-0"
      >
        <Zap className="h-3 w-3 mr-1" />
        {isExpired ? 'Reactivar' : 'Ver planes'}
      </Button>
    </div>
  );
}
