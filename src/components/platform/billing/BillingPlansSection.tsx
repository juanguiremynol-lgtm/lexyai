/**
 * Billing Plans & Pricing Section — Manage plan catalog and scheduled price changes
 */

import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCreatePriceSchedule, useApplyPriceSchedule } from "@/hooks/use-billing-admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Tag, Plus, Calendar, AlertTriangle, Loader2, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

function formatCOP(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function BillingPlansSection() {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [scope, setScope] = useState<"NEW_ONLY" | "RENEWALS" | "ALL">("NEW_ONLY");
  const [reason, setReason] = useState("");
  const [showDangerConfirm, setShowDangerConfirm] = useState(false);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [showImpactPreview, setShowImpactPreview] = useState(false);
  const [impactData, setImpactData] = useState<{ count: number; examples: any[] } | null>(null);

  const createScheduleMutation = useCreatePriceSchedule();
  const applyScheduleMutation = useApplyPriceSchedule();
  const queryClient = useQueryClient();

  // Fetch plans with price points
  const { data: plans, isLoading } = useQuery({
    queryKey: ["platform-billing-plans-admin"],
    queryFn: async () => {
      const { data: plansData, error: plansError } = await supabase
        .from("billing_plans")
        .select("*")
        .order("code");
      if (plansError) throw plansError;

      const { data: pricePoints, error: ppError } = await supabase
        .from("billing_price_points")
        .select("*")
        .order("valid_from", { ascending: false });
      if (ppError) throw ppError;

      return (plansData || []).map((plan) => ({
        ...plan,
        pricePoints: (pricePoints || []).filter((pp) => pp.plan_id === plan.id),
      }));
    },
    staleTime: 60_000,
  });

  // Fetch scheduled price changes
  const { data: schedules, refetch: refetchSchedules } = useQuery({
    queryKey: ["platform-price-schedules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_price_schedules")
        .select("*, billing_plans(code, display_name)")
        .eq("applied", false)
        .order("effective_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  // Cancel scheduled price change
  const cancelScheduleMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      const { error } = await supabase
        .from("billing_price_schedules")
        .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
        .eq("id", scheduleId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cambio cancelado exitosamente");
      refetchSchedules();
      setSelectedScheduleId(null);
    },
    onError: (error) => {
      toast.error(`Error: ${(error as Error).message}`);
    },
  });

  // Compute impact preview
  const loadImpactPreview = async (plan: any) => {
    if (!selectedPlanId || !newPrice) {
      toast.error("Selecciona plan y precio nuevo");
      return;
    }

    try {
      // Count subscriptions that would be affected
      const { data: subscriptions, error } = await supabase
        .from("billing_subscription_state")
        .select("organization_id, plan_code, billing_cycle_months")
        .eq("plan_code", plan.code);

      if (error) throw error;

      const examplesCount = Math.min(subscriptions?.length || 0, 3);
      setImpactData({
        count: subscriptions?.length || 0,
        examples: (subscriptions || []).slice(0, examplesCount),
      });
      setShowImpactPreview(true);
    } catch (err) {
      toast.error("Error cargando vista previa de impacto");
    }
  };

  const handleCreateSchedule = async () => {
    if (!selectedPlanId || !newPrice || !effectiveDate) {
      toast.error("Completa todos los campos requeridos");
      return;
    }

    if (scope === "ALL" && !showDangerConfirm) {
      setShowDangerConfirm(true);
      return;
    }

    createScheduleMutation.mutate({
      plan_id: selectedPlanId,
      new_price_cop_incl_iva: parseInt(newPrice),
      effective_at: new Date(effectiveDate).toISOString(),
      scope,
      reason: reason || "Sin especificar",
    });

    setSelectedPlanId("");
    setNewPrice("");
    setEffectiveDate("");
    setReason("");
    setScope("NEW_ONLY");
    setShowDangerConfirm(false);
    setScheduleOpen(false);
  };

  const getDangerZoneMessage = () => {
    if (scope === "NEW_ONLY") return null;
    if (scope === "RENEWALS") {
      return "⚠️ Esta acción afectará los precios en la próxima renovación de todas las suscripciones activas.";
    }
    return "🚨 PELIGRO: Esta acción aplicará el precio inmediatamente a TODAS las suscripciones activas.";
  };

  return (
    <div className="space-y-6">
      {/* Current Plans */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Planes y Precios
          </CardTitle>
          <CardDescription>
            Gestiona el catálogo de planes y precios en COP (enteros, sin decimales)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {plans?.map((plan) => (
                <div key={plan.id} className="border-b border-border pb-4 last:border-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{plan.display_name}</h3>
                      <p className="text-sm text-muted-foreground">{plan.code}</p>
                    </div>
                    <Badge variant="outline">{plan.max_members} miembros máx</Badge>
                  </div>

                  {plan.pricePoints?.length > 0 && (
                    <div className="mt-2 ml-0 space-y-1">
                      {plan.pricePoints.slice(0, 2).map((pp) => (
                        <div key={pp.id} className="text-sm text-muted-foreground">
                          {pp.billing_cycle_months}m {pp.price_type}: {formatCOP(pp.price_cop_incl_iva)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule Price Change */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Programar Cambio de Precio
          </CardTitle>
          <CardDescription>
            Programa un cambio de precio futuro para uno o más planes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> Nuevo Cambio de Precio
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Programar Cambio de Precio</DialogTitle>
                <DialogDescription>
                  Define cuándo y cómo afectar a los precios
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Plan Selection */}
                <div>
                  <Label htmlFor="plan">Plan</Label>
                  <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                    <SelectTrigger id="plan">
                      <SelectValue placeholder="Selecciona un plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans?.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {plan.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* New Price */}
                <div>
                  <Label htmlFor="price">Nuevo Precio (COP)</Label>
                  <Input
                    id="price"
                    type="number"
                    placeholder="ej: 100000"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                  />
                </div>

                {/* Effective Date */}
                <div>
                  <Label htmlFor="date">Fecha Efectiva</Label>
                  <Input
                    id="date"
                    type="datetime-local"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                  />
                </div>

                {/* Scope */}
                <div>
                  <Label htmlFor="scope">Alcance</Label>
                  <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                    <SelectTrigger id="scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NEW_ONLY">
                        Solo nuevas suscripciones
                      </SelectItem>
                      <SelectItem value="RENEWALS">
                        Renovaciones futuras
                      </SelectItem>
                      <SelectItem value="ALL">
                        Inmediatamente (Peligro)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Reason */}
                <div>
                  <Label htmlFor="reason">Razón / Notas</Label>
                  <Input
                    id="reason"
                    placeholder="Motivo del cambio"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>

                {/* Danger Zone Warning */}
                {getDangerZoneMessage() && (
                  <div className="rounded-md border-l-4 border-destructive bg-destructive/10 p-3">
                    <p className="text-sm text-destructive">{getDangerZoneMessage()}</p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setScheduleOpen(false)}
                  disabled={createScheduleMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleCreateSchedule}
                  disabled={createScheduleMutation.isPending}
                >
                  {createScheduleMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Programando...
                    </>
                  ) : (
                    "Programar"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Danger Zone Confirmation */}
          <AlertDialog open={showDangerConfirm} onOpenChange={setShowDangerConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Confirmar Cambio Inmediato
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Estás a punto de aplicar un cambio de precio INMEDIATAMENTE a todas las suscripciones activas. Esta acción es irreversible.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleCreateSchedule()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Aplicar Inmediatamente
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

       {/* Scheduled Changes */}
       {schedules && schedules.length > 0 && (
         <Card className="border-border">
           <CardHeader>
             <CardTitle>Cambios Programados</CardTitle>
             <CardDescription>
               {schedules.length} cambio(s) de precio pendiente(s)
             </CardDescription>
           </CardHeader>
           <CardContent>
             <div className="space-y-2">
               {schedules.map((schedule) => (
                 <div key={schedule.id} className="flex items-center justify-between rounded-md border border-border p-3">
                   <div>
                     <p className="font-medium">{(schedule.billing_plans as any)?.display_name}</p>
                     <p className="text-sm text-muted-foreground">
                       {formatCOP(schedule.new_price_cop_incl_iva)} — Efecto: {format(new Date(schedule.effective_at), "PPpp", { locale: es })}
                     </p>
                     <p className="text-xs text-muted-foreground">Alcance: {schedule.scope}</p>
                   </div>
                   <div className="flex gap-2">
                     <Button
                       size="sm"
                       variant="outline"
                       onClick={() => loadImpactPreview(schedule.billing_plans)}
                       title="Ver impacto"
                     >
                       <Eye className="h-4 w-4" />
                     </Button>
                     <Button
                       size="sm"
                       variant="outline"
                       onClick={() => applyScheduleMutation.mutate(schedule.id)}
                       disabled={applyScheduleMutation.isPending}
                     >
                       {applyScheduleMutation.isPending ? (
                         <Loader2 className="h-4 w-4 animate-spin" />
                       ) : (
                         "Aplicar"
                       )}
                     </Button>
                     <AlertDialog>
                       <AlertDialogTrigger asChild>
                         <Button
                           size="sm"
                           variant="destructive"
                           title="Cancelar cambio"
                         >
                           <Trash2 className="h-4 w-4" />
                         </Button>
                       </AlertDialogTrigger>
                       <AlertDialogContent>
                         <AlertDialogHeader>
                           <AlertDialogTitle>Cancelar Cambio Programado</AlertDialogTitle>
                           <AlertDialogDescription>
                             ¿Estás seguro de que deseas cancelar este cambio de precio? Esta acción no afectará los precios existentes.
                           </AlertDialogDescription>
                         </AlertDialogHeader>
                         <AlertDialogFooter>
                           <AlertDialogCancel>Cancelar</AlertDialogCancel>
                           <AlertDialogAction
                             onClick={() => cancelScheduleMutation.mutate(schedule.id)}
                             className="bg-destructive"
                           >
                             Sí, cancelar cambio
                           </AlertDialogAction>
                         </AlertDialogFooter>
                       </AlertDialogContent>
                     </AlertDialog>
                   </div>
                 </div>
               ))}
             </div>
           </CardContent>
         </Card>
       )}

       {/* Impact Preview Dialog */}
       <Dialog open={showImpactPreview} onOpenChange={setShowImpactPreview}>
         <DialogContent className="sm:max-w-md">
           <DialogHeader>
             <DialogTitle>Vista Previa de Impacto</DialogTitle>
             <DialogDescription>
               Subscripciones que serán afectadas por el cambio de precio
             </DialogDescription>
           </DialogHeader>

           {impactData && (
             <div className="space-y-4">
               <div className="rounded-md border border-border p-3 bg-muted">
                 <p className="text-2xl font-bold">{impactData.count}</p>
                 <p className="text-sm text-muted-foreground">subscripciones activas</p>
               </div>

               <div>
                 <p className="font-semibold mb-2">Ejemplos:</p>
                 <div className="space-y-2">
                   {impactData.examples.map((ex, i) => (
                     <div key={i} className="text-sm p-2 bg-background rounded border border-border">
                       <p className="font-mono">{ex.organization_id}</p>
                       <p className="text-xs text-muted-foreground">
                         {ex.plan_code} • {ex.billing_cycle_months}m
                       </p>
                     </div>
                   ))}
                 </div>
               </div>

               {scope === "ALL" && (
                 <div className="rounded-md border-l-4 border-destructive bg-destructive/10 p-3">
                   <p className="text-sm font-semibold text-destructive">
                     🚨 IMPACTO INMEDIATO
                   </p>
                   <p className="text-xs text-destructive/80 mt-1">
                     Todas las suscripciones serán cambiadas al nuevo precio inmediatamente
                   </p>
                 </div>
               )}
             </div>
           )}

           <DialogFooter>
             <Button
               variant="outline"
               onClick={() => setShowImpactPreview(false)}
             >
               Cerrar
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>
    </div>
  );
}
