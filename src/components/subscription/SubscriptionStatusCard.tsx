import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { STATUS_COLORS, STATUS_LABELS, BETA_TRIAL_LABEL } from '@/lib/subscription-constants';
import { Calendar, CheckCircle2, Sparkles } from 'lucide-react';

export function SubscriptionStatusCard() {
  const { subscription, plan, usage, isTrialing, isExpired, trialDaysRemaining, isLoading } = useSubscription();

  if (isLoading || !subscription || !plan) {
    return null;
  }

  const statusColor = STATUS_COLORS[subscription.status] || STATUS_COLORS.expired;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">{BETA_TRIAL_LABEL}</CardTitle>
          </div>
          <Badge className={statusColor}>
            {STATUS_LABELS[subscription.status]}
          </Badge>
        </div>
        <CardDescription>
          Acceso completo durante el período beta
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Trial period info */}
        {isTrialing && trialDaysRemaining > 0 && (
          <div className={`flex items-center gap-2 p-3 rounded-lg ${
            trialDaysRemaining <= 14 ? 'bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200' : 'bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200'
          }`}>
            <Calendar className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">
              {trialDaysRemaining} día{trialDaysRemaining > 1 ? 's' : ''} restantes de beta trial
            </span>
          </div>
        )}

        {/* Trial expired */}
        {isExpired && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
            <Calendar className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">
              Tu período de prueba beta ha terminado. Contacta a soporte para continuar.
            </span>
          </div>
        )}

        {/* Usage progress — clients */}
        {plan.max_clients && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Clientes</span>
              <span className="font-medium">
                {usage.currentClients} / {plan.max_clients}
              </span>
            </div>
            <Progress value={usage.usagePercentClients} className="h-2" />
          </div>
        )}

        {/* Usage progress — work items */}
        {plan.max_filings && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Procesos</span>
              <span className="font-medium">
                {usage.currentFilings} / {plan.max_filings}
              </span>
            </div>
            <Progress value={usage.usagePercentFilings} className="h-2" />
          </div>
        )}

        {/* Trial end date */}
        {subscription.trial_ends_at && (
          <div className="pt-2 border-t text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Beta trial termina:</span>
              <span className="font-medium">
                {new Date(subscription.trial_ends_at).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>
          </div>
        )}

        {/* Beta badge */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 text-primary">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm font-medium">
            Programa Beta — Los planes pagos se anunciarán próximamente
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
