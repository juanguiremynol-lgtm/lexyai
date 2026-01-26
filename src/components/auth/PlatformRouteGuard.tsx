/**
 * Platform Route Guard
 * Protects /platform/* routes - requires authenticated platform admin
 * Non-platform-admins are shown a 403 page
 * 
 * CRITICAL: This guard must be SELF-CONTAINED and deterministic.
 * It must NEVER stay in a loading state indefinitely.
 */

import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldX, ArrowLeft, Home, AlertCircle } from "lucide-react";

interface PlatformRouteGuardProps {
  children: ReactNode;
}

type GuardState = 'checking' | 'authorized' | 'forbidden' | 'error' | 'no-session';

export function PlatformRouteGuard({ children }: PlatformRouteGuardProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<GuardState>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const checkPlatformAccess = async () => {
      try {
        console.log('[PlatformRouteGuard] Starting platform admin check...');
        
        // Step 1: Get session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('[PlatformRouteGuard] Session error:', sessionError);
          if (isMounted) {
            setErrorMessage('Error al verificar sesión: ' + sessionError.message);
            setState('error');
          }
          return;
        }

        if (!session) {
          console.log('[PlatformRouteGuard] No session found');
          if (isMounted) setState('no-session');
          return;
        }

        console.log('[PlatformRouteGuard] Session found for user:', session.user.id);

        // Step 2: Check platform admin status
        const { data: adminRecord, error: adminError } = await supabase
          .from('platform_admins')
          .select('user_id, role, created_at')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (adminError) {
          console.error('[PlatformRouteGuard] Admin check error:', adminError);
          if (isMounted) {
            setErrorMessage('Error al verificar permisos: ' + adminError.message);
            setState('error');
          }
          return;
        }

        const isPlatformAdmin = !!adminRecord;
        console.log('[PlatformRouteGuard] Is platform admin:', isPlatformAdmin, adminRecord);

        if (isMounted) {
          if (isPlatformAdmin) {
            console.log('[PlatformRouteGuard] Access AUTHORIZED');
            setState('authorized');
          } else {
            console.log('[PlatformRouteGuard] Access FORBIDDEN - not a platform admin');
            setState('forbidden');
          }
        }

      } catch (err) {
        console.error('[PlatformRouteGuard] Unexpected error:', err);
        if (isMounted) {
          setErrorMessage(err instanceof Error ? err.message : 'Error desconocido');
          setState('error');
        }
      }
    };

    checkPlatformAccess();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[PlatformRouteGuard] Auth state changed:', event);
      if (event === 'SIGNED_OUT') {
        setState('no-session');
      } else if (event === 'SIGNED_IN' && session) {
        checkPlatformAccess();
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // State: Checking
  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Verificando acceso de plataforma...</p>
        </div>
      </div>
    );
  }

  // State: No session - redirect to login
  if (state === 'no-session') {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // State: Error - show error UI
  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <h2 className="text-xl font-semibold">Error de Verificación</h2>
          <p className="text-muted-foreground">
            {errorMessage || 'No se pudo verificar el acceso de plataforma.'}
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => window.location.reload()}>
              Reintentar
            </Button>
            <Button variant="outline" onClick={() => navigate('/app/dashboard')}>
              Ir al Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // State: Forbidden - show 403 page
  if (state === 'forbidden') {
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
              <Button onClick={() => navigate('/app/dashboard')} className="w-full">
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

  // State: Authorized - render children
  return <>{children}</>;
}

export default PlatformRouteGuard;
