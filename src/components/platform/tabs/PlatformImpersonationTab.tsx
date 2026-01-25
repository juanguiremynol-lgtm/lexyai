/**
 * Platform Impersonation Tab - Read-only support mode
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { 
  Eye, 
  Building2,
  Users,
  AlertTriangle,
  Search,
  LogIn,
  LogOut
} from "lucide-react";
import { useState } from "react";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface OrganizationForSupport {
  id: string;
  name: string;
  slug: string | null;
  created_at: string;
  member_count: number;
  subscription_status: string | null;
}

export function PlatformImpersonationTab() {
  const [searchTerm, setSearchTerm] = useState("");
  const { isImpersonating, impersonatedOrg, enterImpersonation, exitImpersonation } = useImpersonation();

  // Fetch organizations
  const { data: organizations, isLoading } = useQuery({
    queryKey: ["platform-orgs-for-impersonation"],
    queryFn: async () => {
      const { data: orgs, error } = await supabase
        .from("organizations")
        .select("*")
        .order("name");

      if (error) throw error;

      // Get member counts
      const { data: memberships } = await supabase
        .from("organization_memberships")
        .select("organization_id");

      const memberCounts = new Map<string, number>();
      memberships?.forEach((m) => {
        const count = memberCounts.get(m.organization_id) || 0;
        memberCounts.set(m.organization_id, count + 1);
      });

      // Get subscription statuses
      const { data: subs } = await supabase
        .from("subscriptions")
        .select("organization_id, status");

      const subMap = new Map(subs?.map((s) => [s.organization_id, s.status]));

      return orgs?.map((org) => ({
        ...org,
        member_count: memberCounts.get(org.id) || 0,
        subscription_status: subMap.get(org.id) || null,
      })) as OrganizationForSupport[];
    },
  });

  const filteredOrgs = organizations?.filter((org) =>
    org.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    org.slug?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-800">Activo</Badge>;
      case "trialing":
        return <Badge className="bg-blue-100 text-blue-800">Prueba</Badge>;
      case "past_due":
        return <Badge className="bg-amber-100 text-amber-800">Suspendido</Badge>;
      case "expired":
        return <Badge className="bg-red-100 text-red-800">Expirado</Badge>;
      default:
        return <Badge variant="outline">Sin suscripción</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando organizaciones...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Warning Banner */}
      <Alert variant="default" className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-800 dark:text-amber-200">Modo Soporte</AlertTitle>
        <AlertDescription className="text-amber-700 dark:text-amber-300">
          La impersonación permite ver datos de una organización como si fueras miembro.
          <strong> Todas las mutaciones están bloqueadas.</strong>
          {" "}Cada entrada y salida queda registrada en auditoría.
        </AlertDescription>
      </Alert>

      {/* Active Impersonation */}
      {isImpersonating && impersonatedOrg && (
        <Card className="border-primary">
          <CardHeader className="bg-primary/5">
            <CardTitle className="flex items-center gap-2 text-primary">
              <Eye className="h-5 w-5" />
              Modo Soporte Activo
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{impersonatedOrg.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Navegue la aplicación para ver datos de esta organización
                  </p>
                </div>
              </div>
              <Button
                variant="destructive"
                onClick={exitImpersonation}
                className="gap-2"
              >
                <LogOut className="h-4 w-4" />
                Salir del Modo Soporte
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Organization Selector */}
      {!isImpersonating && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Seleccionar Organización
            </CardTitle>
            <CardDescription>
              Elija una organización para entrar en modo de soporte (solo lectura)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o slug..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Organizations List */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredOrgs?.map((org) => (
                <div
                  key={org.id}
                  className="p-3 border rounded-lg hover:bg-muted/50 transition-colors flex items-center justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{org.name}</span>
                      {getStatusBadge(org.subscription_status)}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                      {org.slug && <span>@{org.slug}</span>}
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {org.member_count} miembros
                      </span>
                      <span>
                        Creada: {format(new Date(org.created_at), "dd MMM yyyy", { locale: es })}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => enterImpersonation({ id: org.id, name: org.name })}
                    className="gap-2 shrink-0"
                  >
                    <LogIn className="h-4 w-4" />
                    Entrar
                  </Button>
                </div>
              ))}

              {filteredOrgs?.length === 0 && (
                <p className="text-center text-muted-foreground py-4">
                  No se encontraron organizaciones
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Instrucciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <strong>1.</strong> Seleccione una organización de la lista para entrar en modo soporte.
          </p>
          <p>
            <strong>2.</strong> Navegue por la aplicación normalmente. Verá los datos de esa organización.
          </p>
          <p>
            <strong>3.</strong> Todos los botones de crear, editar y eliminar estarán deshabilitados.
          </p>
          <p>
            <strong>4.</strong> Un banner permanente indicará que está en modo soporte.
          </p>
          <p>
            <strong>5.</strong> Para salir, use el botón "Salir del Modo Soporte" o regrese a esta página.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
