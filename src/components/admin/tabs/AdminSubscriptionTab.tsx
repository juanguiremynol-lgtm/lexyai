/**
 * Admin Subscription Tab - Trial and subscription management
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  Crown, 
  Calendar, 
  Clock, 
  Plus,
  Play,
  Pause,
  RotateCcw,
  XCircle,
  Loader2,
  AlertTriangle,
  CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { logAudit } from "@/lib/audit-log";
import { differenceInDays, addDays, format } from "date-fns";
import { es } from "date-fns/locale";

const STATUS_BADGES: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  active: { 
    label: "Activo", 
    className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    icon: CheckCircle2
  },
  trialing: { 
    label: "Prueba", 
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    icon: Clock
  },
  past_due: { 
    label: "Suspendido", 
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    icon: Pause
  },
  expired: { 
    label: "Expirado", 
    className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    icon: XCircle
  },
};

export function AdminSubscriptionTab() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const { subscription, plan, refetch } = useSubscription();

  const [extensionDays, setExtensionDays] = useState(30);
  const [extensionReason, setExtensionReason] = useState("");

  // Calculate trial info
  const trialEndsAt = subscription?.trial_ends_at ? new Date(subscription.trial_ends_at) : null;
  const daysRemaining = trialEndsAt ? differenceInDays(trialEndsAt, new Date()) : 0;
  const isTrialing = subscription?.status === "trialing";

  // Extend trial mutation
  const extendTrial = useMutation({
    mutationFn: async ({ days, reason }: { days: number; reason: string }) => {
      if (!subscription?.id || !organization?.id) throw new Error("No subscription");

      const newEndDate = addDays(trialEndsAt || new Date(), days);

      const { error } = await supabase
        .from("subscriptions")
        .update({
          trial_ends_at: newEndDate.toISOString(),
          status: "trialing",
        })
        .eq("id", subscription.id);

      if (error) throw error;

      await logAudit({
        organizationId: organization.id,
        action: "TRIAL_EXTENDED",
        entityType: "subscription",
        entityId: subscription.id,
        metadata: { days, reason, newEndDate: newEndDate.toISOString() },
      });
    },
    onSuccess: () => {
      refetch();
      toast.success(`Prueba extendida por ${extensionDays} días`);
      setExtensionDays(30);
      setExtensionReason("");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Activate subscription
  const activateSubscription = useMutation({
    mutationFn: async () => {
      if (!subscription?.id || !organization?.id) throw new Error("No subscription");

      const { error } = await supabase
        .from("subscriptions")
        .update({
          status: "active",
          current_period_start: new Date().toISOString(),
          current_period_end: addDays(new Date(), 365).toISOString(),
        })
        .eq("id", subscription.id);

      if (error) throw error;

      await logAudit({
        organizationId: organization.id,
        action: "SUBSCRIPTION_ACTIVATED",
        entityType: "subscription",
        entityId: subscription.id,
        metadata: { activatedManually: true },
      });
    },
    onSuccess: () => {
      refetch();
      toast.success("Suscripción activada");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Suspend subscription
  const suspendSubscription = useMutation({
    mutationFn: async () => {
      if (!subscription?.id || !organization?.id) throw new Error("No subscription");

      const { error } = await supabase
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("id", subscription.id);

      if (error) throw error;

      await logAudit({
        organizationId: organization.id,
        action: "SUBSCRIPTION_SUSPENDED",
        entityType: "subscription",
        entityId: subscription.id,
        metadata: {},
      });
    },
    onSuccess: () => {
      refetch();
      toast.success("Suscripción suspendida");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Unsuspend
  const unsuspendSubscription = useMutation({
    mutationFn: async () => {
      if (!subscription?.id || !organization?.id) throw new Error("No subscription");

      const { error } = await supabase
        .from("subscriptions")
        .update({ status: isTrialing ? "trialing" : "active" })
        .eq("id", subscription.id);

      if (error) throw error;

      await logAudit({
        organizationId: organization.id,
        action: "SUBSCRIPTION_UNSUSPENDED",
        entityType: "subscription",
        entityId: subscription.id,
        metadata: {},
      });
    },
    onSuccess: () => {
      refetch();
      toast.success("Suscripción reactivada");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Force expire
  const forceExpire = useMutation({
    mutationFn: async () => {
      if (!subscription?.id || !organization?.id) throw new Error("No subscription");

      const { error } = await supabase
        .from("subscriptions")
        .update({ status: "expired" })
        .eq("id", subscription.id);

      if (error) throw error;

      await logAudit({
        organizationId: organization.id,
        action: "SUBSCRIPTION_EXPIRED",
        entityType: "subscription",
        entityId: subscription.id,
        metadata: { forcedManually: true },
      });
    },
    onSuccess: () => {
      refetch();
      toast.success("Suscripción expirada");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  if (!subscription) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No hay información de suscripción disponible.
        </CardContent>
      </Card>
    );
  }

  const statusInfo = STATUS_BADGES[subscription.status] || STATUS_BADGES.expired;
  const StatusIcon = statusInfo.icon;

  return (
    <div className="space-y-6">
      {/* Current Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            Estado de Suscripción
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground mb-1">Plan</p>
              <p className="font-medium text-lg">{plan?.name || "Trial"}</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground mb-1">Estado</p>
              <Badge className={statusInfo.className}>
                <StatusIcon className="h-3 w-3 mr-1" />
                {statusInfo.label}
              </Badge>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground mb-1">
                {isTrialing ? "Días Restantes" : "Vigencia"}
              </p>
              <p className="font-medium text-lg">
                {isTrialing ? (
                  <span className={daysRemaining <= 7 ? "text-amber-600" : ""}>
                    {daysRemaining} días
                  </span>
                ) : trialEndsAt ? (
                  format(trialEndsAt, "dd MMM yyyy", { locale: es })
                ) : (
                  "—"
                )}
              </p>
            </div>
          </div>

          {/* Timeline */}
          <div className="p-4 border rounded-lg space-y-3">
            <h4 className="font-medium text-sm">Historial</h4>
            <div className="space-y-2 text-sm">
              {subscription.trial_started_at && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>Inicio prueba: {format(new Date(subscription.trial_started_at), "dd MMM yyyy", { locale: es })}</span>
                </div>
              )}
              {trialEndsAt && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Fin prueba: {format(trialEndsAt, "dd MMM yyyy", { locale: es })}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trial Extension */}
      {(isTrialing || subscription.status === "expired") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Extender Período de Prueba
            </CardTitle>
            <CardDescription>
              Extiende el período de prueba. Se requiere una razón para el registro de auditoría.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="extensionDays">Días a agregar</Label>
                <Input
                  id="extensionDays"
                  type="number"
                  min={1}
                  max={365}
                  value={extensionDays}
                  onChange={(e) => setExtensionDays(parseInt(e.target.value) || 30)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="extensionReason">Razón (requerida)</Label>
                <Textarea
                  id="extensionReason"
                  value={extensionReason}
                  onChange={(e) => setExtensionReason(e.target.value)}
                  placeholder="Ej: Solicitud del cliente por evaluación extendida"
                  rows={2}
                />
              </div>
            </div>
            <Button
              onClick={() => extendTrial.mutate({ days: extensionDays, reason: extensionReason })}
              disabled={!extensionReason.trim() || extendTrial.isPending}
            >
              {extendTrial.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Extender Prueba
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Admin Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Acciones Administrativas
          </CardTitle>
          <CardDescription>
            Acciones de control de suscripción. Todas quedan registradas en auditoría.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {subscription.status !== "active" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">
                    <Play className="h-4 w-4 mr-2" />
                    Activar Suscripción
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Activar Suscripción</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esto activará la suscripción completa por 1 año. ¿Continuar?
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

            {subscription.status === "active" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">
                    <Pause className="h-4 w-4 mr-2" />
                    Suspender
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Suspender Suscripción</AlertDialogTitle>
                    <AlertDialogDescription>
                      El usuario perderá acceso a funciones de escritura. ¿Continuar?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => suspendSubscription.mutate()}
                      className="bg-amber-600 hover:bg-amber-700"
                    >
                      Suspender
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {subscription.status === "past_due" && (
              <Button variant="outline" onClick={() => unsuspendSubscription.mutate()}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reactivar
              </Button>
            )}

            {subscription.status !== "expired" && (
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
                      Esto expirará inmediatamente la suscripción. El usuario perderá todo acceso. ¿Continuar?
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
        </CardContent>
      </Card>
    </div>
  );
}
