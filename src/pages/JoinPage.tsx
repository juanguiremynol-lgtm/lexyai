import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { User, Building2, ArrowRight, Sparkles, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useGraceEnroll } from "@/lib/billing";
import {
  TRIAL_DURATION_MONTHS,
  BETA_DISCOUNT_MONTHLY_PERCENT,
  BETA_DISCOUNT_ANNUAL_PERCENT,
} from "@/lib/billing/pricing-windows";
import type { AccountType } from "@/types/billing";
import { toast } from "sonner";

export default function JoinPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [accountType, setAccountType] = useState<AccountType>("INDIVIDUAL");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const graceEnroll = useGraceEnroll();

  useEffect(() => {
    document.title = "Únete a Andromeda";
    
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
      
      if (session) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("organization_id")
          .eq("id", session.user.id)
          .single();
        
        if (profile?.organization_id) {
          setOrganizationId(profile.organization_id);
        }
      }
    };
    
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setIsAuthenticated(!!session);
      if (session) {
        checkAuth();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleContinue = async () => {
    if (!isAuthenticated) {
      navigate(`/auth?next=/join/start&accountType=${accountType}`);
      return;
    }

    if (!organizationId) {
      toast.error("No se encontró tu organización");
      return;
    }

    setIsLoading(true);
    try {
      const result = await graceEnroll.mutateAsync({
        organizationId,
        accountType,
      });

      if (result.ok) {
        toast.success("¡Bienvenido a Andromeda!", {
          description: `Tu prueba gratuita de ${TRIAL_DURATION_MONTHS} meses ha sido activada.`,
        });
        navigate("/dashboard");
      }
    } catch (error) {
      console.error("Trial enroll error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Únete a Andromeda
          </h1>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            La plataforma de gestión legal inteligente, impulsada por Andro IA.
          </p>
        </div>

        {/* Beta trial banner */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-center space-y-1">
          <p className="text-primary font-medium">
            🎉 Prueba beta gratuita de {TRIAL_DURATION_MONTHS} meses
          </p>
          <p className="text-sm text-muted-foreground">
            Sin tarjeta de crédito. Después: {BETA_DISCOUNT_MONTHLY_PERCENT}% off mensual, {BETA_DISCOUNT_ANNUAL_PERCENT}% off anual.
          </p>
        </div>

        {/* Account type selection */}
        <Card className="bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Elige tu tipo de cuenta</CardTitle>
            <CardDescription>
              Selecciona la opción que mejor describe tu situación profesional.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <RadioGroup 
              value={accountType} 
              onValueChange={(v) => setAccountType(v as AccountType)}
              className="grid md:grid-cols-2 gap-4"
            >
              {/* Individual option */}
              <div 
                className={cn(
                  "relative border-2 rounded-lg p-6 cursor-pointer transition-all",
                  accountType === "INDIVIDUAL" 
                    ? "border-primary bg-primary/5" 
                    : "border-border hover:border-primary/50"
                )}
                onClick={() => setAccountType("INDIVIDUAL")}
              >
                <RadioGroupItem value="INDIVIDUAL" id="individual" className="sr-only" />
                <Label htmlFor="individual" className="cursor-pointer block space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                      <User className="h-6 w-6 text-blue-600 dark:text-blue-300" />
                    </div>
                    <div>
                      <p className="font-semibold text-lg">Individual</p>
                      <p className="text-sm text-muted-foreground">Abogado independiente</p>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      1 usuario
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Procesos ilimitados
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Planes BASIC o PRO
                    </li>
                  </ul>
                </Label>
              </div>

              {/* Firm option */}
              <div 
                className={cn(
                  "relative border-2 rounded-lg p-6 cursor-pointer transition-all",
                  accountType === "FIRM" 
                    ? "border-primary bg-primary/5" 
                    : "border-border hover:border-primary/50"
                )}
                onClick={() => setAccountType("FIRM")}
              >
                <RadioGroupItem value="FIRM" id="firm" className="sr-only" />
                <Label htmlFor="firm" className="cursor-pointer block space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                      <Building2 className="h-6 w-6 text-amber-600 dark:text-amber-300" />
                    </div>
                    <div>
                      <p className="font-semibold text-lg">Firma</p>
                      <p className="text-sm text-muted-foreground">Equipo de abogados</p>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Múltiples usuarios
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Consola de administración
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      Acceso a plan ENTERPRISE
                    </li>
                  </ul>
                </Label>
              </div>
            </RadioGroup>

            <Button 
              onClick={handleContinue} 
              size="lg" 
              className="w-full"
              disabled={isLoading || graceEnroll.isPending}
            >
              {isLoading || graceEnroll.isPending ? (
                "Procesando..."
              ) : isAuthenticated ? (
                <>
                  Activar prueba gratuita
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              ) : (
                <>
                  Continuar
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>

            {!isAuthenticated && (
              <p className="text-center text-sm text-muted-foreground">
                ¿Ya tienes cuenta?{" "}
                <Button variant="link" className="p-0 h-auto" onClick={() => navigate("/auth")}>
                  Inicia sesión
                </Button>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-sm text-muted-foreground">
          Al continuar, aceptas nuestros{" "}
          <a href="#" className="text-primary hover:underline">términos de servicio</a>
          {" "}y{" "}
          <a href="#" className="text-primary hover:underline">política de privacidad</a>.
        </p>
      </div>
    </div>
  );
}
