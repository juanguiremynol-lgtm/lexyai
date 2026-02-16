import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Sparkles, CheckCircle2, Clock, XCircle, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { STATUS_COLORS, STATUS_LABELS, BETA_TRIAL_LABEL, BETA_TRIAL_DESCRIPTION } from '@/lib/subscription-constants';

export function SubscriptionManagement() {
  const { subscription, plan, usage, isTrialing, isExpired, trialDaysRemaining } = useSubscription();

  if (!subscription || !plan) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {BETA_TRIAL_LABEL}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No se encontró información de suscripción.</p>
        </CardContent>
      </Card>
    );
  }

  const statusColor = STATUS_COLORS[subscription.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.expired;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <CardTitle>{BETA_TRIAL_LABEL}</CardTitle>
            </div>
            <Badge className={statusColor}>
              {STATUS_LABELS[subscription.status as keyof typeof STATUS_LABELS] || subscription.status}
            </Badge>
          </div>
          <CardDescription>
            {BETA_TRIAL_DESCRIPTION}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current Status */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 border rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Plan</div>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                Beta Trial
              </Badge>
              <p className="text-sm text-muted-foreground mt-1">
                Gratuito durante el beta
              </p>
            </div>

            <div className="p-4 border rounded-lg">
              <div className="text-sm text-muted-foreground mb-1">Estado</div>
              <div className="flex items-center gap-2">
                {isExpired ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                )}
                <span className="font-medium">
                  {isExpired ? 'Expirado' : isTrialing ? 'Beta activo' : 'Activo'}
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

          {/* Usage limits */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Uso actual</h4>
            
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
                  <span className="text-muted-foreground">Procesos judiciales</span>
                  <span className="font-medium">
                    {usage.currentFilings} / {plan.max_filings}
                  </span>
                </div>
                <Progress value={usage.usagePercentFilings} className="h-2" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Beta info notice */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Estás en el programa Beta de ATENIA. Durante este período tienes acceso gratuito con límites de {plan.max_clients || 10} clientes y {plan.max_filings || 25} procesos. Los planes pagos se anunciarán cuando el beta finalice.
        </AlertDescription>
      </Alert>
    </div>
  );
}
