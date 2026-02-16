import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock, Sparkles } from "lucide-react";

interface SubscriptionGateProps {
  children: ReactNode;
  allowReadOnly?: boolean;
}

/**
 * SubscriptionGate - Restricts access based on subscription status
 * During beta, all users are on TRIAL.
 */
export function SubscriptionGate({ children, allowReadOnly = false }: SubscriptionGateProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { subscription, billingSubscription, isLoading, isTrialing, trialDaysRemaining, isActive } = useSubscription();
  const { organization } = useOrganization();
  const [shouldBlock, setShouldBlock] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    if (isTrialing && trialDaysRemaining > 0) {
      setShouldBlock(false);
      return;
    }

    const billingStatus = billingSubscription?.status;
    if (billingStatus === "TRIAL" || billingStatus === "ACTIVE") {
      setShouldBlock(false);
      return;
    }

    if (subscription?.status === "active" || subscription?.status === "trialing") {
      setShouldBlock(false);
      return;
    }

    if (subscription?.status && ["expired", "suspended", "canceled"].includes(subscription.status)) {
      setShouldBlock(true);
      return;
    }
    if (billingStatus && ["SUSPENDED", "CANCELLED", "EXPIRED", "CHURNED"].includes(billingStatus)) {
      setShouldBlock(true);
      return;
    }

    setShouldBlock(false);
  }, [isLoading, subscription, billingSubscription, isTrialing, trialDaysRemaining, isActive]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse text-muted-foreground">Verificando suscripción...</div>
      </div>
    );
  }

  if (shouldBlock && !allowReadOnly) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle>Beta trial expirado</CardTitle>
            <CardDescription>
              Tu período de prueba beta ha terminado. Contacta a soporte para continuar usando ATENIA.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center text-sm text-muted-foreground">
              Estado: <span className="font-medium text-destructive">{billingSubscription?.status || subscription?.status || "Sin suscripción"}</span>
            </div>
            <div className="text-center text-sm text-muted-foreground">
              Los planes pagos se anunciarán próximamente.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Hook to check if current user can perform write operations
 */
export function useSubscriptionAccess() {
  const { subscription, billingSubscription, isTrialing, trialDaysRemaining, isLoading } = useSubscription();
  
  const canWrite = () => {
    if (isLoading) return false;
    if (isTrialing && trialDaysRemaining > 0) return true;
    const billingStatus = billingSubscription?.status;
    if (billingStatus === "TRIAL" || billingStatus === "ACTIVE") return true;
    if (subscription?.status === "active" || subscription?.status === "trialing") return true;
    return false;
  };

  return {
    canWrite: canWrite(),
    isLoading,
    subscriptionStatus: billingSubscription?.status || subscription?.status || null,
    isTrialing,
    trialDaysRemaining,
  };
}

/**
 * TrialWarningBanner - Shows a warning when trial is ending soon
 */
export function TrialWarningBanner() {
  const { isTrialing, trialDaysRemaining } = useSubscription();

  if (!isTrialing || trialDaysRemaining > 14) {
    return null;
  }

  const isUrgent = trialDaysRemaining <= 3;

  return (
    <div className={`flex items-center justify-between px-4 py-2 text-sm ${
      isUrgent 
        ? "bg-destructive/10 text-destructive border-b border-destructive/20" 
        : "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-b border-amber-200 dark:border-amber-800"
    }`}>
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4" />
        <span>
          {isUrgent 
            ? `¡Atención! Tu beta trial termina en ${trialDaysRemaining} día${trialDaysRemaining !== 1 ? "s" : ""}.`
            : `Tu beta trial termina en ${trialDaysRemaining} días.`
          }
        </span>
      </div>
    </div>
  );
}
