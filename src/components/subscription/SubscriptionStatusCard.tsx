import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { formatCOP, STATUS_COLORS, STATUS_LABELS, PLAN_COLORS } from '@/lib/subscription-constants';
import { AlertTriangle, Calendar, CheckCircle2, Crown, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function SubscriptionStatusCard() {
  const { subscription, plan, usage, isTrialing, isExpired, trialDaysRemaining, isLoading } = useSubscription();
  const navigate = useNavigate();

  if (isLoading || !subscription || !plan) {
    return null;
  }

  const statusColor = STATUS_COLORS[subscription.status] || STATUS_COLORS.expired;
  const planColor = PLAN_COLORS[plan.name as keyof typeof PLAN_COLORS] || PLAN_COLORS.trial;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Suscripción</CardTitle>
          </div>
          <Badge className={statusColor}>
            {STATUS_LABELS[subscription.status]}
          </Badge>
        </div>
        <CardDescription className="flex items-center gap-2">
          <Badge variant="outline" className={planColor}>
            {plan.display_name}
          </Badge>
          {plan.price_cop > 0 && (
            <span className="text-sm text-muted-foreground">
              {formatCOP(plan.price_cop)}/mes
            </span>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Trial warning */}
        {isTrialing && (
          <div className={`flex items-center gap-2 p-3 rounded-lg ${
            trialDaysRemaining <= 7 ? 'bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200' : 'bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200'
          }`}>
            <Calendar className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">
              {trialDaysRemaining > 0
                ? `${trialDaysRemaining} día${trialDaysRemaining > 1 ? 's' : ''} restantes de prueba`
                : 'Tu período de prueba ha terminado'
              }
            </span>
          </div>
        )}

        {/* Expired warning */}
        {isExpired && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">
              Tu suscripción ha expirado. Actualiza tu plan para continuar.
            </span>
          </div>
        )}

        {/* Usage progress */}
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

        {/* Unlimited badge */}
        {!plan.max_clients && !plan.max_filings && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 text-primary">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm font-medium">
              Plan ilimitado - Sin restricciones
            </span>
          </div>
        )}
      </CardContent>

      {(isTrialing || isExpired || plan.name !== 'unlimited') && (
        <CardFooter>
          <Button
            onClick={() => navigate('/pricing')}
            className="w-full"
            variant={isExpired ? 'default' : 'outline'}
          >
            <Zap className="h-4 w-4 mr-2" />
            {isExpired ? 'Reactivar suscripción' : 'Ver planes'}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
