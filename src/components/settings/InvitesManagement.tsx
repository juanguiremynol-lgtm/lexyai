/**
 * Invites Management Component
 * 
 * Allows admins to invite users to the organization,
 * view pending invites, resend, and revoke them.
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Mail, 
  UserPlus, 
  RotateCcw, 
  Trash2, 
  Loader2, 
  Clock, 
  CheckCircle2,
  Shield,
  User
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationInvites } from "@/hooks/use-organization-invites";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_BADGES = {
  PENDING: { label: "Pendiente", className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  ACCEPTED: { label: "Aceptada", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  EXPIRED: { label: "Expirada", className: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200" },
  REVOKED: { label: "Revocada", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
};

const ROLE_LABELS = {
  ADMIN: { label: "Administrador", icon: Shield },
  MEMBER: { label: "Miembro", icon: User },
};

export function InvitesManagement() {
  const { organization } = useOrganization();
  const { isAdmin } = useOrganizationMembership(organization?.id || null);
  const {
    invites,
    isLoading,
    createInvite,
    resendInvite,
    revokeInvite,
    pendingInvites,
  } = useOrganizationInvites(organization?.id || null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");

  const handleCreateInvite = async () => {
    if (!email.trim()) return;

    await createInvite.mutateAsync({ email: email.trim(), role });
    setEmail("");
    setRole("MEMBER");
    setDialogOpen(false);
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Invitaciones
          </CardTitle>
          <CardDescription>
            Solo los administradores pueden gestionar invitaciones.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Invitaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
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
            <Mail className="h-5 w-5 text-primary" />
            <CardTitle>Invitaciones</CardTitle>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="h-4 w-4 mr-2" />
                Nueva Invitación
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invitar Usuario</DialogTitle>
                <DialogDescription>
                  Envía una invitación por email para unirse a tu organización.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="usuario@ejemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Rol</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as "ADMIN" | "MEMBER")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MEMBER">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" />
                          Miembro
                        </div>
                      </SelectItem>
                      <SelectItem value="ADMIN">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4" />
                          Administrador
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Los administradores pueden gestionar miembros e invitaciones.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleCreateInvite}
                  disabled={!email.trim() || createInvite.isPending}
                >
                  {createInvite.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4 mr-2" />
                      Enviar Invitación
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <CardDescription>
          Gestiona las invitaciones a tu organización. {pendingInvites.length > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {pendingInvites.length} pendiente{pendingInvites.length !== 1 ? "s" : ""}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invites.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No hay invitaciones</p>
            <p className="text-sm">Invita a usuarios para que se unan a tu organización.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Enviada</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => {
                const statusBadge = STATUS_BADGES[invite.status as keyof typeof STATUS_BADGES];
                const roleInfo = ROLE_LABELS[invite.role as keyof typeof ROLE_LABELS];
                const RoleIcon = roleInfo?.icon || User;
                const isPending = invite.status === "PENDING";
                const isExpired = new Date(invite.expires_at) < new Date();

                return (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">{invite.email}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <RoleIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm">{roleInfo?.label}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusBadge?.className}>
                        {isPending && isExpired ? (
                          <>
                            <Clock className="h-3 w-3 mr-1" />
                            Expirada
                          </>
                        ) : invite.status === "ACCEPTED" ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {statusBadge?.label}
                          </>
                        ) : (
                          statusBadge?.label
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDistanceToNow(new Date(invite.created_at), {
                        addSuffix: true,
                        locale: es,
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      {isPending && !isExpired && (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resendInvite.mutate(invite.id)}
                            disabled={resendInvite.isPending}
                          >
                            {resendInvite.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Revocar Invitación</AlertDialogTitle>
                                <AlertDialogDescription>
                                  ¿Estás seguro de que deseas revocar esta invitación?
                                  El usuario no podrá aceptarla.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => revokeInvite.mutate(invite.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Revocar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
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
  );
}
