/**
 * Platform Users Tab - Global user overview
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, UserPlus, Building2, Calendar } from "lucide-react";
import { format, subDays } from "date-fns";
import { es } from "date-fns/locale";

interface UserWithOrg {
  id: string;
  full_name: string | null;
  created_at: string;
  organization_id: string | null;
  organization_name: string | null;
  role: string | null;
}

export function PlatformUsersTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["platform-users"],
    queryFn: async () => {
      // Get all profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, created_at, organization_id")
        .order("created_at", { ascending: false });

      if (profilesError) throw profilesError;

      // Get organization names
      const { data: orgs, error: orgsError } = await supabase
        .from("organizations")
        .select("id, name");

      if (orgsError) throw orgsError;

      // Get membership roles
      const { data: memberships, error: membershipsError } = await supabase
        .from("organization_memberships")
        .select("user_id, organization_id, role");

      if (membershipsError) throw membershipsError;

      const orgMap = new Map(orgs?.map((o) => [o.id, o.name]) || []);
      const membershipMap = new Map(memberships?.map((m) => [m.user_id, m.role]) || []);

      const users: UserWithOrg[] = (profiles || []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        created_at: p.created_at,
        organization_id: p.organization_id,
        organization_name: p.organization_id ? orgMap.get(p.organization_id) || null : null,
        role: membershipMap.get(p.id) || null,
      }));

      // Stats
      const totalUsers = users.length;
      const last7Days = users.filter(
        (u) => new Date(u.created_at) > subDays(new Date(), 7)
      ).length;
      const last30Days = users.filter(
        (u) => new Date(u.created_at) > subDays(new Date(), 30)
      ).length;
      const ownersCount = users.filter((u) => u.role === "OWNER").length;

      return {
        users,
        stats: {
          totalUsers,
          last7Days,
          last30Days,
          ownersCount,
        },
      };
    },
  });

  const getRoleBadge = (role: string | null) => {
    switch (role) {
      case "OWNER":
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Owner</Badge>;
      case "ADMIN":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Admin</Badge>;
      case "MEMBER":
        return <Badge variant="outline">Member</Badge>;
      default:
        return <Badge variant="outline">Sin rol</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando usuarios...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">{data?.stats.totalUsers || 0}</div>
                <p className="text-sm text-muted-foreground">Total Usuarios</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-green-600" />
              <div>
                <div className="text-2xl font-bold">{data?.stats.last7Days || 0}</div>
                <p className="text-sm text-muted-foreground">Últimos 7 días</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              <div>
                <div className="text-2xl font-bold">{data?.stats.last30Days || 0}</div>
                <p className="text-sm text-muted-foreground">Últimos 30 días</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-amber-600" />
              <div>
                <div className="text-2xl font-bold">{data?.stats.ownersCount || 0}</div>
                <p className="text-sm text-muted-foreground">Org Owners</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Users */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            Usuarios Recientes
          </CardTitle>
          <CardDescription>
            Últimos usuarios registrados en la plataforma
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data?.users.slice(0, 20).map((user) => (
              <div
                key={user.id}
                className="p-3 border rounded-lg flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {user.full_name || "Sin nombre"}
                    </span>
                    {getRoleBadge(user.role)}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {user.organization_name || "Sin organización"}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">
                  {format(new Date(user.created_at), "dd MMM yyyy", { locale: es })}
                </span>
              </div>
            ))}

            {(!data?.users || data.users.length === 0) && (
              <p className="text-center text-muted-foreground py-8">
                No hay usuarios registrados
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* All Users */}
      <Card>
        <CardHeader>
          <CardTitle>Todos los Usuarios</CardTitle>
          <CardDescription>
            {data?.users.length || 0} usuarios totales
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {data?.users.map((user) => (
              <div
                key={user.id}
                className="p-2 border rounded flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <span>{user.full_name || "Sin nombre"}</span>
                  {getRoleBadge(user.role)}
                </div>
                <span className="text-muted-foreground">
                  {user.organization_name || "—"}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
