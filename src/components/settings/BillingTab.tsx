import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  CreditCard, 
  ExternalLink, 
  Receipt, 
  CheckCircle2, 
  AlertCircle,
  Crown,
  Star,
  Zap,
  Clock,
  Lock,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { 
  useBillingPlans,
  useCurrentBillingState,
  useCreateCheckoutSessionV2,
  useCompleteMockCheckout,
  useCreatePortalSession,
  useInvoices,
  isWithinPromoWindow,
  formatCOP,
  getPromoDaysRemaining,
} from "@/lib/billing";
import type { PlanCode, BillingCycleMonths } from "@/types/billing";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const PLAN_ICONS: Record<PlanCode, React.ReactNode> = {
  BASIC: <Star className="h-5 w-5" />,
  PRO: <Zap className="h-5 w-5" />,
  ENTERPRISE: <Crown className="h-5 w-5" />,
};

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  trialing: { label: "Prueba", variant: "secondary" },
  active: { label: "Activa", variant: "default" },
  expired: { label: "Expirada", variant: "destructive" },
  suspended: { label: "Suspendida", variant: "destructive" },
  canceled: { label: "Cancelada", variant: "outline" },
};

export function BillingTab() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { organization } = useOrganization();
  const { subscription, plan, isTrialing, trialDaysRemaining, isLoading: subLoading } = useSubscription();
  const { isAdmin } = useOrganizationMembership(organization?.id || null);
  
  const { data: plansData, isLoading: plansLoading } = useBillingPlans();
  const { data: billingState, isLoading: stateLoading } = useCurrentBillingState(organization?.id);
  const { data: invoices, isLoading: invoicesLoading } = useInvoices(organization?.id);
  
  const createCheckout = useCreateCheckoutSessionV2();
  const completeMockCheckout = useCompleteMockCheckout();
  const createPortal = useCreatePortalSession();
  
  // Selection state
  const [selectedPlan, setSelectedPlan] = useState<PlanCode | null>(
    (searchParams.get("plan") as PlanCode) || null
  );
  const [selectedCycle, setSelectedCycle] = useState<BillingCycleMonths>(
    (parseInt(searchParams.get("cycle") || "1") as BillingCycleMonths) || 1
  );
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  const showPromoOption = isWithinPromoWindow();
  const promoDaysRemaining = getPromoDaysRemaining();

  // Get current plan code from billing state or subscription
  const currentPlanCode = billingState?.plan_code || 
    (plan?.name === "basic" ? "BASIC" : plan?.name === "standard" ? "PRO" : plan?.name === "unlimited" ? "ENTERPRISE" : null);

  const handleSelectPlan = async () => {
    if (!organization?.id || !selectedPlan) {
      toast.error("Selecciona un plan para continuar");
      return;
    }

    if (selectedPlan === "ENTERPRISE") {
      window.location.href = "mailto:ventas@atenia.co?subject=Consulta%20Plan%20Enterprise";
      return;
    }

    // If selecting 24-month but promo expired
    if (selectedCycle === 24 && !showPromoOption) {
      toast.error("La promoción de 24 meses ha expirado");
      setSelectedCycle(1);
      return;
    }

    try {
      const result = await createCheckout.mutateAsync({
        organizationId: organization.id,
        planCode: selectedPlan,
        billingCycleMonths: selectedCycle,
      });

      if (result.ok && result.session_id) {
        setPendingSessionId(result.session_id);
        toast.success("Sesión de pago creada");
      }
    } catch (error) {
      console.error("Checkout error:", error);
    }
  };

  const handleCompleteMockCheckout = async () => {
    if (!pendingSessionId) return;

    try {
      await completeMockCheckout.mutateAsync({ sessionId: pendingSessionId });
      setPendingSessionId(null);
      setSelectedPlan(null);
      // Refresh page to get updated subscription
      window.location.reload();
    } catch (error) {
      console.error("Mock checkout error:", error);
    }
  };

  const handleOpenPortal = async () => {
    if (!organization?.id) return;

    try {
      await createPortal.mutateAsync({
        organizationId: organization.id,
        returnUrl: window.location.href,
      });
    } catch (error) {
      console.error("Portal error:", error);
    }
  };

  const isLoading = subLoading || plansLoading || stateLoading;

  // Get selected plan price
  const getSelectedPrice = (): number => {
    if (!selectedPlan || !plansData) return 0;
    const planData = plansData.find(p => p.plan.code === selectedPlan);
    if (!planData) return 0;
    
    if (selectedCycle === 24 && planData.introPrice) {
      return planData.introPrice.price_cop_incl_iva;
    }
    return planData.regularPrice?.price_cop_incl_iva || 0;
  };

  return (
    <div className="space-y-6">
      {/* Current subscription status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Estado de Suscripción
          </CardTitle>
          <CardDescription>
            Información sobre tu plan actual y período de facturación
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : subscription ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    currentPlanCode === "ENTERPRISE" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-300" :
                    currentPlanCode === "PRO" ? "bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-300" :
                    "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300"
                  )}>
                    {currentPlanCode && PLAN_ICONS[currentPlanCode as PlanCode]}
                  </div>
                  <div>
                    <p className="font-semibold text-lg">
                      Plan {billingState?.plan_code || plan?.display_name || "No definido"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {billingState?.current_price_cop_incl_iva 
                        ? `${formatCOP(billingState.current_price_cop_incl_iva)} / mes (IVA incluido)`
                        : "—"}
                    </p>
                  </div>
                </div>
                <Badge variant={STATUS_LABELS[subscription.status]?.variant || "secondary"}>
                  {STATUS_LABELS[subscription.status]?.label || subscription.status}
                </Badge>
              </div>

              {isTrialing && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm">
                    <strong>{trialDaysRemaining} días</strong> restantes de período de gracia
                  </span>
                </div>
              )}

              {billingState?.intro_offer_applied && billingState.price_lock_end_at && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                  <Lock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm text-emerald-700 dark:text-emerald-300">
                    Precio bloqueado hasta {format(new Date(billingState.price_lock_end_at), "d 'de' MMMM, yyyy", { locale: es })}
                  </span>
                </div>
              )}

              {subscription.current_period_end && (
                <div className="text-sm text-muted-foreground">
                  Próximo cobro: {format(new Date(subscription.current_period_end), "d 'de' MMMM, yyyy", { locale: es })}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>No tienes una suscripción activa</span>
            </div>
          )}
        </CardContent>
        {isAdmin && (
          <CardFooter className="flex gap-3 border-t pt-4">
            <Button variant="outline" onClick={handleOpenPortal} disabled={createPortal.isPending}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Gestionar facturación
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Plan selector - admin only */}
      {isAdmin && (
      <Card>
        <CardHeader>
          <CardTitle>Cambiar plan</CardTitle>
          <CardDescription>
            Selecciona un plan para actualizar tu suscripción
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Billing cycle selector */}
          {showPromoOption && (
            <div className="space-y-3">
              <Label className="text-base font-medium">Período de facturación</Label>
              <RadioGroup 
                value={String(selectedCycle)} 
                onValueChange={(v) => setSelectedCycle(parseInt(v) as BillingCycleMonths)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="1" id="monthly" />
                  <Label htmlFor="monthly" className="cursor-pointer">
                    Mensual (precio regular)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="24" id="promo24" />
                  <Label htmlFor="promo24" className="cursor-pointer flex items-center gap-1">
                    <Lock className="h-3 w-3" />
                    24 meses (precio promocional)
                    <Badge variant="secondary" className="ml-2 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 text-xs">
                      {promoDaysRemaining} días restantes
                    </Badge>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Plan cards */}
          {plansLoading ? (
            <div className="grid md:grid-cols-3 gap-4">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-4">
              {(plansData || []).map((planData) => {
                const planCode = planData.plan.code as PlanCode;
                const isCurrentPlan = currentPlanCode === planCode;
                const isSelected = selectedPlan === planCode;
                const price = selectedCycle === 24 && planData.introPrice 
                  ? planData.introPrice.price_cop_incl_iva 
                  : planData.regularPrice?.price_cop_incl_iva || 0;

                return (
                  <div
                    key={planCode}
                    className={cn(
                      "relative border rounded-lg p-4 cursor-pointer transition-all",
                      isCurrentPlan && "border-primary bg-primary/5",
                      isSelected && !isCurrentPlan && "border-primary ring-2 ring-primary/20",
                      !isCurrentPlan && !isSelected && "hover:border-primary/50"
                    )}
                    onClick={() => !isCurrentPlan && setSelectedPlan(planCode)}
                  >
                    {isCurrentPlan && (
                      <Badge className="absolute -top-2 left-4">
                        Plan actual
                      </Badge>
                    )}
                    <div className="flex items-center gap-3 mb-3 mt-1">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center",
                        planCode === "ENTERPRISE" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-300" :
                        planCode === "PRO" ? "bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-300" :
                        "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300"
                      )}>
                        {PLAN_ICONS[planCode]}
                      </div>
                      <div>
                        <p className="font-semibold">{planData.plan.display_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatCOP(price)}/mes
                        </p>
                      </div>
                    </div>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {planData.plan.max_members === 1 ? "1 usuario" : `${planData.plan.max_members} usuarios`}
                      </li>
                      {planData.plan.is_enterprise && (
                        <li>• Consola de admin</li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {/* Checkout action */}
          {selectedPlan && selectedPlan !== currentPlanCode && (
            <div className="mt-6 p-4 border rounded-lg bg-muted/50 space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <span className="font-medium">
                  Plan seleccionado: {plansData?.find(p => p.plan.code === selectedPlan)?.plan.display_name}
                </span>
              </div>
              
              <div className="text-sm text-muted-foreground">
                Precio: <strong>{formatCOP(getSelectedPrice())}/mes</strong> (IVA incluido)
                {selectedCycle === 24 && " • Compromiso 24 meses"}
              </div>
              
              <div className="flex gap-3">
                <Button 
                  onClick={handleSelectPlan}
                  disabled={createCheckout.isPending}
                >
                  {createCheckout.isPending ? "Procesando..." : "Proceder al pago"}
                </Button>
                <Button variant="outline" onClick={() => setSelectedPlan(null)}>
                  Cancelar
                </Button>
              </div>

              {/* Mock checkout completion button */}
              {pendingSessionId && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground mb-3">
                    <strong>Modo demo:</strong> Haz clic para simular el pago exitoso.
                  </p>
                  <Button 
                    variant="default"
                    onClick={handleCompleteMockCheckout}
                    disabled={completeMockCheckout.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {completeMockCheckout.isPending ? "Completando..." : "Completar pago (demo)"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Invoices / Billing history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Historial de facturación
          </CardTitle>
          <CardDescription>
            Facturas y recibos de pago anteriores
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoicesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : invoices && invoices.length > 0 ? (
            <div className="space-y-2">
              {invoices.map((invoice) => (
                <div 
                  key={invoice.id} 
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">
                        {invoice.period_start && format(new Date(invoice.period_start), "MMMM yyyy", { locale: es })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.amount_cop_incl_iva 
                          ? `${formatCOP(invoice.amount_cop_incl_iva)} (IVA incluido)`
                          : invoice.amount_usd 
                            ? `$${invoice.amount_usd} USD`
                            : "—"}
                      </p>
                    </div>
                  </div>
                  <Badge 
                    variant={invoice.status === "PAID" ? "default" : "secondary"}
                  >
                    {invoice.status === "PAID" ? "Pagada" : invoice.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Receipt className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay facturas todavía</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment methods placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Métodos de pago
          </CardTitle>
          <CardDescription>
            Gestiona tus métodos de pago guardados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No hay métodos de pago configurados</p>
            <p className="text-sm mt-1">Los métodos de pago se agregarán durante el checkout</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
