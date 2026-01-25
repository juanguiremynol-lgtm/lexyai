/**
 * Platform Plan Limits Tab - Manage tier-based rate limits
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
  Gauge, 
  Building2,
  Save,
  Loader2,
  Edit,
  RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit-log";

interface PlanLimit {
  id: string;
  tier: string;
  max_work_items: number;
  max_clients: number;
  max_members: number;
  email_sends_per_hour: number;
  email_sends_per_day: number;
  sync_requests_per_hour: number;
  sync_requests_per_day: number;
  file_uploads_per_day: number;
  storage_mb: number;
}

interface SubscriptionWithOrg {
  id: string;
  organization_id: string;
  organization_name: string;
  tier: string | null;
  status: string;
}

const TIER_OPTIONS = ["FREE_TRIAL", "BASIC", "PRO", "ENTERPRISE"] as const;
type TierType = typeof TIER_OPTIONS[number];

const TIER_LABELS: Record<string, string> = {
  FREE_TRIAL: "Prueba Gratuita",
  BASIC: "Básico",
  PRO: "Profesional",
  ENTERPRISE: "Empresarial",
};

const TIER_COLORS: Record<string, string> = {
  FREE_TRIAL: "bg-gray-100 text-gray-800",
  BASIC: "bg-blue-100 text-blue-800",
  PRO: "bg-purple-100 text-purple-800",
  ENTERPRISE: "bg-amber-100 text-amber-800",
};

export function PlatformPlanLimitsTab() {
  const queryClient = useQueryClient();
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [selectedOrgForTier, setSelectedOrgForTier] = useState<SubscriptionWithOrg | null>(null);
  const [newTier, setNewTier] = useState<string>("");
  const [tierChangeReason, setTierChangeReason] = useState("");

  // Fetch plan limits
  const { data: planLimits, isLoading: isLoadingLimits } = useQuery({
    queryKey: ["platform-plan-limits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_limits")
        .select("*")
        .order("tier");

      if (error) throw error;
      return data as PlanLimit[];
    },
  });

  // Fetch subscriptions for tier assignment
  const { data: subscriptions, isLoading: isLoadingSubs } = useQuery({
    queryKey: ["platform-subscriptions-for-tiers"],
    queryFn: async () => {
      const { data: subs, error } = await supabase
        .from("subscriptions")
        .select("id, organization_id, tier, status")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get org names
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name");

      const orgMap = new Map(orgs?.map((o) => [o.id, o.name]));

      return subs?.map((sub) => ({
        ...sub,
        organization_name: orgMap.get(sub.organization_id) || "Desconocida",
      })) as SubscriptionWithOrg[];
    },
  });

  // Update plan limit mutation
  const updatePlanLimit = useMutation({
    mutationFn: async ({ tier, updates }: { tier: TierType; updates: Partial<Omit<PlanLimit, 'id' | 'tier'>> }) => {
      const { error } = await supabase
        .from("plan_limits")
        .update(updates)
        .eq("tier", tier);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-plan-limits"] });
      toast.success("Límites actualizados");
      setEditingTier(null);
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Change org tier mutation
  const changeOrgTier = useMutation({
    mutationFn: async ({ subscription, newTier, reason }: { 
      subscription: SubscriptionWithOrg; 
      newTier: string; 
      reason: string;
    }) => {
      const previousTier = subscription.tier;

      const { error } = await supabase
        .from("subscriptions")
        .update({ tier: newTier })
        .eq("id", subscription.id);

      if (error) throw error;

      await logAudit({
        organizationId: subscription.organization_id,
        action: "PLATFORM_TIER_CHANGED",
        entityType: "subscription",
        entityId: subscription.id,
        metadata: {
          previousTier,
          newTier,
          reason,
          organizationName: subscription.organization_name,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-subscriptions-for-tiers"] });
      toast.success("Tier actualizado");
      setSelectedOrgForTier(null);
      setNewTier("");
      setTierChangeReason("");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const isLoading = isLoadingLimits || isLoadingSubs;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando configuración de planes...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Plan Limits Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Límites por Plan
          </CardTitle>
          <CardDescription>
            Configure los límites de recursos para cada tier de suscripción
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Tier</th>
                  <th className="text-center py-2 px-3 font-medium">Work Items</th>
                  <th className="text-center py-2 px-3 font-medium">Clientes</th>
                  <th className="text-center py-2 px-3 font-medium">Miembros</th>
                  <th className="text-center py-2 px-3 font-medium">Email/hora</th>
                  <th className="text-center py-2 px-3 font-medium">Syncs/día</th>
                  <th className="text-center py-2 px-3 font-medium">Storage</th>
                  <th className="text-center py-2 px-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {planLimits?.map((limit) => (
                  <tr key={limit.tier} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-3">
                      <Badge className={TIER_COLORS[limit.tier] || "bg-gray-100"}>
                        {TIER_LABELS[limit.tier] || limit.tier}
                      </Badge>
                    </td>
                    <td className="text-center py-3 px-3">{limit.max_work_items}</td>
                    <td className="text-center py-3 px-3">{limit.max_clients}</td>
                    <td className="text-center py-3 px-3">{limit.max_members}</td>
                    <td className="text-center py-3 px-3">{limit.email_sends_per_hour}</td>
                    <td className="text-center py-3 px-3">{limit.sync_requests_per_day}</td>
                    <td className="text-center py-3 px-3">{limit.storage_mb} MB</td>
                    <td className="text-center py-3 px-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingTier(limit.tier)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Tier Limits Dialog */}
      {editingTier && planLimits && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5" />
              Editar Límites: {TIER_LABELS[editingTier] || editingTier}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const limit = planLimits.find((l) => l.tier === editingTier);
              if (!limit) return null;

              return (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    const tierValue = editingTier as TierType;
                    updatePlanLimit.mutate({
                      tier: tierValue,
                      updates: {
                        max_work_items: parseInt(form.get("max_work_items") as string),
                        max_clients: parseInt(form.get("max_clients") as string),
                        max_members: parseInt(form.get("max_members") as string),
                        email_sends_per_hour: parseInt(form.get("email_sends_per_hour") as string),
                        email_sends_per_day: parseInt(form.get("email_sends_per_day") as string),
                        sync_requests_per_hour: parseInt(form.get("sync_requests_per_hour") as string),
                        sync_requests_per_day: parseInt(form.get("sync_requests_per_day") as string),
                        file_uploads_per_day: parseInt(form.get("file_uploads_per_day") as string),
                        storage_mb: parseInt(form.get("storage_mb") as string),
                      },
                    });
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="max_work_items">Max Work Items</Label>
                      <Input name="max_work_items" type="number" defaultValue={limit.max_work_items} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="max_clients">Max Clientes</Label>
                      <Input name="max_clients" type="number" defaultValue={limit.max_clients} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="max_members">Max Miembros</Label>
                      <Input name="max_members" type="number" defaultValue={limit.max_members} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="storage_mb">Storage (MB)</Label>
                      <Input name="storage_mb" type="number" defaultValue={limit.storage_mb} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email_sends_per_hour">Email/hora</Label>
                      <Input name="email_sends_per_hour" type="number" defaultValue={limit.email_sends_per_hour} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email_sends_per_day">Email/día</Label>
                      <Input name="email_sends_per_day" type="number" defaultValue={limit.email_sends_per_day} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sync_requests_per_hour">Syncs/hora</Label>
                      <Input name="sync_requests_per_hour" type="number" defaultValue={limit.sync_requests_per_hour} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sync_requests_per_day">Syncs/día</Label>
                      <Input name="sync_requests_per_day" type="number" defaultValue={limit.sync_requests_per_day} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="file_uploads_per_day">Uploads/día</Label>
                      <Input name="file_uploads_per_day" type="number" defaultValue={limit.file_uploads_per_day} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={updatePlanLimit.isPending}>
                      {updatePlanLimit.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Guardar
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setEditingTier(null)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Organization Tier Assignment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Asignación de Tier por Organización
          </CardTitle>
          <CardDescription>
            Cambie el tier de suscripción para una organización específica
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Organización</Label>
              <Select
                value={selectedOrgForTier?.id || ""}
                onValueChange={(v) => {
                  const sub = subscriptions?.find((s) => s.id === v);
                  setSelectedOrgForTier(sub || null);
                  setNewTier(sub?.tier || "FREE_TRIAL");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione una organización..." />
                </SelectTrigger>
                <SelectContent>
                  {subscriptions?.map((sub) => (
                    <SelectItem key={sub.id} value={sub.id}>
                      <div className="flex items-center gap-2">
                        <span>{sub.organization_name}</span>
                        <Badge className={TIER_COLORS[sub.tier || "FREE_TRIAL"] || "bg-gray-100"} variant="outline">
                          {TIER_LABELS[sub.tier || "FREE_TRIAL"] || sub.tier}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedOrgForTier && (
              <>
                <div className="space-y-2">
                  <Label>Nuevo Tier</Label>
                  <Select value={newTier} onValueChange={setNewTier}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FREE_TRIAL">Prueba Gratuita</SelectItem>
                      <SelectItem value="BASIC">Básico</SelectItem>
                      <SelectItem value="PRO">Profesional</SelectItem>
                      <SelectItem value="ENTERPRISE">Empresarial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Razón del cambio (requerida)</Label>
                  <Textarea
                    value={tierChangeReason}
                    onChange={(e) => setTierChangeReason(e.target.value)}
                    placeholder="Ej: Upgrade solicitado por cliente después de pago..."
                    rows={2}
                  />
                </div>
                <div className="md:col-span-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button 
                        disabled={!tierChangeReason.trim() || newTier === selectedOrgForTier.tier}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Cambiar Tier
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Confirmar Cambio de Tier</AlertDialogTitle>
                        <AlertDialogDescription>
                          <strong>{selectedOrgForTier.organization_name}</strong>
                          <br /><br />
                          De: <Badge className={TIER_COLORS[selectedOrgForTier.tier || "FREE_TRIAL"]}>
                            {TIER_LABELS[selectedOrgForTier.tier || "FREE_TRIAL"]}
                          </Badge>
                          {" → "}
                          A: <Badge className={TIER_COLORS[newTier]}>
                            {TIER_LABELS[newTier]}
                          </Badge>
                          <br /><br />
                          Razón: {tierChangeReason}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => changeOrgTier.mutate({
                            subscription: selectedOrgForTier,
                            newTier,
                            reason: tierChangeReason,
                          })}
                        >
                          Confirmar Cambio
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
