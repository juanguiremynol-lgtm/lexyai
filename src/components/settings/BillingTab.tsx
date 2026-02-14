import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  CalendarPlus,
  ArrowUpCircle,
  RefreshCw,
  ShieldAlert,
  Timer,
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
import { format, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";

const PLAN_ICONS: Record<PlanCode, React.ReactNode> = {
  BASIC: <Star className="h-5 w-5" />,
  PRO: <Zap className="h-5 w-5" />,
  ENTERPRISE: <Crown className="h-5 w-5" />,
};

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  trialing: { label: "Prueba Gratuita", variant: "secondary" },
  active: { label: "Activa", variant: "default" },
  expired: { label: "Expirada", variant: "destructive" },
  suspended: { label: "Suspendida", variant: "destructive" },
  canceled: { label: "Cancelada", variant: "outline" },
  past_due: { label: "Pago Pendiente", variant: "destructive" },
};

// Duration options for "Buy More Time"
const EXTEND_OPTIONS = [
  { value: 1, label: "1 mes", description: "Extiende tu suscripción por 1 mes adicional" },
  { value: 3, label: "3 meses", description: "Extiende tu suscripción por 3 meses adicionales" },
  { value: 12, label: "1 año", description: "Extiende tu suscripción por 12 meses adicionales" },
] as const;

