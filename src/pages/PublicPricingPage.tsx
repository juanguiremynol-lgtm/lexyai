import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Crown, Sparkles, Star, Zap, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { usePricingData, type PlanDisplay, type BillingTier } from "@/lib/billing";
import { toast } from "sonner";

const TIER_ICONS: Record<BillingTier, React.ReactNode> = {
  FREE_TRIAL: <Sparkles className="h-6 w-6" />,
  BASIC: <Star className="h-6 w-6" />,
  PRO: <Zap className="h-6 w-6" />,
  ENTERPRISE: <Crown className="h-6 w-6" />,
};

const TIER_COLORS: Record<BillingTier, string> = {
  FREE_TRIAL: "bg-muted text-muted-foreground",
  BASIC: "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300",
  PRO: "bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300",
  ENTERPRISE: "bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300",
};

function formatPrice(priceUsd: number): string {
  if (priceUsd === 0) return "Gratis";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(priceUsd);
}

interface PlanCardProps {
  plan: PlanDisplay;
  isRecommended?: boolean;
  onSelect: (tier: BillingTier) => void;
  isLoading?: boolean;
}

function PlanCard({ plan, isRecommended, onSelect, isLoading }: PlanCardProps) {
  const icon = TIER_ICONS[plan.tier] || <Star className="h-6 w-6" />;
  const colorClass = TIER_COLORS[plan.tier] || TIER_COLORS.BASIC;

  return (
    <Card className={cn(
      "relative flex flex-col transition-all duration-200 hover:shadow-lg",
      isRecommended && "border-primary shadow-lg ring-2 ring-primary/20 scale-[1.02]"
    )}>
      {isRecommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <Badge className="bg-primary text-primary-foreground shadow-md">
            Recomendado
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
        <CardTitle className="text-2xl">{plan.displayName}</CardTitle>
        <CardDescription className="min-h-[40px]">
          {plan.description || `Plan ${plan.displayName}`}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-6">
        <div className="text-center py-2">
          <span className="text-4xl font-bold">
            {formatPrice(plan.monthlyPriceUsd)}
          </span>
          {plan.monthlyPriceUsd > 0 && (
            <span className="text-muted-foreground text-lg">/mes</span>
          )}
        </div>

        {/* Limits */}
        <div className="space-y-2 text-sm">
          {plan.maxWorkItems !== null && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Check className="h-4 w-4 text-primary" />
              <span>Hasta {plan.maxWorkItems.toLocaleString()} procesos</span>
            </div>
          )}
          {plan.maxWorkItems === null && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Check className="h-4 w-4 text-primary" />
              <span>Procesos ilimitados</span>
            </div>
          )}
          {plan.maxClients !== null && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Check className="h-4 w-4 text-primary" />
              <span>Hasta {plan.maxClients.toLocaleString()} clientes</span>
            </div>
          )}
          {plan.maxMembers !== null && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Check className="h-4 w-4 text-primary" />
              <span>Hasta {plan.maxMembers} usuarios</span>
            </div>
          )}
          {plan.storageMb !== null && plan.storageMb > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Check className="h-4 w-4 text-primary" />
              <span>{plan.storageMb >= 1024 ? `${(plan.storageMb / 1024).toFixed(0)} GB` : `${plan.storageMb} MB`} almacenamiento</span>
            </div>
          )}
        </div>

        {/* Features */}
        {plan.features.length > 0 && (
          <ul className="space-y-2 border-t pt-4">
            {plan.features.map((feature, index) => (
              <li key={index} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CardFooter className="pt-4">
        <Button
          onClick={() => onSelect(plan.tier)}
          className="w-full"
          variant={isRecommended ? "default" : "outline"}
          size="lg"
          disabled={isLoading || plan.tier === "FREE_TRIAL"}
        >
          {plan.tier === "ENTERPRISE" ? "Contactar ventas" : 
           plan.tier === "FREE_TRIAL" ? "Plan de prueba" :
           "Elegir plan"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PlanCardSkeleton() {
  return (
    <Card className="flex flex-col">
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
  const { data: plans, isLoading } = usePricingData();

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

  const handleSelectPlan = (tier: BillingTier) => {
    if (tier === "ENTERPRISE") {
      // Open email for enterprise inquiries
      window.location.href = "mailto:ventas@atenia.co?subject=Consulta%20Plan%20Enterprise";
      return;
    }

    if (isAuthenticated === null) {
      // Still loading auth state
      return;
    }

    if (!isAuthenticated) {
      // Not logged in - redirect to auth with tier stored
      toast.info("Inicia sesión para continuar con tu suscripción");
      navigate(`/auth?next=/billing&tier=${tier}`);
      return;
    }

    if (!isOrgAdmin) {
      // Logged in but not admin
      toast.error("Solo los administradores de la organización pueden cambiar el plan");
      return;
    }

    // Logged in as admin - go to billing page
    navigate(`/billing?tier=${tier}`);
  };

  // Filter to show only commercial plans (BASIC, PRO, ENTERPRISE)
  const commercialPlans = (plans || []).filter(
    p => p.tier !== "FREE_TRIAL"
  );

  return (
    <div className="container max-w-7xl py-12 px-4 space-y-12">
      {/* Hero section */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Planes y Precios
        </h1>
        <p className="text-xl text-muted-foreground">
          Elige el plan que mejor se adapte a las necesidades de tu firma. 
          Todos los planes incluyen acceso completo a ATENIA.
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Prueba gratuita de 3 meses • Sin tarjeta de crédito</span>
        </div>
      </div>

      {/* Pricing cards */}
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
        {isLoading ? (
          <>
            <PlanCardSkeleton />
            <PlanCardSkeleton />
            <PlanCardSkeleton />
          </>
        ) : (
          commercialPlans.map((plan) => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              isRecommended={plan.tier === "PRO"}
              onSelect={handleSelectPlan}
              isLoading={isAuthenticated === null}
            />
          ))
        )}
      </div>

      {/* CTA for non-authenticated users */}
      {isAuthenticated === false && (
        <div className="text-center py-8 border-t">
          <div className="max-w-xl mx-auto space-y-4">
            <h2 className="text-2xl font-semibold">¿Nuevo en ATENIA?</h2>
            <p className="text-muted-foreground">
              Crea tu cuenta y comienza con una prueba gratuita de 3 meses. 
              Sin compromiso, sin tarjeta de crédito.
            </p>
            <Button size="lg" onClick={() => navigate("/auth?signup=true")}>
              <Sparkles className="h-4 w-4 mr-2" />
              Comenzar prueba gratuita
            </Button>
          </div>
        </div>
      )}

      {/* FAQ section */}
      <div className="border-t pt-12 space-y-6">
        <h2 className="text-2xl font-semibold text-center">¿Necesitas ayuda para elegir?</h2>
        <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-medium">Prueba gratuita</h3>
            <p className="text-sm text-muted-foreground">
              3 meses para probar todas las funcionalidades sin compromiso.
            </p>
          </div>
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-medium">Sin contratos</h3>
            <p className="text-sm text-muted-foreground">
              Paga mes a mes. Cancela cuando quieras.
            </p>
          </div>
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-medium">Soporte incluido</h3>
            <p className="text-sm text-muted-foreground">
              Todos los planes incluyen soporte por correo electrónico.
            </p>
          </div>
        </div>
        <p className="text-center text-muted-foreground">
          Contáctanos a <a href="mailto:soporte@atenia.co" className="text-primary hover:underline">soporte@atenia.co</a> y te ayudaremos a encontrar el plan perfecto para tu firma.
        </p>
      </div>
    </div>
  );
}
