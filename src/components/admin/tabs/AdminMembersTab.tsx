/**
 * Admin Members Tab - Enhanced member management with transfer ownership
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  Users, 
  Shield, 
  Crown, 
  User, 
  Trash2, 
  ArrowRightLeft,
  Building2,
  Loader2,
  Save
} from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership, MembershipRole } from "@/hooks/use-organization-membership";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { logAudit } from "@/lib/audit-log";

const ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  MEMBER: "Miembro",
};

const ROLE_COLORS: Record<MembershipRole, string> = {
  OWNER: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  ADMIN: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  MEMBER: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};

const ROLE_ICONS: Record<MembershipRole, typeof Crown> = {
  OWNER: Crown,
  ADMIN: Shield,
  MEMBER: User,
};

export function AdminMembersTab() {
  const queryClient = useQueryClient();
  const { organization, refetch: refetchOrg } = useOrganization();
  const {
    memberships,
    isLoading,
    isOwner,
    isAdmin,
    updateMemberRole,
    removeMember,
  } = useOrganizationMembership(organization?.id || null);

  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [selectedNewOwner, setSelectedNewOwner] = useState<string | null>(null);
  const [confirmTransfer, setConfirmTransfer] = useState("");

  // Organization settings form
  const [orgName, setOrgName] = useState(organization?.name || "");
  const [orgTimezone, setOrgTimezone] = useState("America/Bogota");

  // Fetch user details for memberships
  const { data: memberDetails } = useQuery({
    queryKey: ["membership-details-admin", memberships.map(m => m.user_id)],
    queryFn: async () => {
      if (memberships.length === 0) return {};

      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", memberships.map(m => m.user_id));

      const detailsMap: Record<string, { full_name: string | null }> = {};
      (data || []).forEach((p) => {
        detailsMap[p.id] = { full_name: p.full_name };
      });

      return detailsMap;
    },
    enabled: memberships.length > 0,
  });

  // Transfer ownership mutation
  const transferOwnership = useMutation({
    mutationFn: async (newOwnerId: string) => {
      if (!organization?.id) throw new Error("No organization");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Update new owner's role to OWNER
      const { error: newOwnerError } = await supabase
        .from("organization_memberships")
        .update({ role: "OWNER" })
        .eq("organization_id", organization.id)
        .eq("user_id", newOwnerId);

      if (newOwnerError) throw newOwnerError;

      // Demote current owner to ADMIN
      const { error: demoteError } = await supabase
        .from("organization_memberships")
        .update({ role: "ADMIN" })
        .eq("organization_id", organization.id)
        .eq("user_id", user.id);

      if (demoteError) throw demoteError;

      // Log audit
      await logAudit({
        organizationId: organization.id,
        action: "OWNERSHIP_TRANSFERRED",
        entityType: "organization",
        entityId: organization.id,
        metadata: { newOwnerId, previousOwnerId: user.id },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-memberships"] });
      queryClient.invalidateQueries({ queryKey: ["current-user-role"] });
      toast.success("Propiedad transferida exitosamente");
      setTransferDialogOpen(false);
      setSelectedNewOwner(null);
      setConfirmTransfer("");
    },
    onError: (error: Error) => {
      toast.error("Error al transferir: " + error.message);
    },
  });

  // Update organization settings
  const updateOrganization = useMutation({
    mutationFn: async (updates: { name?: string }) => {
      if (!organization?.id) throw new Error("No organization");

      const { error } = await supabase
        .from("organizations")
        .update(updates)
        .eq("id", organization.id);

      if (error) throw error;

      await logAudit({
        organizationId: organization.id,
        action: "ORGANIZATION_UPDATED",
        entityType: "organization",
        entityId: organization.id,
        metadata: updates,
      });
    },
    onSuccess: () => {
      refetchOrg();
      toast.success("Configuración guardada");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const eligibleForTransfer = memberships.filter(
    m => m.role !== "OWNER" && memberDetails?.[m.user_id]?.full_name
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Organization Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Configuración de la Organización
          </CardTitle>
          <CardDescription>
            Edita el nombre y configuración de tu organización
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="orgName">Nombre de la Organización</Label>
              <Input
                id="orgName"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Mi Firma Jurídica"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Zona Horaria</Label>
              <Select value={orgTimezone} onValueChange={setOrgTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/Bogota">Colombia (GMT-5)</SelectItem>
                  <SelectItem value="America/New_York">Nueva York (GMT-5/-4)</SelectItem>
                  <SelectItem value="America/Mexico_City">México (GMT-6)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={() => updateOrganization.mutate({ name: orgName })}
            disabled={updateOrganization.isPending || orgName === organization?.name}
          >
            {updateOrganization.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Guardar Cambios
          </Button>
        </CardContent>
      </Card>

      {/* Members Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <CardTitle>Miembros ({memberships.length})</CardTitle>
            </div>
            {isOwner && eligibleForTransfer.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTransferDialogOpen(true)}
              >
                <ArrowRightLeft className="h-4 w-4 mr-2" />
                Transferir Propiedad
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
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.map((membership) => {
                  const details = memberDetails?.[membership.user_id];
                  const RoleIcon = ROLE_ICONS[membership.role as MembershipRole];
                  const canModify = isOwner || (isAdmin && membership.role === "MEMBER");
                  const canRemove = canModify && membership.role !== "OWNER";

                  return (
                    <TableRow key={membership.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                            <User className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium">
                              {details?.full_name || "Usuario"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canModify && membership.role !== "OWNER" ? (
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
                        {new Date(membership.created_at).toLocaleDateString("es-CO")}
                      </TableCell>
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
                                  ¿Estás seguro? El usuario perderá acceso a todos los datos.
                                  Esta acción quedará registrada en el historial de auditoría.
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
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Transfer Ownership Dialog */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Transferir Propiedad
            </DialogTitle>
            <DialogDescription>
              Transfiere la propiedad de la organización a otro miembro. 
              Tú pasarás a ser Administrador.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nuevo Propietario</Label>
              <Select value={selectedNewOwner || ""} onValueChange={setSelectedNewOwner}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un miembro" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleForTransfer.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberDetails?.[m.user_id]?.full_name || "Usuario"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Confirmación</Label>
              <p className="text-sm text-muted-foreground">
                Escribe <code className="bg-muted px-1 rounded">TRANSFERIR</code> para confirmar
              </p>
              <Input
                value={confirmTransfer}
                onChange={(e) => setConfirmTransfer(e.target.value.toUpperCase())}
                placeholder="TRANSFERIR"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => selectedNewOwner && transferOwnership.mutate(selectedNewOwner)}
              disabled={!selectedNewOwner || confirmTransfer !== "TRANSFERIR" || transferOwnership.isPending}
            >
              {transferOwnership.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 mr-2" />
              )}
              Transferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
