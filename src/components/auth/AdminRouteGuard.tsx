/**
 * Admin Route Guard - Protects admin routes from unauthorized access
 * Only OWNER and ADMIN roles can access admin pages
 */

import { ReactNode } from "react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Lock, ArrowLeft, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface AdminRouteGuardProps {
  children: ReactNode;
  fallbackPath?: string;
}

export function AdminRouteGuard({ children, fallbackPath = "/dashboard" }: AdminRouteGuardProps) {
  const navigate = useNavigate();
  const { organization, isLoading: orgLoading } = useOrganization();
  const { isAdmin, isLoading: membershipLoading } = useOrganizationMembership(organization?.id || null);

  // Loading state
  if (orgLoading || membershipLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Verificando permisos...</p>
        </div>
      </div>
    );
  }

  // Access denied
  if (!isAdmin) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <Lock className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle className="text-2xl">Acceso Denegado</CardTitle>
            <CardDescription className="text-base">
              No tienes permisos para acceder a esta página.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">Acceso restringido a administradores</p>
                  <p className="text-muted-foreground">
                    Solo los propietarios y administradores de la organización pueden acceder a esta sección.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={() => navigate(fallbackPath)} className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver al Dashboard
              </Button>
              <Button variant="outline" onClick={() => navigate(-1)} className="w-full">
                Regresar a la página anterior
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Access granted
  return <>{children}</>;
}

export default AdminRouteGuard;
