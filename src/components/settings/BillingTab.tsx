import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
  Sparkles,
  Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { 
  usePricingData, 
  useCreateCheckoutSession,
  useCompleteMockCheckout,
  useCreatePortalSession,
  useInvoices,
  type BillingTier 
} from "@/lib/billing";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const TIER_ICONS: Record<BillingTier, React.ReactNode> = {
  FREE_TRIAL: <Sparkles className="h-5 w-5" />,
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

function formatPrice(priceUsd: number): string {
  if (priceUsd === 0) return "Gratis";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(priceUsd);
}

// Map plan names to billing tiers
function planNameToTier(planName: string | undefined): BillingTier | undefined {
  if (!planName) return undefined;
  const mapping: Record<string, BillingTier> = {
    trial: "FREE_TRIAL",
    basic: "BASIC",
    standard: "PRO",
    unlimited: "ENTERPRISE",
  };
  return mapping[planName.toLowerCase()] || undefined;
}

export function BillingTab() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { organization } = useOrganization();
  const { subscription, plan, isTrialing, trialDaysRemaining, isLoading: subLoading } = useSubscription();
  const { data: plans, isLoading: plansLoading } = usePricingData();
  const { data: invoices, isLoading: invoicesLoading } = useInvoices(organization?.id);
  
  const createCheckout = useCreateCheckoutSession();
  const completeMockCheckout = useCompleteMockCheckout();
  const createPortal = useCreatePortalSession();
  
  const [selectedTier, setSelectedTier] = useState<BillingTier | null>(
    (searchParams.get("tier") as BillingTier) || null
  );
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  // Map current subscription tier from plan name
  const currentTier = planNameToTier(plan?.name);

  const handleSelectPlan = async (tier: BillingTier) => {
    if (!organization?.id) {
      toast.error("No se encontró la organización");
      return;
    }

    if (tier === "ENTERPRISE") {
      window.location.href = "mailto:ventas@atenia.co?subject=Consulta%20Plan%20Enterprise";
      return;
    }

    setSelectedTier(tier);

    try {
      const result = await createCheckout.mutateAsync({
        organizationId: organization.id,
        tier,
      });

      if (result.session_id) {
        setPendingSessionId(result.session_id);
        // In mock mode, we show a button to complete checkout
        // In real mode, we'd redirect to result.checkout_url
        toast.success("Sesión de pago creada. Complete el checkout para activar su plan.");
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
      setSelectedTier(null);
      // Refresh subscription data
      window.location.reload();
    } catch (error) {
      console.error("Mock checkout error:", error);
    }
  };

  const handleOpenPortal = async () => {
    if (!organization?.id) return;

    try {
      const result = await createPortal.mutateAsync({
        organizationId: organization.id,
        returnUrl: window.location.href,
      });

      if (result.portal_url) {
        // In mock mode, just show a toast
        toast.info("Portal de facturación (modo demo). En producción, esto abrirá el portal del proveedor.");
      }
    } catch (error) {
      console.error("Portal error:", error);
    }
  };

  const isLoading = subLoading || plansLoading;

  // Filter plans for display (exclude FREE_TRIAL, show commercial plans)
  const commercialPlans = (plans || []).filter(p => p.tier !== "FREE_TRIAL");

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
                    currentTier === "ENTERPRISE" ? "bg-amber-100 text-amber-600" :
                    currentTier === "PRO" ? "bg-purple-100 text-purple-600" :
                    currentTier === "BASIC" ? "bg-blue-100 text-blue-600" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {currentTier && TIER_ICONS[currentTier]}
                  </div>
                  <div>
                    <p className="font-semibold text-lg">
                      Plan {plan?.display_name || currentTier || "No definido"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {plan?.price_cop ? formatPrice(plan.price_cop / 100) : "—"} / mes
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
                    <strong>{trialDaysRemaining} días</strong> restantes de prueba gratuita
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
        <CardFooter className="flex gap-3 border-t pt-4">
          <Button variant="outline" onClick={handleOpenPortal} disabled={createPortal.isPending}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Gestionar facturación
          </Button>
        </CardFooter>
      </Card>

      {/* Plan selector */}
      <Card>
        <CardHeader>
          <CardTitle>Cambiar plan</CardTitle>
          <CardDescription>
            Selecciona un plan para actualizar o cambiar tu suscripción
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plansLoading ? (
            <div className="grid md:grid-cols-3 gap-4">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-4">
              {commercialPlans.map((tierPlan) => {
                const isCurrentPlan = currentTier === tierPlan.tier;
                const isSelected = selectedTier === tierPlan.tier;

                return (
                  <div
                    key={tierPlan.tier}
                    className={cn(
                      "relative border rounded-lg p-4 cursor-pointer transition-all",
                      isCurrentPlan && "border-primary bg-primary/5",
                      isSelected && !isCurrentPlan && "border-primary ring-2 ring-primary/20",
                      !isCurrentPlan && !isSelected && "hover:border-primary/50"
                    )}
                    onClick={() => !isCurrentPlan && setSelectedTier(tierPlan.tier)}
                  >
                    {isCurrentPlan && (
                      <Badge className="absolute -top-2 left-4">
                        Plan actual
                      </Badge>
                    )}
                    <div className="flex items-center gap-3 mb-3 mt-1">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center bg-primary/10 text-primary"
                      )}>
                        {TIER_ICONS[tierPlan.tier]}
                      </div>
                      <div>
                        <p className="font-semibold">{tierPlan.displayName}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatPrice(tierPlan.monthlyPriceUsd)}/mes
                        </p>
                      </div>
                    </div>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {tierPlan.maxWorkItems && (
                        <li>• {tierPlan.maxWorkItems.toLocaleString()} procesos</li>
                      )}
                      {tierPlan.maxMembers && (
                        <li>• {tierPlan.maxMembers} usuarios</li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {selectedTier && selectedTier !== currentTier && (
            <div className="mt-6 p-4 border rounded-lg bg-muted/50 space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <span className="font-medium">
                  Plan seleccionado: {commercialPlans.find(p => p.tier === selectedTier)?.displayName}
                </span>
              </div>
              
              <div className="flex gap-3">
                <Button 
                  onClick={() => handleSelectPlan(selectedTier)}
                  disabled={createCheckout.isPending}
                >
                  {createCheckout.isPending ? "Procesando..." : "Proceder al pago"}
                </Button>
                <Button variant="outline" onClick={() => setSelectedTier(null)}>
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
                        {invoice.amount_usd ? formatPrice(invoice.amount_usd) : "—"}
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
