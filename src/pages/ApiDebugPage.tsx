/**
 * API Debug Page - Consolidated Debug Console
 * 
 * This page now uses the unified SuperDebugConsole which includes:
 * - Integration status (secrets, provider health)
 * - API testing per provider
 * - Full sync debugging (actuaciones + publicaciones)
 * - History/audit logs
 * - Email gateway status
 * - Master Sync (Super Admin only)
 * 
 * Access: Platform Admin or Org Admin only
 */

import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { SuperDebugConsole } from "@/components/platform/super-debug";
import { Card, CardContent } from "@/components/ui/card";
import { Shield } from "lucide-react";

export default function ApiDebugPage() {
  const { isPlatformAdmin, isLoading } = usePlatformAdmin();

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Verificando permisos...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="py-8 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Acceso Restringido</h2>
            <p className="text-muted-foreground">
              Esta página requiere permisos de administrador de plataforma.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <SuperDebugConsole />
    </div>
  );
}
