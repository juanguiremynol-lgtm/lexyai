/**
 * Platform Subscriptions Tab - Manage subscriptions across all organizations
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Crown, 
  Plus,
  Play,
  Pause,
  XCircle,
  Loader2,
  Building2
} from "lucide-react";
import { toast } from "sonner";
import { logAudit, type AuditAction } from "@/lib/audit-log";
import { addDays, format } from "date-fns";
import { es } from "date-fns/locale";

interface SubscriptionWithOrg {
  id: string;
  organization_id: string;
  organization_name: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
}

export function PlatformSubscriptionsTab() {
  const queryClient = useQueryClient();
  const [selectedOrg, setSelectedOrg] = useState<SubscriptionWithOrg | null>(null);
  const [extensionDays, setExtensionDays] = useState(30);
  const [actionReason, setActionReason] = useState("");

  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ["platform-subscriptions"],
    queryFn: async () => {
      // Get all subscriptions with org info
      const { data: subs, error: subsError } = await supabase
        .from("subscriptions")
        .select("*")
        .order("created_at", { ascending: false });

      if (subsError) throw subsError;

      // Get organization names
      const { data: orgs, error: orgsError } = await supabase
        .from("organizations")
        .select("id, name");

      if (orgsError) throw orgsError;

      const orgMap = new Map(orgs?.map((o) => [o.id, o.name]) || []);

      return (subs || []).map((sub) => ({
        ...sub,
        organization_name: orgMap.get(sub.organization_id) || "Desconocida",
      })) as SubscriptionWithOrg[];
    },
  });

  // Extend trial mutation
  const extendTrial = useMutation({
    mutationFn: async ({ subscription, days, reason }: { subscription: SubscriptionWithOrg; days: number; reason: string }) => {
      const currentEnd = subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : new Date();
      const newEndDate = addDays(currentEnd, days);

      const { error } = await supabase
        .from("subscriptions")
        .update({
          trial_ends_at: newEndDate.toISOString(),
          status: "trialing",
        })
        .eq("id", subscription.id);

      if (error) throw error;

      // Log with platform-specific action
      await logAudit({
        organizationId: subscription.organization_id,
        action: "PLATFORM_TRIAL_EXTENDED" as AuditAction,
        entityType: "subscription",
        entityId: subscription.id,
        metadata: { 
          days, 
          reason, 
          newEndDate: newEndDate.toISOString(),
          previousEndDate: subscription.trial_ends_at,
          operatorAction: "platform_admin",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-subscriptions"] });
      toast.success(`Prueba extendida por ${extensionDays} días`);
      setSelectedOrg(null);
      setExtensionDays(30);
      setActionReason("");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Activate subscription
  const activateSubscription = useMutation({
    mutationFn: async ({ subscription, reason }: { subscription: SubscriptionWithOrg; reason: string }) => {
      const previousStatus = subscription.status;
      
      const { error } = await supabase
        .from("subscriptions")
        .update({
          status: "active",
          current_period_start: new Date().toISOString(),
          current_period_end: addDays(new Date(), 365).toISOString(),
        })
        .eq("id", subscription.id);

      if (error) throw error;

      await logAudit({
        organizationId: subscription.organization_id,
        action: "PLATFORM_SUBSCRIPTION_ACTIVATED" as AuditAction,
        entityType: "subscription",
        entityId: subscription.id,
        metadata: { 
          reason, 
          previousStatus,
          operatorAction: "platform_admin",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-subscriptions"] });
      toast.success("Suscripción activada");
      setSelectedOrg(null);
      setActionReason("");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Suspend subscription
  const suspendSubscription = useMutation({
    mutationFn: async ({ subscription, reason }: { subscription: SubscriptionWithOrg; reason: string }) => {
      const previousStatus = subscription.status;

      const { error } = await supabase
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("id", subscription.id);

      if (error) throw error;

      await logAudit({
        organizationId: subscription.organization_id,
        action: "PLATFORM_SUBSCRIPTION_SUSPENDED" as AuditAction,
        entityType: "subscription",
        entityId: subscription.id,
        metadata: { 
          reason, 
          previousStatus,
          operatorAction: "platform_admin",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-subscriptions"] });
      toast.success("Suscripción suspendida");
      setSelectedOrg(null);
      setActionReason("");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Expire subscription
  const expireSubscription = useMutation({
    mutationFn: async ({ subscription, reason }: { subscription: SubscriptionWithOrg; reason: string }) => {
      const previousStatus = subscription.status;

      const { error } = await supabase
        .from("subscriptions")
        .update({ status: "expired" })
        .eq("id", subscription.id);

      if (error) throw error;

      await logAudit({
        organizationId: subscription.organization_id,
        action: "PLATFORM_SUBSCRIPTION_EXPIRED" as AuditAction,
        entityType: "subscription",
        entityId: subscription.id,
        metadata: { 
          reason, 
          previousStatus,
          forcedManually: true,
          operatorAction: "platform_admin",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-subscriptions"] });
      toast.success("Suscripción expirada");
      setSelectedOrg(null);
      setActionReason("");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const getStatusBadge = (status: string) => {
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
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando suscripciones...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Organization Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Seleccionar Organización
          </CardTitle>
          <CardDescription>
            Seleccione una organización para gestionar su suscripción
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={selectedOrg?.id || ""}
            onValueChange={(value) => {
              const org = subscriptions?.find((s) => s.id === value);
              setSelectedOrg(org || null);
              setActionReason("");
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Seleccione una organización..." />
            </SelectTrigger>
            <SelectContent>
              {subscriptions?.map((sub) => (
                <SelectItem key={sub.id} value={sub.id}>
                  <div className="flex items-center gap-2">
                    <span>{sub.organization_name}</span>
                    <span className="text-muted-foreground">— {sub.status}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Selected Organization Actions */}
      {selectedOrg && (
        <div className="space-y-6">
          {/* Current Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                {selectedOrg.organization_name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground mb-1">Estado</p>
                  {getStatusBadge(selectedOrg.status)}
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground mb-1">Fin de Prueba</p>
                  <p className="font-medium">
                    {selectedOrg.trial_ends_at
                      ? format(new Date(selectedOrg.trial_ends_at), "dd MMM yyyy", { locale: es })
                      : "—"}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground mb-1">Período Actual</p>
                  <p className="font-medium">
                    {selectedOrg.current_period_end
                      ? format(new Date(selectedOrg.current_period_end), "dd MMM yyyy", { locale: es })
                      : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Extend Trial */}
          {(selectedOrg.status === "trialing" || selectedOrg.status === "expired") && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  Extender Período de Prueba
                </CardTitle>
                <CardDescription>
                  Gift additional trial days. Requires a reason for audit.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="extensionDays">Días a agregar</Label>
                    <Input
                      id="extensionDays"
                      type="number"
                      min={1}
                      max={365}
                      value={extensionDays}
                      onChange={(e) => setExtensionDays(parseInt(e.target.value) || 30)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="extensionReason">Razón (requerida)</Label>
                    <Textarea
                      id="extensionReason"
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      placeholder="Ej: Solicitud del cliente por evaluación extendida"
                      rows={2}
                    />
                  </div>
                </div>
                <Button
                  onClick={() => extendTrial.mutate({ 
                    subscription: selectedOrg, 
                    days: extensionDays, 
                    reason: actionReason 
                  })}
                  disabled={!actionReason.trim() || extendTrial.isPending}
                >
                  {extendTrial.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Extender Prueba
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Admin Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-amber-500" />
                Acciones de Plataforma
              </CardTitle>
              <CardDescription>
                Todas las acciones quedan registradas con razón y operador.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Razón para la acción (requerida)</Label>
                <Textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="Explique la razón de esta acción..."
                  rows={2}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                {selectedOrg.status !== "active" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" disabled={!actionReason.trim()}>
                        <Play className="h-4 w-4 mr-2" />
                        Activar Suscripción
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Activar Suscripción</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esto activará la suscripción de <strong>{selectedOrg.organization_name}</strong> por 1 año.
                          <br /><br />
                          Razón: {actionReason}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={() => activateSubscription.mutate({ 
                            subscription: selectedOrg, 
                            reason: actionReason 
                          })}
                        >
                          Activar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {(selectedOrg.status === "active" || selectedOrg.status === "trialing") && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" disabled={!actionReason.trim()}>
                        <Pause className="h-4 w-4 mr-2" />
                        Suspender
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Suspender Suscripción</AlertDialogTitle>
                        <AlertDialogDescription>
                          El usuario de <strong>{selectedOrg.organization_name}</strong> perderá acceso a funciones de escritura.
                          <br /><br />
                          Razón: {actionReason}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => suspendSubscription.mutate({ 
                            subscription: selectedOrg, 
                            reason: actionReason 
                          })}
                          className="bg-amber-600 hover:bg-amber-700"
                        >
                          Suspender
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {selectedOrg.status !== "expired" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" disabled={!actionReason.trim()}>
                        <XCircle className="h-4 w-4 mr-2" />
                        Forzar Expiración
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Forzar Expiración</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esto expirará inmediatamente la suscripción de <strong>{selectedOrg.organization_name}</strong>. 
                          El usuario perderá todo acceso.
                          <br /><br />
                          Razón: {actionReason}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => expireSubscription.mutate({ 
                            subscription: selectedOrg, 
                            reason: actionReason 
                          })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Expirar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* All Subscriptions List */}
      <Card>
        <CardHeader>
          <CardTitle>Todas las Suscripciones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {subscriptions?.map((sub) => (
              <div
                key={sub.id}
                className={`p-3 border rounded-lg flex items-center justify-between cursor-pointer transition-colors ${
                  selectedOrg?.id === sub.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
                onClick={() => setSelectedOrg(sub)}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">{sub.organization_name}</span>
                  {getStatusBadge(sub.status)}
                </div>
                <span className="text-sm text-muted-foreground">
                  {sub.trial_ends_at && format(new Date(sub.trial_ends_at), "dd MMM yyyy", { locale: es })}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
