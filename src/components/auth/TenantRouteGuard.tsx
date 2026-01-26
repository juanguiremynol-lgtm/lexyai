/**
 * Tenant Route Guard
 * Protects /app/* routes - requires authenticated user with org membership
 * Platform admins can also access tenant routes for testing/support
 */

import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Loader2 } from "lucide-react";

interface TenantRouteGuardProps {
  children: ReactNode;
}

export function TenantRouteGuard({ children }: TenantRouteGuardProps) {
  const location = useLocation();
  const { organization, isLoading: orgLoading } = useOrganization();
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

  // Still checking auth
  if (authChecking || orgLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Verificando acceso...</p>
        </div>
      </div>
    );
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Authenticated - organization context will handle the rest
  // Platform admins can also access tenant routes
  return <>{children}</>;
}

export default TenantRouteGuard;
