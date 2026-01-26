/**
 * Tenant Route Guard
 * Protects /app/* routes - requires authenticated user
 * Platform admins can also access tenant routes for testing/support
 * 
 * CRITICAL: This guard must be SELF-CONTAINED and not depend on providers
 * that are mounted inside the protected route tree.
 */

import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TenantRouteGuardProps {
  children: ReactNode;
}

type GuardState = 'checking' | 'authorized' | 'unauthorized' | 'error' | 'no-session';

export function TenantRouteGuard({ children }: TenantRouteGuardProps) {
  const location = useLocation();
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

        // Step 2: For tenant routes, we just need a valid session
        // The OrganizationProvider inside will handle org-specific logic
        // Platform admins AND regular users with org membership can access
        
        // We do a lightweight check to see if user has any org access
        // This is optional but helps show better error messages
        const { data: memberships, error: membershipError } = await supabase
          .from('organization_memberships')
          .select('id')
          .eq('user_id', session.user.id)
          .limit(1);

        if (membershipError) {
          console.warn('[TenantRouteGuard] Membership check failed:', membershipError.message);
          // Don't block access - let the app handle this gracefully
        }

        const hasMembership = memberships && memberships.length > 0;
        console.log('[TenantRouteGuard] Has org membership:', hasMembership);

        // Check if platform admin (they can always access tenant routes)
        const { data: adminRecord } = await supabase
          .from('platform_admins')
          .select('user_id')
          .eq('user_id', session.user.id)
          .maybeSingle();

        const isPlatformAdmin = !!adminRecord;
        console.log('[TenantRouteGuard] Is platform admin:', isPlatformAdmin);

        // Authorize if: has org membership OR is platform admin
        // Even without membership, allow access - the app will guide them to onboarding
        if (isMounted) {
          console.log('[TenantRouteGuard] Access AUTHORIZED');
          setState('authorized');
        }

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
