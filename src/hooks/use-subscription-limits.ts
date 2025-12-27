import { useSubscription } from '@/contexts/SubscriptionContext';
import { toast } from 'sonner';

type EntityType = 'client' | 'filing' | 'process' | 'tutela' | 'peticion' | 'admin';

const ENTITY_LABELS: Record<EntityType, string> = {
  client: 'cliente',
  filing: 'proceso',
  process: 'proceso monitoreado',
  tutela: 'tutela',
  peticion: 'petición',
  admin: 'proceso administrativo',
};

export function useSubscriptionLimits() {
  const { usage, plan, isActive, isExpired, isTrialing, trialDaysRemaining } = useSubscription();

  const checkCanCreate = (entityType: EntityType): boolean => {
    if (isExpired) {
      toast.error('Tu suscripción ha expirado', {
        description: 'Actualiza tu plan para continuar usando ATENIA.',
      });
      return false;
    }

    if (!isActive) {
      toast.error('Suscripción inactiva', {
        description: 'Activa tu suscripción para crear nuevos registros.',
      });
      return false;
    }

    // Check if trial is about to expire
    if (isTrialing && trialDaysRemaining <= 3 && trialDaysRemaining > 0) {
      toast.warning(`Tu período de prueba termina en ${trialDaysRemaining} día${trialDaysRemaining > 1 ? 's' : ''}`, {
        description: 'Considera actualizar tu plan para no perder acceso.',
      });
    }

    // Client check
    if (entityType === 'client') {
      if (!usage.canAddClient) {
        toast.error('Límite de clientes alcanzado', {
          description: `Tu plan ${plan?.display_name || ''} permite hasta ${usage.maxClients} clientes. Actualiza tu plan para agregar más.`,
        });
        return false;
      }
      return true;
    }

    // Filing/process check (filings, tutelas, peticiones, procesos, admin)
    if (!usage.canAddFiling) {
      toast.error(`Límite de procesos alcanzado`, {
        description: `Tu plan ${plan?.display_name || ''} permite hasta ${usage.maxFilings} procesos. Actualiza tu plan para agregar más.`,
      });
      return false;
    }

    return true;
  };

  const getUsageWarning = (): { type: 'client' | 'filing' | null; percent: number; message: string } | null => {
    // Check if approaching limits (80% or more)
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
