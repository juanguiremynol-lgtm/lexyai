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
 * During beta, all users are TRIAL.
 */
export function useSubscriptionGate(): SubscriptionGate {
  const { subscription, isTrialing, isExpired, trialDaysRemaining, isActive } = useSubscription();

  return useMemo(() => {
    let status: SubscriptionStatus = 'TRIAL';
    let canWrite = true;
    let canRead = true;
    let isSuspended = false;
    let statusMessage = '';
    let bannerType: SubscriptionGate['bannerType'] = null;

    if (!subscription) {
      status = 'EXPIRED';
      canWrite = false;
      statusMessage = 'No tienes una suscripción activa.';
      bannerType = 'expired';
    } else if (subscription.status === 'canceled' || subscription.status === 'expired') {
      status = 'EXPIRED';
      canWrite = false;
      statusMessage = 'Tu período beta trial ha terminado. Contacta a soporte para continuar.';
      bannerType = 'expired';
    } else if (subscription.status === 'past_due') {
      status = 'SUSPENDED';
      canWrite = false;
      isSuspended = true;
      statusMessage = 'Tu cuenta está suspendida.';
      bannerType = 'suspended';
    } else if (isTrialing) {
      status = 'TRIAL';
      
      if (trialDaysRemaining === 0) {
        status = 'EXPIRED';
        canWrite = false;
        statusMessage = 'Tu período beta trial ha terminado.';
        bannerType = 'expired';
      } else if (trialDaysRemaining <= 14) {
        statusMessage = `Tu beta trial termina en ${trialDaysRemaining} día${trialDaysRemaining > 1 ? 's' : ''}.`;
        bannerType = 'trial';
      } else {
        statusMessage = `${trialDaysRemaining} días de beta trial restantes.`;
        bannerType = null;
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
  
  if (['create', 'update', 'delete', 'import'].includes(action)) {
    return canWrite;
  }
  
  return true;
}
