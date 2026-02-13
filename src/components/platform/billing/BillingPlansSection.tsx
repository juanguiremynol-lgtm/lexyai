/**
 * Billing Plans & Pricing Section — Manage plan catalog and scheduled price changes
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { Tag, Plus, Calendar, AlertTriangle } from "lucide-react";
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
  const queryClient = useQueryClient();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [scope, setScope] = useState("NEW_ONLY");

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
  const { data: schedules } = useQuery({
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

  // Create price schedule
  const createSchedule = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("billing_price_schedules").insert({
        plan_id: selectedPlanId,
        new_price_cop_incl_iva: parseInt(newPrice),
        effective_at: new Date(effectiveDate).toISOString(),
        scope,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-price-schedules"] });
      toast.success("Cambio de precio programado");
      setScheduleOpen(false);
      setNewPrice("");
      setEffectiveDate("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Tag className="h-6 w-6 text-amber-400" />
            Planes y Precios
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Catálogo de planes, precios en COP (IVA incluido), y cambios programados.
          </p>
        </div>
        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Calendar className="h-4 w-4" />
              Programar Cambio de Precio
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Programar Cambio de Precio</DialogTitle>
              <DialogDescription>
                El nuevo precio se aplicará según el alcance seleccionado a partir de la fecha efectiva.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Plan</Label>
                <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                  <SelectTrigger><SelectValue placeholder="Seleccione plan..." /></SelectTrigger>
                  <SelectContent>
                    {plans?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.display_name} ({p.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nuevo Precio (COP incl. IVA)</Label>
                <Input
                  type="number"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="Ej: 119000"
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha Efectiva</Label>
                <Input type="datetime-local" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Alcance</Label>
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEW_ONLY">Solo nuevas suscripciones</SelectItem>
                    <SelectItem value="RENEWALS">Renovaciones después de la fecha</SelectItem>
                    <SelectItem value="ALL">
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-400" />
                        Aplicar a todas inmediatamente
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {scope === "ALL" && (
                  <p className="text-xs text-red-400">
                    ⚠️ Zona de peligro: Esto cambiará el precio para TODAS las suscripciones activas.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => createSchedule.mutate()}
                disabled={!selectedPlanId || !newPrice || !effectiveDate || createSchedule.isPending}
              >
                Programar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <p className="text-slate-400 col-span-3">Cargando planes...</p>
        ) : (
          plans?.map((plan) => {
            const currentPrice = plan.pricePoints.find(
              (pp: { price_type: string; billing_cycle_months: number; valid_to: string | null }) =>
                pp.price_type === "REGULAR" && pp.billing_cycle_months === 1 && !pp.valid_to
            );
            return (
              <Card key={plan.id} className="bg-slate-900/50 border-slate-700/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-slate-100 text-base">{plan.display_name}</CardTitle>
                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">{plan.code}</Badge>
                  </div>
                  <CardDescription className="text-slate-400">
                    {plan.is_enterprise ? "Enterprise" : `Hasta ${plan.max_members} miembros`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400">Precio mensual</span>
                      <span className="text-sm font-medium text-slate-200">
                        {currentPrice ? formatCOP(currentPrice.price_cop_incl_iva) : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-400">Puntos de precio</span>
                      <span className="text-sm text-slate-300">{plan.pricePoints.length}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Scheduled Price Changes */}
      {(schedules?.length || 0) > 0 && (
        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardHeader>
            <CardTitle className="text-slate-100 text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-amber-400" />
              Cambios de Precio Programados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {schedules?.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 border border-slate-700/30">
                  <div>
                    <span className="text-sm text-slate-200">
                      {s.billing_plans?.display_name} → {formatCOP(s.new_price_cop_incl_iva)}
                    </span>
                    <p className="text-xs text-slate-400">
                      Efectivo: {format(new Date(s.effective_at), "dd MMM yyyy HH:mm", { locale: es })} · Alcance: {s.scope}
                    </p>
                  </div>
                  <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Pendiente</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
