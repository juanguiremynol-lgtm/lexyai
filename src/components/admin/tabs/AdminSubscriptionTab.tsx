/**
 * Admin Subscription Tab - READ-ONLY subscription status view for org admins
 * With prominent link to Settings → Billing for plan management
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Crown, 
  Calendar, 
  Clock, 
  CheckCircle2,
  Pause,
  XCircle,
  Info,
  CreditCard,
  ArrowRight,
} from "lucide-react";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { differenceInDays, format } from "date-fns";
import { es } from "date-fns/locale";
import { useNavigate } from "react-router-dom";

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
  const { subscription, plan } = useSubscription();
  const navigate = useNavigate();

  const trialEndsAt = subscription?.trial_ends_at ? new Date(subscription.trial_ends_at) : null;
  const daysRemaining = trialEndsAt ? differenceInDays(trialEndsAt, new Date()) : 0;
  const isTrialing = subscription?.status === "trialing";

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
      {/* Quick action: go to billing */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-primary" />
            <div>
              <p className="font-medium">Gestionar Facturación</p>
              <p className="text-sm text-muted-foreground">
                Compra más tiempo, cambia de plan o revisa facturas
              </p>
            </div>
          </div>
          <Button onClick={() => navigate("/settings?tab=billing")} variant="default" size="sm">
            Ir a Facturación
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </CardContent>
      </Card>

      {/* Current Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            Estado de Suscripción
          </CardTitle>
          <CardDescription>
            Vista del estado actual de la suscripción de tu organización
          </CardDescription>
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
              {subscription.current_period_start && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>Inicio período: {format(new Date(subscription.current_period_start), "dd MMM yyyy", { locale: es })}</span>
                </div>
              )}
              {subscription.current_period_end && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>Fin período: {format(new Date(subscription.current_period_end), "dd MMM yyyy", { locale: es })}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Read-only notice */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Para comprar más tiempo, cambiar de plan o gestionar métodos de pago, ve a{" "}
          <button 
            onClick={() => navigate("/settings?tab=billing")}
            className="underline font-medium hover:text-primary transition-colors"
          >
            Configuración → Facturación
          </button>.
        </AlertDescription>
      </Alert>
    </div>
  );
}
