import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PricingCards } from './PricingCard';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { formatCOP } from '@/lib/subscription-constants';
import { AlertTriangle } from 'lucide-react';

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: 'clients' | 'filings' | 'expired';
}

export function UpgradeDialog({ open, onOpenChange, reason }: UpgradeDialogProps) {
  const { plan, usage } = useSubscription();

  const getMessage = () => {
    switch (reason) {
      case 'clients':
        return `Has alcanzado el límite de ${usage.maxClients} clientes de tu plan ${plan?.display_name}.`;
      case 'filings':
        return `Has alcanzado el límite de ${usage.maxFilings} procesos de tu plan ${plan?.display_name}.`;
      case 'expired':
        return 'Tu suscripción ha expirado. Selecciona un plan para continuar.';
      default:
        return 'Actualiza tu plan para acceder a más funcionalidades.';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Actualiza tu plan
          </DialogTitle>
          <DialogDescription className="text-base">
            {getMessage()}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          <PricingCards />
        </div>

        <p className="text-center text-sm text-muted-foreground mt-4">
          ¿Tienes preguntas? Contáctanos a soporte@atenia.co
        </p>
      </DialogContent>
    </Dialog>
  );
}
