/**
 * Tenant Route Guard
 * Protects /app/* routes - requires authenticated user with org membership
 * Platform admins can also access tenant routes for testing/support
 * 
 * CRITICAL: This guard must be SELF-CONTAINED and not depend on providers
 * that are mounted inside the protected route tree.
 * 
 * States:
 * - checking: Verifying auth and membership
 * - authorized: User has access (has org membership or is platform admin)
 * - no-session: Not authenticated -> redirect to login
 * - no-org-access: Authenticated but no org membership -> show error page
 * - error: Unexpected error -> show retry UI
 */

import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle, Building2, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface TenantRouteGuardProps {
  children: ReactNode;
}

type GuardState = 'checking' | 'authorized' | 'unauthorized' | 'error' | 'no-session' | 'no-org-access' | 'profile-incomplete';

export function TenantRouteGuard({ children }: TenantRouteGuardProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<GuardState>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const checkAccess = async () => {
      try {
        console.log('[TenantRouteGuard] Starting access check...');
        
        // Step 1: Get session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('[TenantRouteGuard] Session error:', sessionError);
          if (isMounted) {
            setErrorMessage('Error al verificar sesión: ' + sessionError.message);
            setState('error');
          }
          return;
        }

        if (!session) {
          console.log('[TenantRouteGuard] No session found, redirecting to login');
          if (isMounted) setState('no-session');
          return;
        }

        console.log('[TenantRouteGuard] Session found for user:', session.user.id);

        // Step 2: Check if platform admin (they can always access tenant routes)
        const { data: adminRecord } = await supabase
          .from('platform_admins')
          .select('user_id')
          .eq('user_id', session.user.id)
          .maybeSingle();

        const isPlatformAdmin = !!adminRecord;
        console.log('[TenantRouteGuard] Is platform admin:', isPlatformAdmin);

        if (isPlatformAdmin) {
          // Platform admins always have access
          console.log('[TenantRouteGuard] Access AUTHORIZED (platform admin)');
          if (isMounted) setState('authorized');
          return;
        }

        // Step 3: Check org membership (required for non-platform-admins)
        const { data: memberships, error: membershipError } = await supabase
          .from('organization_memberships')
          .select('id, organization_id')
          .eq('user_id', session.user.id)
          .limit(1);

        if (membershipError) {
          console.error('[TenantRouteGuard] Membership check failed:', membershipError.message);
          if (isMounted) {
            setErrorMessage('Error al verificar membresías: ' + membershipError.message);
            setState('error');
          }
          return;
        }

        const hasMembership = memberships && memberships.length > 0;
        console.log('[TenantRouteGuard] Has org membership:', hasMembership);

        if (!hasMembership) {
          // No org access - show dedicated error page
          console.log('[TenantRouteGuard] Access DENIED - no organization membership');
          if (isMounted) setState('no-org-access');
          return;
        }

        // Step 4: Check profile completion (non-platform-admins must complete profile)
        const { data: profile } = await supabase
          .from('profiles')
          .select('profile_completed_at')
          .eq('id', session.user.id)
          .maybeSingle();

        if (!profile?.profile_completed_at) {
          console.log('[TenantRouteGuard] Profile INCOMPLETE - redirecting to onboarding');
          if (isMounted) setState('profile-incomplete');
          return;
        }

        // Authorized - has org membership + complete profile
        console.log('[TenantRouteGuard] Access AUTHORIZED (org member, profile complete)');
        if (isMounted) setState('authorized');

      } catch (err) {
        console.error('[TenantRouteGuard] Unexpected error:', err);
        if (isMounted) {
          setErrorMessage(err instanceof Error ? err.message : 'Error desconocido');
          setState('error');
        }
      }
    };

    checkAccess();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[TenantRouteGuard] Auth state changed:', event);
      if (event === 'SIGNED_OUT') {
        setState('no-session');
      } else if (event === 'SIGNED_IN' && session) {
        // Re-check access on sign in
        checkAccess();
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
          <p className="text-muted-foreground">Verificando acceso...</p>
        </div>
      </div>
    );
  }

  // State: No session - redirect to login
  if (state === 'no-session') {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // State: Profile incomplete - redirect to onboarding
  if (state === 'profile-incomplete') {
    return <Navigate to="/onboarding/profile" state={{ from: location }} replace />;
  }

  // State: No organization access - show dedicated error page
  if (state === 'no-org-access') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl">Sin Acceso a Organización</CardTitle>
            <CardDescription className="text-base">
              Tu cuenta no pertenece a ninguna organización activa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <p className="text-sm text-muted-foreground">
                Para acceder a ATENIA necesitas:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>Recibir una invitación de un administrador existente</li>
                <li>O crear una nueva organización desde tu perfil</li>
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={() => navigate('/')} className="w-full">
                <Home className="h-4 w-4 mr-2" />
                Ir al Inicio
              </Button>
              <Button variant="outline" onClick={() => navigate(-1)} className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Button>
              <Button 
                variant="ghost" 
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate('/auth');
                }}
                className="w-full text-muted-foreground"
              >
                Cerrar Sesión
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // State: Error - show error UI with retry
  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <h2 className="text-xl font-semibold">Error de Verificación</h2>
          <p className="text-muted-foreground">
            {errorMessage || 'No se pudo verificar el acceso. Por favor intenta de nuevo.'}
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => window.location.reload()}>
              Reintentar
            </Button>
            <Button variant="outline" onClick={() => window.location.href = '/auth'}>
              Ir a Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // State: Authorized - render children
  return <>{children}</>;
}

export default TenantRouteGuard;
