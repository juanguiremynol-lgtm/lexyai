/**
 * Billing Discounts & Vouchers Section — CRUD for discount codes + existing vouchers
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { Ticket, Plus, Percent, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

function formatCOP(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

export function BillingDiscountsSection() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED_COP">("PERCENT");
  const [discountValue, setDiscountValue] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [validTo, setValidTo] = useState("");
  const [notes, setNotes] = useState("");

  // Fetch discount codes
  const { data: discounts, isLoading } = useQuery({
    queryKey: ["platform-discount-codes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_discount_codes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  // Fetch redemptions
  const { data: redemptions } = useQuery({
    queryKey: ["platform-discount-redemptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_discount_redemptions")
        .select("*, billing_discount_codes(code)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  // Create discount code
  const createDiscount = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("billing_discount_codes").insert({
        code: code.toUpperCase().trim(),
        discount_type: discountType,
        discount_value: parseInt(discountValue),
        max_redemptions: maxRedemptions ? parseInt(maxRedemptions) : null,
        valid_to: validTo ? new Date(validTo).toISOString() : null,
        notes,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-discount-codes"] });
      toast.success("Código de descuento creado");
      setCreateOpen(false);
      setCode(""); setDiscountValue(""); setMaxRedemptions(""); setValidTo(""); setNotes("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Toggle active
  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("billing_discount_codes")
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-discount-codes"] });
      toast.success("Estado actualizado");
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Ticket className="h-6 w-6 text-amber-400" />
            Descuentos y Vouchers
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Gestión de códigos de descuento, vouchers de cortesía y reportes de uso.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Crear Código
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuevo Código de Descuento</DialogTitle>
              <DialogDescription>
                Se valida al momento del checkout. Los montos son en COP.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Código</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ej: LANZAMIENTO2026" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={discountType} onValueChange={(v) => setDiscountType(v as "PERCENT" | "FIXED_COP")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERCENT">Porcentaje (%)</SelectItem>
                      <SelectItem value="FIXED_COP">Monto Fijo (COP)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Valor</Label>
                  <Input
                    type="number"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === "PERCENT" ? "Ej: 20" : "Ej: 50000"}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Máx. Usos</Label>
                  <Input
                    type="number"
                    value={maxRedemptions}
                    onChange={(e) => setMaxRedemptions(e.target.value)}
                    placeholder="Ilimitado"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Válido Hasta</Label>
                  <Input type="datetime-local" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notas</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Uso interno..." rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button onClick={() => createDiscount.mutate()} disabled={!code || !discountValue || createDiscount.isPending}>
                Crear
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Discount Codes Table */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base">Códigos de Descuento</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-400">Cargando...</p>
          ) : (discounts?.length || 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay códigos creados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Código</th>
                    <th className="text-left py-2 px-2">Tipo</th>
                    <th className="text-left py-2 px-2">Valor</th>
                    <th className="text-left py-2 px-2">Usos</th>
                    <th className="text-left py-2 px-2">Válido Hasta</th>
                    <th className="text-left py-2 px-2">Activo</th>
                  </tr>
                </thead>
                <tbody>
                  {discounts?.map((d) => (
                    <tr key={d.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="py-2 px-2 font-mono text-amber-300">{d.code}</td>
                      <td className="py-2 px-2 text-slate-300">
                        {d.discount_type === "PERCENT" ? (
                          <span className="flex items-center gap-1"><Percent className="h-3 w-3" /> Porcentaje</span>
                        ) : (
                          <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> Fijo COP</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-slate-200">
                        {d.discount_type === "PERCENT" ? `${d.discount_value}%` : formatCOP(d.discount_value)}
                      </td>
                      <td className="py-2 px-2 text-slate-300">
                        {d.current_redemptions} / {d.max_redemptions ?? "∞"}
                      </td>
                      <td className="py-2 px-2 text-slate-400">
                        {d.valid_to ? format(new Date(d.valid_to), "dd MMM yyyy", { locale: es }) : "Sin límite"}
                      </td>
                      <td className="py-2 px-2">
                        <Switch
                          checked={d.is_active}
                          onCheckedChange={(checked) => toggleActive.mutate({ id: d.id, is_active: checked })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Redemptions */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base">Últimas Redenciones</CardTitle>
        </CardHeader>
        <CardContent>
          {(redemptions?.length || 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay redenciones registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Código</th>
                    <th className="text-left py-2 px-2">Plan</th>
                    <th className="text-left py-2 px-2">Original</th>
                    <th className="text-left py-2 px-2">Descuento</th>
                    <th className="text-left py-2 px-2">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {redemptions?.map((r: any) => (
                    <tr key={r.id} className="border-b border-slate-800/50">
                      <td className="py-2 px-2 text-slate-300">
                        {format(new Date(r.created_at), "dd MMM HH:mm", { locale: es })}
                      </td>
                      <td className="py-2 px-2 font-mono text-amber-300">{r.billing_discount_codes?.code || "—"}</td>
                      <td className="py-2 px-2 text-slate-300">{r.plan_code}</td>
                      <td className="py-2 px-2 text-slate-400">{formatCOP(r.original_amount_cop)}</td>
                      <td className="py-2 px-2 text-red-400">-{formatCOP(r.discount_amount_cop)}</td>
                      <td className="py-2 px-2 text-emerald-400 font-medium">{formatCOP(r.final_amount_cop)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
