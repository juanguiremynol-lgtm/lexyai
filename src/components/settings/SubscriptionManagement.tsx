import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Crown, Calendar, AlertTriangle, CheckCircle2, Clock, Plus, Minus, PlayCircle, PauseCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { formatCOP, STATUS_COLORS, STATUS_LABELS, PLAN_COLORS, getDaysRemaining } from '@/lib/subscription-constants';
import type { PlanName } from '@/lib/subscription-constants';

export function SubscriptionManagement() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const { subscription, plan, isTrialing, isExpired, trialDaysRemaining, refetch } = useSubscription();
  const [extendDays, setExtendDays] = useState(30);

  // Extend trial
  const extendTrial = useMutation({
    mutationFn: async (days: number) => {
      if (!subscription) throw new Error('No subscription found');

      const currentEnd = subscription.trial_ends_at 
        ? new Date(subscription.trial_ends_at) 
        : new Date();
      
      const newEnd = new Date(currentEnd);
      newEnd.setDate(newEnd.getDate() + days);

      const { error } = await supabase
        .from('subscriptions')
        .update({ 
          trial_ends_at: newEnd.toISOString(),
          status: 'trialing',
        })
        .eq('id', subscription.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      refetch();
      toast.success(`Período de prueba extendido por ${extendDays} días`);
    },
    onError: (error: Error) => {
      toast.error('Error: ' + error.message);
    },
  });

  // Activate subscription (manual)
  const activateSubscription = useMutation({
    mutationFn: async () => {
      if (!subscription) throw new Error('No subscription found');

      // Get a paid plan (use 'basic' as default)
      const { data: basicPlan } = await supabase
        .from('subscription_plans')
        .select('id')
        .eq('name', 'unlimited')
        .single();

      const activeUntil = new Date();
      activeUntil.setFullYear(activeUntil.getFullYear() + 1); // 1 year

      const { error } = await supabase
        .from('subscriptions')
        .update({ 
          status: 'active',
          plan_id: basicPlan?.id || subscription.plan_id,
          current_period_start: new Date().toISOString(),
          current_period_end: activeUntil.toISOString(),
        })
        .eq('id', subscription.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      refetch();
      toast.success('Suscripción activada');
    },
    onError: (error: Error) => {
      toast.error('Error: ' + error.message);
    },
  });

  // Suspend subscription
  const suspendSubscription = useMutation({
    mutationFn: async () => {
      if (!subscription) throw new Error('No subscription found');

      const { error } = await supabase
        .from('subscriptions')
        .update({ status: 'past_due' })
        .eq('id', subscription.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      refetch();
      toast.success('Suscripción suspendida');
    },
    onError: (error: Error) => {
      toast.error('Error: ' + error.message);
    },
  });

  // Unsuspend subscription
  const unsuspendSubscription = useMutation({
    mutationFn: async () => {
      if (!subscription) throw new Error('No subscription found');

      const { error } = await supabase
        .from('subscriptions')
        .update({ status: isTrialing ? 'trialing' : 'active' })
        .eq('id', subscription.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      refetch();
      toast.success('Suscripción reactivada');
    },
    onError: (error: Error) => {
      toast.error('Error: ' + error.message);
    },
  });

  // Force expire
  const forceExpire = useMutation({
    mutationFn: async () => {
      if (!subscription) throw new Error('No subscription found');

      const { error } = await supabase
        .from('subscriptions')
        .update({ 
          status: 'expired',
          trial_ends_at: new Date().toISOString(), // Set to now
        })
        .eq('id', subscription.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      refetch();
      toast.success('Suscripción expirada');
    },
    onError: (error: Error) => {
      toast.error('Error: ' + error.message);
    },
  });

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
              <CardTitle>Gestión de Suscripción</CardTitle>
            </div>
            <Badge className={statusColor}>
              {STATUS_LABELS[subscription.status as keyof typeof STATUS_LABELS] || subscription.status}
            </Badge>
          </div>
          <CardDescription>
            Administra el estado de la suscripción de la organización
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

          {/* Trial Extension */}
          {(isTrialing || isExpired) && (
            <div className="space-y-3">
              <Label>Extender Período de Prueba</Label>
              <div className="flex gap-2 items-center">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setExtendDays(Math.max(1, extendDays - 7))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  value={extendDays}
                  onChange={(e) => setExtendDays(parseInt(e.target.value) || 1)}
                  className="w-20 text-center"
                  min={1}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setExtendDays(extendDays + 7)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">días</span>
                <Button
                  onClick={() => extendTrial.mutate(extendDays)}
                  disabled={extendTrial.isPending}
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Extender
                </Button>
              </div>
            </div>
          )}

          <Separator />

          {/* Admin Actions */}
          <div className="space-y-3">
            <Label>Acciones Administrativas</Label>
            <div className="flex flex-wrap gap-2">
              {/* Activate */}
              {(isTrialing || isExpired || isSuspended) && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="default">
                      <PlayCircle className="h-4 w-4 mr-2" />
                      Activar Plan Completo
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Activar Suscripción</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esto activará la suscripción con el plan Ilimitado por 1 año. 
                        ¿Confirmar activación?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => activateSubscription.mutate()}>
                        Activar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              {/* Suspend / Unsuspend */}
              {!isExpired && (
                isSuspended ? (
                  <Button 
                    variant="outline" 
                    onClick={() => unsuspendSubscription.mutate()}
                    disabled={unsuspendSubscription.isPending}
                  >
                    <PlayCircle className="h-4 w-4 mr-2" />
                    Reactivar
                  </Button>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline">
                        <PauseCircle className="h-4 w-4 mr-2" />
                        Suspender
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Suspender Suscripción</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esto bloqueará la creación de nuevos registros. 
                          La organización podrá ver sus datos pero no crear nuevos.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => suspendSubscription.mutate()}>
                          Suspender
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )
              )}

              {/* Force Expire */}
              {!isExpired && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <XCircle className="h-4 w-4 mr-2" />
                      Forzar Expiración
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Forzar Expiración</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esto marcará la suscripción como expirada inmediatamente.
                        La organización no podrá crear ni modificar registros.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={() => forceExpire.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Expirar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          {/* Subscription Details */}
          <div className="p-4 bg-muted/50 rounded-lg text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ID Suscripción:</span>
              <code className="text-xs">{subscription.id}</code>
            </div>
            {subscription.trial_started_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Inicio prueba:</span>
                <span>{new Date(subscription.trial_started_at).toLocaleDateString('es-CO')}</span>
              </div>
            )}
            {subscription.trial_ends_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fin prueba:</span>
                <span>{new Date(subscription.trial_ends_at).toLocaleDateString('es-CO')}</span>
              </div>
            )}
            {subscription.current_period_end && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Período actual termina:</span>
                <span>{new Date(subscription.current_period_end).toLocaleDateString('es-CO')}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
