import { useSubscription } from '@/contexts/SubscriptionContext';
import { toast } from 'sonner';

type EntityType = 'client' | 'filing' | 'process' | 'tutela' | 'peticion' | 'admin';

export function useSubscriptionLimits() {
  const { usage, plan, isActive, isExpired, isTrialing, trialDaysRemaining } = useSubscription();

  const checkCanCreate = (entityType: EntityType): boolean => {
    if (isExpired) {
      toast.error('Tu beta trial ha expirado', {
        description: 'Contacta a soporte para continuar usando ATENIA.',
      });
      return false;
    }

    if (!isActive) {
      toast.error('Suscripción inactiva', {
        description: 'Tu beta trial no está activo.',
      });
      return false;
    }

    if (isTrialing && trialDaysRemaining <= 3 && trialDaysRemaining > 0) {
      toast.warning(`Tu beta trial termina en ${trialDaysRemaining} día${trialDaysRemaining > 1 ? 's' : ''}`, {
        description: 'Los planes pagos se anunciarán próximamente.',
      });
    }

    // Client check
    if (entityType === 'client') {
      if (!usage.canAddClient) {
        toast.error('Límite de clientes alcanzado', {
          description: `El beta trial permite hasta ${usage.maxClients} clientes.`,
        });
        return false;
      }
      return true;
    }

    // Filing/process check
    if (!usage.canAddFiling) {
      toast.error('Límite de procesos alcanzado', {
        description: `El beta trial permite hasta ${usage.maxFilings} procesos.`,
      });
      return false;
    }

    return true;
  };

  const getUsageWarning = (): { type: 'client' | 'filing' | null; percent: number; message: string } | null => {
    if (usage.maxClients && usage.usagePercentClients >= 80) {
      return {
        type: 'client',
        percent: usage.usagePercentClients,
        message: `Has usado ${usage.currentClients} de ${usage.maxClients} clientes (${Math.round(usage.usagePercentClients)}%)`,
      };
    }

    if (usage.maxFilings && usage.usagePercentFilings >= 80) {
      return {
        type: 'filing',
        percent: usage.usagePercentFilings,
        message: `Has usado ${usage.currentFilings} de ${usage.maxFilings} procesos (${Math.round(usage.usagePercentFilings)}%)`,
      };
    }

    return null;
  };

  return {
    checkCanCreate,
    getUsageWarning,
    usage,
    plan,
    isActive,
    isExpired,
    isTrialing,
    trialDaysRemaining,
  };
}
