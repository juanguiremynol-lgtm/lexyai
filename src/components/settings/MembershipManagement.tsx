import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Users, Shield, Crown, User, Trash2, UserPlus } from 'lucide-react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useOrganizationMembership, MembershipRole } from '@/hooks/use-organization-membership';
import { Skeleton } from '@/components/ui/skeleton';

const ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: 'Propietario',
  ADMIN: 'Administrador',
  MEMBER: 'Miembro',
};

const ROLE_COLORS: Record<MembershipRole, string> = {
  OWNER: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  ADMIN: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  MEMBER: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
};

const ROLE_ICONS: Record<MembershipRole, typeof Crown> = {
  OWNER: Crown,
  ADMIN: Shield,
  MEMBER: User,
};

export function MembershipManagement() {
  const { organization } = useOrganization();
  const {
    memberships,
    isLoading,
    currentUserRole,
    isOwner,
    isAdmin,
    updateMemberRole,
    removeMember,
  } = useOrganizationMembership(organization?.id || null);

  // Fetch user details for memberships
  const { data: memberDetails } = useQuery({
    queryKey: ['membership-details', memberships.map(m => m.user_id)],
    queryFn: async () => {
      if (memberships.length === 0) return {};

      // Get profiles for all members
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url, auth_provider')
        .in('id', memberships.map(m => m.user_id));

      const detailsMap: Record<string, { full_name: string | null; email: string | null; avatar_url: string | null; auth_provider: string | null }> = {};
      
      (data || []).forEach((p) => {
        detailsMap[p.id] = { full_name: p.full_name, email: p.email, avatar_url: p.avatar_url, auth_provider: p.auth_provider };
      });

      return detailsMap;
    },
    enabled: memberships.length > 0,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Miembros de la Organización
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle>Miembros de la Organización</CardTitle>
          </div>
          {isAdmin && (
            <Button variant="outline" size="sm" disabled>
              <UserPlus className="h-4 w-4 mr-2" />
              Invitar (próximamente)
            </Button>
          )}
        </div>
        <CardDescription>
          Gestiona los usuarios que tienen acceso a esta organización
        </CardDescription>
      </CardHeader>
      <CardContent>
        {memberships.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No hay miembros en esta organización.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Desde</TableHead>
                {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberships.map((membership) => {
                const details = memberDetails?.[membership.user_id];
                const RoleIcon = ROLE_ICONS[membership.role as MembershipRole];
                const isCurrentUser = membership.user_id === (supabase as any).auth.user?.()?.id;
                const canModify = isOwner || (isAdmin && membership.role === 'MEMBER');
                const canRemove = canModify && !isCurrentUser && membership.role !== 'OWNER';

                return (
                    <TableRow key={membership.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {details?.avatar_url ? (
                            <img
                              src={details.avatar_url}
                              alt=""
                              className="h-8 w-8 rounded-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                              <User className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium">
                              {details?.full_name || 'Usuario'}
                              {isCurrentUser && (
                                <span className="text-muted-foreground ml-2 text-sm">(tú)</span>
                              )}
                            </p>
                            {details?.email && (
                              <p className="text-sm text-muted-foreground">{details.email}</p>
                            )}
                            {details?.auth_provider && details.auth_provider !== 'email' && (
                              <span className="text-xs text-muted-foreground capitalize">vía {details.auth_provider}</span>
                            )}
                          </div>
                        </div>
                    </TableCell>
                    <TableCell>
                      {canModify && membership.role !== 'OWNER' ? (
                        <Select
                          value={membership.role}
                          onValueChange={(value) => {
                            updateMemberRole.mutate({
                              membershipId: membership.id,
                              newRole: value as MembershipRole,
                            });
                          }}
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ADMIN">Administrador</SelectItem>
                            <SelectItem value="MEMBER">Miembro</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge className={ROLE_COLORS[membership.role as MembershipRole]}>
                          <RoleIcon className="h-3 w-3 mr-1" />
                          {ROLE_LABELS[membership.role as MembershipRole]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(membership.created_at).toLocaleDateString('es-CO')}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {canRemove && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remover Miembro</AlertDialogTitle>
                                <AlertDialogDescription>
                                  ¿Estás seguro de que deseas remover a este usuario de la organización?
                                  Perderá acceso a todos los datos.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => removeMember.mutate({ membershipId: membership.id, targetUserId: membership.user_id })}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remover
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Role explanation */}
        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <h4 className="font-medium text-sm mb-3">Permisos por Rol</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-600" />
                <span className="font-medium">Propietario</span>
              </div>
              <p className="text-muted-foreground text-xs">
                Acceso completo, gestión de suscripción y miembros
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-purple-600" />
                <span className="font-medium">Administrador</span>
              </div>
              <p className="text-muted-foreground text-xs">
                Gestión de miembros, acceso a configuración
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-blue-600" />
                <span className="font-medium">Miembro</span>
              </div>
              <p className="text-muted-foreground text-xs">
                Acceso a datos, sin permisos administrativos
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
