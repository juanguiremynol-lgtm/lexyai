/**
 * Platform Route Guard
 * Protects /platform/* routes - requires authenticated platform admin
 * Non-platform-admins are shown a 403 page or redirected
 */

import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldX, ArrowLeft, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PlatformRouteGuardProps {
  children: ReactNode;
}

export function PlatformRouteGuard({ children }: PlatformRouteGuardProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isPlatformAdmin, isLoading: adminLoading } = usePlatformAdmin();
  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
      setAuthChecking(false);
    };
    
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setIsAuthenticated(!!session);
      setAuthChecking(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Still checking auth or admin status
  if (authChecking || adminLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Verificando acceso de plataforma...</p>
        </div>
      </div>
    );
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Authenticated but NOT platform admin - show 403
  if (!isPlatformAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <ShieldX className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-2xl">Acceso Denegado</CardTitle>
            <CardDescription className="text-base">
              La Consola de Plataforma está reservada exclusivamente para administradores del sistema ATENIA.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">
                <strong>Error 403:</strong> No tienes permisos de administrador de plataforma para acceder a esta sección.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={() => navigate("/app/dashboard")} className="w-full">
                <Home className="h-4 w-4 mr-2" />
                Ir al Dashboard
              </Button>
              <Button variant="outline" onClick={() => navigate(-1)} className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Platform admin - allow access
  return <>{children}</>;
}

export default PlatformRouteGuard;
