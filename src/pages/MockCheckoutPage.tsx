import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, CreditCard, ArrowLeft, Loader2, Shield, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompleteMockCheckout } from "@/lib/billing";
import { toast } from "sonner";

/**
 * MockCheckoutPage - Simulates checkout completion for mock billing provider
 * Route: /billing/checkout/mock?session=<session_id>
 */
export default function MockCheckoutPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  
  const [sessionInfo, setSessionInfo] = useState<{
    tier: string;
    status: string;
    organization_id: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);

  const completeMockCheckout = useCompleteMockCheckout();

  // Load session info on mount
  useEffect(() => {
    document.title = "Completar pago - Andromeda";
    
    const loadSession = async () => {
      if (!sessionId) {
        toast.error("Sesión de pago no encontrada");
        navigate("/billing");
        return;
      }

      const { data: session, error } = await supabase
        .from("billing_checkout_sessions")
        .select("tier, status, organization_id")
        .eq("id", sessionId)
        .single();

      if (error || !session) {
        toast.error("Sesión de pago inválida o expirada");
        navigate("/billing");
        return;
      }

      if (session.status === "COMPLETED") {
        setIsCompleted(true);
      }

      setSessionInfo(session);
      setIsLoading(false);
    };

    loadSession();
  }, [sessionId, navigate]);

  const handleCompleteCheckout = async () => {
    if (!sessionId) return;

    try {
      await completeMockCheckout.mutateAsync({ sessionId });
      setIsCompleted(true);
      toast.success("¡Pago completado exitosamente!");
    } catch (error) {
      console.error("Checkout error:", error);
    }
  };

  const handleGoToBilling = () => {
    navigate("/settings?tab=billing");
  };

  const handleGoToDashboard = () => {
    navigate("/dashboard");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-lg">Cargando información de pago...</span>
        </div>
      </div>
    );
  }

  const tierDisplayNames: Record<string, string> = {
    BASIC: "Básico",
    PRO: "Profesional",
    ENTERPRISE: "Empresarial",
  };

  return (
    <div className="min-h-screen bg-muted/30 py-12 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Back button */}
        <Button variant="ghost" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>

        <Card className="shadow-lg">
          <CardHeader className="text-center">
            {isCompleted ? (
              <>
                <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                </div>
                <CardTitle className="text-2xl text-green-600">¡Pago completado!</CardTitle>
                <CardDescription>
                  Tu suscripción ha sido activada exitosamente
                </CardDescription>
              </>
            ) : (
              <>
                <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <CreditCard className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-2xl">Completar pago</CardTitle>
                <CardDescription>
                  Confirma tu suscripción al plan seleccionado
                </CardDescription>
              </>
            )}
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Order summary */}
            <div className="rounded-lg border p-4 space-y-3">
              <h3 className="font-semibold">Resumen del pedido</h3>
              <div className="flex items-center justify-between">
                <span>Plan {sessionInfo?.tier && tierDisplayNames[sessionInfo.tier]}</span>
                <Badge variant="secondary">{sessionInfo?.tier}</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Período de facturación</span>
                <span>Mensual</span>
              </div>
            </div>

            {/* Mock payment notice */}
            {!isCompleted && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-800">Modo demostración</p>
                    <p className="text-amber-700 mt-1">
                      Este es un checkout simulado. En producción, serás redirigido a la pasarela de pagos segura.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Security badges */}
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Lock className="h-3 w-3" />
                <span>Pago seguro</span>
              </div>
              <div className="flex items-center gap-1">
                <Shield className="h-3 w-3" />
                <span>Datos protegidos</span>
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            {isCompleted ? (
              <>
                <Button className="w-full" size="lg" onClick={handleGoToDashboard}>
                  Ir al dashboard
                </Button>
                <Button variant="outline" className="w-full" onClick={handleGoToBilling}>
                  Ver facturación
                </Button>
              </>
            ) : (
              <>
                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={handleCompleteCheckout}
                  disabled={completeMockCheckout.isPending}
                >
                  {completeMockCheckout.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Confirmar y pagar
                    </>
                  )}
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => navigate("/billing")}>
                  Cancelar
                </Button>
              </>
            )}
          </CardFooter>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Al confirmar, aceptas nuestros términos de servicio y política de privacidad.
        </p>
      </div>
    </div>
  );
}
