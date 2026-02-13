/**
 * BetaTrialBanner — Dismissible banner showing beta trial status + messaging.
 * 
 * Shows:
 * - Trial end date
 * - Beta disclaimer
 * - Email alerts not yet available
 */

import { useState } from 'react';
import { X, Sparkles, AlertCircle, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { usePlatformAdmin } from '@/hooks/use-platform-admin';
import {
  BETA_DISCOUNT_MONTHLY_PERCENT,
  BETA_DISCOUNT_ANNUAL_PERCENT,
} from '@/lib/billing/pricing-windows';

export function BetaTrialBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('beta-trial-banner-dismissed') === 'true';
    } catch {
      return false;
    }
  });

  const { isTrialing, trialDaysRemaining, billingSubscription } = useSubscription();
  const { isPlatformAdmin } = usePlatformAdmin();

  if (dismissed || isPlatformAdmin || !isTrialing) return null;

  const trialEndDate = billingSubscription?.trial_end_at
    ? new Date(billingSubscription.trial_end_at).toLocaleDateString('es-CO', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('beta-trial-banner-dismissed', 'true');
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative bg-primary/5 border border-primary/20 rounded-lg p-4 mx-4 mt-4">
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-6 w-6 p-0"
        onClick={handleDismiss}
      >
        <X className="h-3.5 w-3.5" />
      </Button>

      <div className="space-y-3 pr-6">
        {/* Trial info */}
        <div className="flex items-start gap-2.5">
          <Sparkles className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-sm">
              Prueba beta gratuita de 3 meses
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {trialEndDate
                ? `Tu facturación comienza el ${trialEndDate}.`
                : `Te quedan ${trialDaysRemaining} días de prueba.`
              }
              {' '}Después: {BETA_DISCOUNT_MONTHLY_PERCENT}% off mensual, {BETA_DISCOUNT_ANNUAL_PERCENT}% off anual.
            </p>
          </div>
        </div>

        {/* Beta disclaimer */}
        <div className="flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Estamos en beta. Pueden ocurrir errores menores; estamos solucionándolos activamente.
          </p>
        </div>

        {/* Email notice */}
        <div className="flex items-start gap-2.5">
          <Mail className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Las alertas por correo electrónico aún no están habilitadas. Se añadirán próximamente.
          </p>
        </div>
      </div>
    </div>
  );
}