export function BillingTab() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { organization } = useOrganization();
  const { subscription, plan, isTrialing, isExpired, isPastDue, isSuspended, trialDaysRemaining, isLoading: subLoading } = useSubscription();
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
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [extendDuration, setExtendDuration] = useState<number>(1);
  const [showPlanSelector, setShowPlanSelector] = useState(false);

  const showPromoOption = isWithinPromoWindow();
  const promoDaysRemaining = getPromoDaysRemaining();

  // Get current plan code from billing state or subscription
  const currentPlanCode = billingState?.plan_code || 
    (plan?.name === "basic" ? "BASIC" : plan?.name === "standard" ? "PRO" : plan?.name === "unlimited" ? "ENTERPRISE" : null);

  // Time remaining calculation
  const timeRemaining = useMemo(() => {
    const endDate = subscription?.current_period_end || subscription?.trial_ends_at;
    if (!endDate) return null;
    const end = new Date(endDate);
    const now = new Date();
    const days = differenceInDays(end, now);
    return { days: Math.max(0, days), date: end, isPast: days <= 0 };
  }, [subscription?.current_period_end, subscription?.trial_ends_at]);

  const timeRemainingPercent = useMemo(() => {
    if (!timeRemaining || !subscription?.current_period_start) return 0;
    const start = new Date(subscription.current_period_start).getTime();
    const end = timeRemaining.date.getTime();
    const now = Date.now();
    const total = end - start;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, ((now - start) / total) * 100));
  }, [timeRemaining, subscription?.current_period_start]);

  // Determine primary CTA based on subscription state
  const primaryCTA = useMemo(() => {
    if (isExpired || isSuspended) {
      return { label: "Reactivar Suscripción", icon: RefreshCw, action: "reactivate" } as const;
    }
    if (isTrialing) {
      return { label: "Iniciar Plan de Pago", icon: ArrowUpCircle, action: "upgrade" } as const;
    }
    return { label: "Comprar Más Tiempo", icon: CalendarPlus, action: "extend" } as const;
  }, [isExpired, isSuspended, isTrialing]);

  const secondaryCTA = useMemo(() => {
    if (isTrialing) return null; // Trial: only one CTA
    const isHighestTier = currentPlanCode === "ENTERPRISE";
    return {
      label: isHighestTier ? "Cambiar Plan" : "Mejorar Plan",
      icon: ArrowUpCircle,
      action: "upgrade" as const,
    };
  }, [isTrialing, currentPlanCode]);

  const handlePrimaryCTA = () => {
    if (primaryCTA.action === "extend") {
      setShowExtendDialog(true);
    } else {
      setShowPlanSelector(true);
    }
  };

  const handleSecondaryCTA = () => {
    setShowPlanSelector(true);
  };

  const handleExtendConfirm = async () => {
    if (!organization?.id || !currentPlanCode) return;

    try {
      const result = await createCheckout.mutateAsync({
        organizationId: organization.id,
        planCode: currentPlanCode as PlanCode,
        billingCycleMonths: extendDuration as BillingCycleMonths,
      });

      if (result.ok && result.session_id) {
        setPendingSessionId(result.session_id);
        setShowExtendDialog(false);
        toast.success("Sesión de pago creada");
      }
    } catch (error) {
      console.error("Extend error:", error);
    }
  };

  const handleSelectPlan = async () => {
    if (!organization?.id || !selectedPlan) {
      toast.error("Selecciona un plan para continuar");
      return;
    }

    if (selectedPlan === "ENTERPRISE") {
      window.location.href = "mailto:ventas@atenia.co?subject=Consulta%20Plan%20Enterprise";
      return;
    }

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
        setShowPlanSelector(false);
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

  const getSelectedPrice = (): number => {
    if (!selectedPlan || !plansData) return 0;
    const planData = plansData.find(p => p.plan.code === selectedPlan);
    if (!planData) return 0;
    if (selectedCycle === 24 && planData.introPrice) {
      return planData.introPrice.price_cop_incl_iva;
    }
    return planData.regularPrice?.price_cop_incl_iva || 0;
  };

  // Helper to wrap buttons for non-admin gating
  const AdminGatedButton = ({ children, ...props }: React.ComponentProps<typeof Button>) => {
    if (isAdmin) return <Button {...props}>{children}</Button>;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Button {...props} disabled>{children}</Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Contacta al administrador de tu organización para gestionar la facturación.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  return (
    <div className="space-y-6">
      {/* ─── Current Plan Card ─── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              {isAdmin ? "Plan de la Organización" : "Tu Plan"}
            </CardTitle>
            {subscription && (
              <Badge variant={STATUS_LABELS[subscription.status]?.variant || "secondary"}>
                {STATUS_LABELS[subscription.status]?.label || subscription.status}
              </Badge>
            )}
          </div>
          <CardDescription>
            {isAdmin ? "Administra la facturación de tu organización" : "Información sobre tu plan actual"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-full" />
            </div>
          ) : subscription ? (
            <>
              {/* Plan + price row */}
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
                        : isTrialing ? "Período de gracia gratuito" : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Time remaining indicator */}
              {timeRemaining && !timeRemaining.isPast && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Timer className="h-3.5 w-3.5" />
                      Tiempo restante
                    </span>
                    <span className={cn(
                      "font-medium",
                      timeRemaining.days <= 7 ? "text-destructive" :
                      timeRemaining.days <= 30 ? "text-amber-600 dark:text-amber-400" :
                      "text-foreground"
                    )}>
                      {timeRemaining.days} días
                    </span>
                  </div>
                  <Progress 
                    value={timeRemainingPercent} 
                    className="h-2" 
                  />
                  <p className="text-xs text-muted-foreground">
                    {isTrialing ? "Prueba termina" : "Renovación"}: {format(timeRemaining.date, "d 'de' MMMM, yyyy", { locale: es })}
                  </p>
                </div>
              )}

              {/* Trial notice */}
              {isTrialing && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-sm">
                    <strong>{trialDaysRemaining} días</strong> restantes de período de gracia — Extiende tu suscripción en cualquier momento.
                  </span>
                </div>
              )}

              {/* Expired / Suspended notice */}
              {(isExpired || isSuspended) && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <ShieldAlert className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-destructive">
                    {isExpired 
                      ? "Tu suscripción ha expirado. Reactívala para continuar usando todas las funcionalidades."
                      : "Tu suscripción está suspendida por pago pendiente."}
                  </span>
                </div>
              )}

              {/* Price lock info */}
              {billingState?.intro_offer_applied && billingState.price_lock_end_at && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                  <Lock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm text-emerald-700 dark:text-emerald-300">
                    Precio bloqueado hasta {format(new Date(billingState.price_lock_end_at), "d 'de' MMMM, yyyy", { locale: es })}
                  </span>
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

        {/* ─── Primary & Secondary CTAs ─── */}
        {subscription && (
          <CardFooter className="flex flex-wrap gap-3 border-t pt-4">
            <AdminGatedButton onClick={handlePrimaryCTA} disabled={createCheckout.isPending}>
              <primaryCTA.icon className="h-4 w-4 mr-2" />
              {primaryCTA.label}
            </AdminGatedButton>

            {secondaryCTA && (
              <AdminGatedButton variant="outline" onClick={handleSecondaryCTA}>
                <secondaryCTA.icon className="h-4 w-4 mr-2" />
                {secondaryCTA.label}
              </AdminGatedButton>
            )}

            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={handleOpenPortal} disabled={createPortal.isPending}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Portal de facturación
              </Button>
            )}
          </CardFooter>
        )}
      </Card>

      {/* ─── Mock checkout completion (if pending) ─── */}
      {pendingSessionId && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <p className="font-medium">Sesión de pago pendiente</p>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              <strong>Modo demo:</strong> Haz clic para simular el pago exitoso.
            </p>
            <Button 
              onClick={handleCompleteMockCheckout}
              disabled={completeMockCheckout.isPending}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {completeMockCheckout.isPending ? "Completando..." : "Completar pago (demo)"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── Billing History ─── */}
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
                  <Badge variant={invoice.status === "PAID" ? "default" : "secondary"}>
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

      {/* ─── Payment methods ─── */}
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

      {/* ═══ "Buy More Time" Dialog ═══ */}
      <Dialog open={showExtendDialog} onOpenChange={setShowExtendDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5" />
              Extender Suscripción
            </DialogTitle>
            <DialogDescription>
              Extiende tu suscripción en cualquier momento. Tu fecha de renovación se extenderá sin interrupciones.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <RadioGroup 
              value={String(extendDuration)} 
              onValueChange={(v) => setExtendDuration(parseInt(v))}
              className="space-y-3"
            >
              {EXTEND_OPTIONS.map((opt) => {
                const price = plansData?.find(p => p.plan.code === currentPlanCode)?.regularPrice?.price_cop_incl_iva || 0;
                const totalPrice = price * opt.value;
                return (
                  <div key={opt.value} className={cn(
                    "flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-all",
                    extendDuration === opt.value 
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20" 
                      : "hover:border-primary/50"
                  )}>
                    <RadioGroupItem value={String(opt.value)} id={`extend-${opt.value}`} />
                    <Label htmlFor={`extend-${opt.value}`} className="flex-1 cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{opt.label}</p>
                          <p className="text-xs text-muted-foreground">{opt.description}</p>
                        </div>
                        {totalPrice > 0 && (
                          <p className="font-semibold text-sm">{formatCOP(totalPrice)}</p>
                        )}
                      </div>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>

            {timeRemaining && !timeRemaining.isPast && (
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <p className="text-muted-foreground">
                  Tu fecha de renovación se extenderá de{" "}
                  <strong>{format(timeRemaining.date, "d MMM yyyy", { locale: es })}</strong> a aproximadamente{" "}
                  <strong>
                    {format(
                      new Date(timeRemaining.date.getTime() + extendDuration * 30 * 24 * 60 * 60 * 1000),
                      "d MMM yyyy",
                      { locale: es }
                    )}
                  </strong>.
                  Sin interrupciones en el servicio.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExtendDialog(false)}>
              Cancelar
            </Button>
            <AdminGatedButton onClick={handleExtendConfirm} disabled={createCheckout.isPending}>
              {createCheckout.isPending ? "Procesando..." : "Proceder al Pago"}
            </AdminGatedButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Plan Selector Dialog ═══ */}
      <Dialog open={showPlanSelector} onOpenChange={setShowPlanSelector}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpCircle className="h-5 w-5" />
              {isTrialing ? "Elige tu Plan" : isExpired || isSuspended ? "Reactiva tu Plan" : "Cambiar Plan"}
            </DialogTitle>
            <DialogDescription>
              {isTrialing 
                ? "Selecciona un plan para comenzar tu suscripción de pago."
                : isExpired || isSuspended
                  ? "Selecciona un plan para reactivar tu suscripción."
                  : "Selecciona un nuevo plan. El cambio se aplicará en tu próximo ciclo de facturación."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
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
              <div className="p-4 border rounded-lg bg-muted/50 space-y-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  <span className="font-medium">
                    Plan seleccionado: {plansData?.find(p => p.plan.code === selectedPlan)?.plan.display_name}
                  </span>
                </div>
                
                <div className="text-sm text-muted-foreground">
                  Precio: <strong>{formatCOP(getSelectedPrice())}/mes</strong> (IVA incluido)
                  {selectedCycle === 24 && " • Compromiso 24 meses"}
                  {!isTrialing && !isExpired && !isSuspended && (
                    <p className="mt-1 text-xs">El cambio se aplica en tu próximo ciclo de facturación.</p>
                  )}
                </div>
                
                <div className="flex gap-3">
                  <AdminGatedButton 
                    onClick={handleSelectPlan}
                    disabled={createCheckout.isPending}
                  >
                    {createCheckout.isPending ? "Procesando..." : "Proceder al Pago"}
                  </AdminGatedButton>
                  <Button variant="outline" onClick={() => setSelectedPlan(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
