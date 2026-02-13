import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Crown, AlertTriangle, CheckCircle2, Clock, XCircle, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { formatCOP, STATUS_COLORS, STATUS_LABELS, PLAN_COLORS } from '@/lib/subscription-constants';
import type { PlanName } from '@/lib/subscription-constants';

export function SubscriptionManagement() {
  const { subscription, plan, isTrialing, isExpired, trialDaysRemaining } = useSubscription();

  if (!subscription || !plan) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5" />
            Suscripción
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No se encontró información de suscripción.</p>
        </CardContent>
      </Card>
    );
  }

  const statusColor = STATUS_COLORS[subscription.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.expired;
  const planColor = PLAN_COLORS[plan.name as PlanName] || PLAN_COLORS.trial;
  const isSuspended = subscription.status === 'past_due';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              <CardTitle>Suscripción</CardTitle>
            </div>
            <Badge className={statusColor}>
              {STATUS_LABELS[subscription.status as keyof typeof STATUS_LABELS] || subscription.status}
            </Badge>
          </div>
          <CardDescription>
            Vista de solo lectura del estado actual de tu suscripción
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Status */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 border rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Plan Actual</div>
              <Badge variant="outline" className={planColor}>
                {plan.display_name}
              </Badge>
              {plan.price_cop > 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  {formatCOP(plan.price_cop)}/mes
                </p>
              )}
            </div>

            <div className="p-4 border rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Estado</div>
              <div className="flex items-center gap-2">
                {isSuspended ? (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                ) : isExpired ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                )}
                <span className="font-medium">
                  {isSuspended ? 'Suspendida' : isExpired ? 'Expirada' : isTrialing ? 'En prueba' : 'Activa'}
                </span>
              </div>
            </div>

            {isTrialing && (
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground mb-1">Días Restantes</div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="font-medium text-lg">{trialDaysRemaining}</span>
                  <span className="text-sm text-muted-foreground">días</span>
                </div>
                {subscription.trial_ends_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Termina: {new Date(subscription.trial_ends_at).toLocaleDateString('es-CO')}
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Subscription Details */}
          <div className="p-4 bg-muted/50 rounded-lg text-sm space-y-2">
            {subscription.current_period_end && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vigente hasta:</span>
                <span>{new Date(subscription.current_period_end).toLocaleDateString('es-CO')}</span>
              </div>
            )}
            {subscription.current_period_start && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Inicio período:</span>
                <span>{new Date(subscription.current_period_start).toLocaleDateString('es-CO')}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Read-only notice */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Los cambios de suscripción (extensiones, activaciones, suspensiones) son administrados por el equipo de soporte de ATENIA.
          Contacta a soporte si necesitas modificar tu plan.
        </AlertDescription>
      </Alert>
    </div>
  );
}
