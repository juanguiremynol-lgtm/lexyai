import { useMemo } from 'react';
import { useSubscription } from '@/contexts/SubscriptionContext';

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

interface SubscriptionGate {
  canWrite: boolean;
  canRead: boolean;
  status: SubscriptionStatus;
  daysLeft: number;
  isTrialing: boolean;
  isExpired: boolean;
  isSuspended: boolean;
  isActive: boolean;
  statusMessage: string;
  bannerType: 'trial' | 'expired' | 'suspended' | 'active' | null;
}

/**
 * Hook to check subscription status and feature gating
 * Returns gate status for UI to enable/disable features
 */
export function useSubscriptionGate(): SubscriptionGate {
  const { subscription, isTrialing, isExpired, trialDaysRemaining, isActive } = useSubscription();

  return useMemo(() => {
    // Map subscription status to gate status
    let status: SubscriptionStatus = 'TRIAL';
    let canWrite = true;
    let canRead = true;
    let isSuspended = false;
    let statusMessage = '';
    let bannerType: SubscriptionGate['bannerType'] = null;

    if (!subscription) {
      // No subscription - treat as expired
      status = 'EXPIRED';
      canWrite = false;
      statusMessage = 'No tienes una suscripción activa.';
      bannerType = 'expired';
    } else if (subscription.status === 'canceled' || subscription.status === 'expired') {
      status = 'EXPIRED';
      canWrite = false;
      statusMessage = 'Tu suscripción ha expirado. Actualiza tu plan para continuar.';
      bannerType = 'expired';
    } else if (subscription.status === 'past_due') {
      // Past due - allow read but not write
      status = 'SUSPENDED';
      canWrite = false;
      isSuspended = true;
      statusMessage = 'Tu cuenta está suspendida por falta de pago.';
      bannerType = 'suspended';
    } else if (isTrialing) {
      status = 'TRIAL';
      
      if (trialDaysRemaining === 0) {
        // Trial just expired
        status = 'EXPIRED';
        canWrite = false;
        statusMessage = 'Tu período de prueba ha terminado.';
        bannerType = 'expired';
      } else if (trialDaysRemaining <= 7) {
        statusMessage = `Tu período de prueba termina en ${trialDaysRemaining} día${trialDaysRemaining > 1 ? 's' : ''}.`;
        bannerType = 'trial';
      } else {
        statusMessage = `${trialDaysRemaining} días de prueba restantes.`;
        bannerType = null; // Don't show banner if > 7 days
      }
    } else if (subscription.status === 'active') {
      status = 'ACTIVE';
      statusMessage = '';
      bannerType = null;
    }

    return {
      canWrite,
      canRead,
      status,
      daysLeft: trialDaysRemaining,
      isTrialing,
      isExpired: status === 'EXPIRED',
      isSuspended,
      isActive: status === 'ACTIVE' || (status === 'TRIAL' && trialDaysRemaining > 0),
      statusMessage,
      bannerType,
    };
  }, [subscription, isTrialing, isExpired, trialDaysRemaining]);
}

/**
 * Check if a specific action is allowed based on subscription
 */
export function useCanPerformAction(action: 'create' | 'update' | 'delete' | 'import'): boolean {
  const { canWrite } = useSubscriptionGate();
  
  // All write actions require canWrite
  if (['create', 'update', 'delete', 'import'].includes(action)) {
    return canWrite;
  }
  
  return true;
}
