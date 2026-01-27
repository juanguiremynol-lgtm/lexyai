import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, Crown, Sparkles, Star, Zap, Building2, Clock, Lock, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { 
  useBillingPlans, 
  isWithinPromoWindow, 
  formatCOP,
  getPromoDaysRemaining,
} from "@/lib/billing";
import type { BillingPlanWithPrices, PlanCode } from "@/types/billing";
import { toast } from "sonner";

const PLAN_ICONS: Record<PlanCode, React.ReactNode> = {
  BASIC: <Star className="h-6 w-6" />,
  PRO: <Zap className="h-6 w-6" />,
  ENTERPRISE: <Crown className="h-6 w-6" />,
};

const PLAN_COLORS: Record<PlanCode, string> = {
  BASIC: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300",
  PRO: "bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-300",
  ENTERPRISE: "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-300",
};

interface PlanCardProps {
  planData: BillingPlanWithPrices;
  pricingMode: "monthly" | "promo24";
  isRecommended?: boolean;
  onSelect: (planCode: PlanCode, cycleMonths: 1 | 24) => void;
  isLoading?: boolean;
}

function PlanCard({ planData, pricingMode, isRecommended, onSelect, isLoading }: PlanCardProps) {
  const { plan, regularPrice, introPrice } = planData;
  const planCode = plan.code as PlanCode;
  const icon = PLAN_ICONS[planCode] || <Star className="h-6 w-6" />;
  const colorClass = PLAN_COLORS[planCode] || PLAN_COLORS.BASIC;

  // Determine price based on mode
  const price = pricingMode === "promo24" && introPrice 
    ? introPrice.price_cop_incl_iva 
    : regularPrice?.price_cop_incl_iva || 0;

  const cycleMonths = pricingMode === "promo24" ? 24 : 1;
  const isPromo = pricingMode === "promo24" && introPrice;

  return (
    <Card className={cn(
      "relative flex flex-col transition-all duration-200 hover:shadow-lg bg-card/90 backdrop-blur-sm",
      isRecommended && "border-primary shadow-lg ring-2 ring-primary/20 scale-[1.02]"
    )}>
      {isRecommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <Badge className="bg-primary text-primary-foreground shadow-md">
            Recomendado
          </Badge>
        </div>
      )}
      
      {isPromo && (
        <div className="absolute -top-2 right-4 z-10">
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            <Lock className="h-3 w-3 mr-1" />
            Precio bloqueado
          </Badge>
        </div>
      )}
      
      <CardHeader className="text-center pb-2 pt-6">
        <div className={cn(
          "mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3",
          colorClass
        )}>
          {icon}
        </div>
        <CardTitle className="text-2xl">{plan.display_name}</CardTitle>
        <CardDescription className="min-h-[40px]">
          {plan.is_enterprise ? (
            <span className="flex items-center justify-center gap-1">
              <Users className="h-4 w-4" />
              Multiusuario + Consola Admin
            </span>
          ) : (
            "Usuario individual"
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-6">
        <div className="text-center py-2">
          <span className="text-4xl font-bold">
            {formatCOP(price)}
          </span>
          <span className="text-muted-foreground text-lg">/mes</span>
          <p className="text-xs text-muted-foreground mt-1">IVA incluido</p>
        </div>

        {/* Plan limits */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Check className="h-4 w-4 text-primary" />
            <span>{plan.max_members === 1 ? "1 usuario" : `Hasta ${plan.max_members} usuarios`}</span>
          </div>
          
          {plan.is_enterprise && (
            <>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="h-4 w-4 text-primary" />
                <span>Consola de administración</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="h-4 w-4 text-primary" />
                <span>Invitaciones a equipo</span>
              </div>
            </>
          )}
          
          <div className="flex items-center gap-2 text-muted-foreground">
            <Check className="h-4 w-4 text-primary" />
            <span>Procesos ilimitados</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Check className="h-4 w-4 text-primary" />
            <span>Soporte por email</span>
          </div>
        </div>

        {isPromo && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <p className="text-xs text-emerald-700 dark:text-emerald-300 text-center">
              <strong>Precio bloqueado por 24 meses</strong>
              <br />
              Compromiso mínimo: 24 meses
            </p>
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-4">
        <Button
          onClick={() => onSelect(planCode, cycleMonths)}
          className="w-full"
          variant={isRecommended ? "default" : "outline"}
          size="lg"
          disabled={isLoading}
        >
          {planCode === "ENTERPRISE" ? "Contactar ventas" : "Elegir plan"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PlanCardSkeleton() {
  return (
    <Card className="flex flex-col bg-card/90">
      <CardHeader className="text-center pb-2">
        <Skeleton className="mx-auto w-14 h-14 rounded-full mb-3" />
        <Skeleton className="h-7 w-24 mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto mt-2" />
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        <Skeleton className="h-10 w-28 mx-auto" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </CardContent>
      <CardFooter>
        <Skeleton className="h-11 w-full" />
      </CardFooter>
    </Card>
  );
}

export default function PublicPricingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [pricingMode, setPricingMode] = useState<"monthly" | "promo24">("monthly");
  const { data: plansData, isLoading } = useBillingPlans();

  const showPromoOption = isWithinPromoWindow();
  const promoDaysRemaining = getPromoDaysRemaining();

  // Check auth status on mount
  useEffect(() => {
    document.title = "Planes y Precios - ATENIA";
    
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
      
      if (session) {
        // Check if user is org admin
        const { data: membership } = await supabase
          .from("organization_memberships")
          .select("role")
          .eq("user_id", session.user.id)
          .in("role", ["OWNER", "ADMIN"])
          .maybeSingle();
        
        setIsOrgAdmin(!!membership);
      }
    };
    
    checkAuth();
  }, []);

  const handleSelectPlan = (planCode: PlanCode, cycleMonths: 1 | 24) => {
    if (planCode === "ENTERPRISE") {
      // Open email for enterprise inquiries
      window.location.href = "mailto:ventas@atenia.co?subject=Consulta%20Plan%20Enterprise";
      return;
    }

    if (isAuthenticated === null) {
      return;
    }

    if (!isAuthenticated) {
      // Not logged in - redirect to auth with plan stored
      toast.info("Inicia sesión para continuar con tu suscripción");
      navigate(`/auth?next=/billing&plan=${planCode}&cycle=${cycleMonths}`);
      return;
    }

    if (!isOrgAdmin) {
      toast.error("Solo los administradores de la organización pueden cambiar el plan");
      return;
    }

    // Logged in as admin - go to billing page with selection
    navigate(`/app/settings?tab=billing&plan=${planCode}&cycle=${cycleMonths}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container max-w-7xl py-12 px-4 space-y-12">
        {/* Hero section */}
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Planes y Precios
          </h1>
          <p className="text-xl text-muted-foreground">
            Elige el plan que mejor se adapte a las necesidades de tu firma. 
            Todos los precios incluyen IVA.
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>Período de gracia hasta abril 2026 • Sin tarjeta de crédito</span>
          </div>
        </div>

        {/* Pricing mode toggle */}
        {showPromoOption && (
          <div className="flex flex-col items-center gap-4">
            <Tabs value={pricingMode} onValueChange={(v) => setPricingMode(v as "monthly" | "promo24")} className="w-full max-w-md">
              <TabsList className="grid w-full grid-cols-2 bg-muted/50">
                <TabsTrigger value="monthly" className="data-[state=active]:bg-background">
                  Mensual
                </TabsTrigger>
                <TabsTrigger value="promo24" className="data-[state=active]:bg-background">
                  <Lock className="h-3 w-3 mr-1" />
                  Promo 24 meses
                </TabsTrigger>
              </TabsList>
            </Tabs>
            
            {pricingMode === "promo24" && (
              <div className="flex items-center gap-2 text-sm bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 px-4 py-2 rounded-full border border-emerald-200 dark:border-emerald-800">
                <Clock className="h-4 w-4" />
                <span>Promoción válida por {promoDaysRemaining} días más</span>
              </div>
            )}
          </div>
        )}

        {/* Pricing cards */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
          {isLoading ? (
            <>
              <PlanCardSkeleton />
              <PlanCardSkeleton />
              <PlanCardSkeleton />
            </>
          ) : (
            (plansData || []).map((planData) => (
              <PlanCard
                key={planData.plan.code}
                planData={planData}
                pricingMode={pricingMode}
                isRecommended={planData.plan.code === "PRO"}
                onSelect={handleSelectPlan}
                isLoading={isAuthenticated === null}
              />
            ))
          )}
        </div>

        {/* Price comparison table (promo mode) */}
        {pricingMode === "promo24" && !isLoading && plansData && (
          <div className="max-w-2xl mx-auto">
            <Card className="bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-center text-lg">Comparación de precios</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 font-medium">Plan</th>
                        <th className="text-right py-2 font-medium">Precio regular</th>
                        <th className="text-right py-2 font-medium text-emerald-600 dark:text-emerald-400">Precio promo</th>
                        <th className="text-right py-2 font-medium">Ahorro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plansData.map((p) => {
                        const regular = p.regularPrice?.price_cop_incl_iva || 0;
                        const intro = p.introPrice?.price_cop_incl_iva || regular;
                        const savingsPercent = regular > 0 ? Math.round((1 - intro / regular) * 100) : 0;
                        
                        return (
                          <tr key={p.plan.code} className="border-b last:border-0">
                            <td className="py-2 font-medium">{p.plan.display_name}</td>
                            <td className="py-2 text-right text-muted-foreground">{formatCOP(regular)}</td>
                            <td className="py-2 text-right text-emerald-600 dark:text-emerald-400 font-semibold">{formatCOP(intro)}</td>
                            <td className="py-2 text-right">
                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                                -{savingsPercent}%
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* CTA for non-authenticated users */}
        {isAuthenticated === false && (
          <div className="text-center py-8 border-t border-border/50">
            <div className="max-w-xl mx-auto space-y-4">
              <h2 className="text-2xl font-semibold">¿Nuevo en ATENIA?</h2>
              <p className="text-muted-foreground">
                Crea tu cuenta y comienza con acceso gratuito durante el período de gracia. 
                Sin compromiso, sin tarjeta de crédito.
              </p>
              <Button size="lg" onClick={() => navigate("/join")}>
                <Sparkles className="h-4 w-4 mr-2" />
                Comenzar ahora
              </Button>
            </div>
          </div>
        )}

        {/* FAQ section */}
        <div className="border-t border-border/50 pt-12 space-y-6">
          <h2 className="text-2xl font-semibold text-center">¿Necesitas ayuda para elegir?</h2>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-medium">Período de gracia</h3>
              <p className="text-sm text-muted-foreground">
                Acceso gratuito hasta abril 2026 para nuevos usuarios.
              </p>
            </div>
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Lock className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-medium">Precio bloqueado</h3>
              <p className="text-sm text-muted-foreground">
                Con compromiso 24 meses, bloquea el precio de lanzamiento.
              </p>
            </div>
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-medium">Enterprise</h3>
              <p className="text-sm text-muted-foreground">
                Para firmas con múltiples abogados y consola de administración.
              </p>
            </div>
          </div>
          <p className="text-center text-muted-foreground">
            Contáctanos a <a href="mailto:soporte@atenia.co" className="text-primary hover:underline">soporte@atenia.co</a> y te ayudaremos a encontrar el plan perfecto para tu firma.
          </p>
        </div>
      </div>
    </div>
  );
}
