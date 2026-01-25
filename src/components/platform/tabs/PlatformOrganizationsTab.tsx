/**
 * Platform Organizations Tab - View and manage all organizations
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, Calendar, Crown } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface OrganizationWithStats {
  id: string;
  name: string;
  slug: string | null;
  created_at: string;
  is_active: boolean;
  member_count: number;
  subscription_status: string | null;
  trial_ends_at: string | null;
}

export function PlatformOrganizationsTab() {
  const { data: organizations, isLoading } = useQuery({
    queryKey: ["platform-organizations"],
    queryFn: async () => {
      // Fetch all organizations
      const { data: orgs, error: orgsError } = await supabase
        .from("organizations")
        .select("*")
        .order("created_at", { ascending: false });

      if (orgsError) throw orgsError;

      // Fetch member counts for each org
      const { data: memberships, error: membershipsError } = await supabase
        .from("organization_memberships")
        .select("organization_id");

      if (membershipsError) throw membershipsError;

      // Fetch subscription info
      const { data: subscriptions, error: subsError } = await supabase
        .from("subscriptions")
        .select("organization_id, status, trial_ends_at");

      if (subsError) throw subsError;

      // Combine data
      const memberCounts = new Map<string, number>();
      memberships?.forEach((m) => {
        const count = memberCounts.get(m.organization_id) || 0;
        memberCounts.set(m.organization_id, count + 1);
      });

      const subscriptionMap = new Map<string, { status: string; trial_ends_at: string | null }>();
      subscriptions?.forEach((s) => {
        subscriptionMap.set(s.organization_id, { status: s.status, trial_ends_at: s.trial_ends_at });
      });

      return (orgs || []).map((org) => ({
        ...org,
        member_count: memberCounts.get(org.id) || 0,
        subscription_status: subscriptionMap.get(org.id)?.status || null,
        trial_ends_at: subscriptionMap.get(org.id)?.trial_ends_at || null,
      })) as OrganizationWithStats[];
    },
  });

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Activo</Badge>;
      case "trialing":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Prueba</Badge>;
      case "past_due":
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Suspendido</Badge>;
      case "expired":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Expirado</Badge>;
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Todas las Organizaciones
          </CardTitle>
          <CardDescription>
            {organizations?.length || 0} organizaciones registradas en la plataforma
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {organizations?.map((org) => (
              <div
                key={org.id}
                className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{org.name}</h4>
                      {getStatusBadge(org.subscription_status)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {org.slug ? `@${org.slug}` : "Sin slug"}
                    </p>
                  </div>
                  <div className="flex items-center gap-6 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      <span>{org.member_count} miembros</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>
                        {format(new Date(org.created_at), "dd MMM yyyy", { locale: es })}
                      </span>
                    </div>
                    {org.trial_ends_at && org.subscription_status === "trialing" && (
                      <div className="flex items-center gap-1">
                        <Crown className="h-4 w-4" />
                        <span>
                          Prueba hasta {format(new Date(org.trial_ends_at), "dd MMM", { locale: es })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {(!organizations || organizations.length === 0) && (
              <p className="text-center text-muted-foreground py-8">
                No hay organizaciones registradas
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{organizations?.length || 0}</div>
            <p className="text-sm text-muted-foreground">Total Organizaciones</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">
              {organizations?.filter((o) => o.subscription_status === "active").length || 0}
            </div>
            <p className="text-sm text-muted-foreground">Suscripciones Activas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">
              {organizations?.filter((o) => o.subscription_status === "trialing").length || 0}
            </div>
            <p className="text-sm text-muted-foreground">En Prueba</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">
              {organizations?.reduce((sum, o) => sum + o.member_count, 0) || 0}
            </div>
            <p className="text-sm text-muted-foreground">Total Usuarios</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
