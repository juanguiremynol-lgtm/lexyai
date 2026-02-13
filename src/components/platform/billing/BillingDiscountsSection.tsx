/**
 * Billing Discounts & Vouchers Section — CRUD for discount codes + existing vouchers
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCreateDiscountCode, useUpdateDiscountCode } from "@/hooks/use-billing-admin";
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
import { Ticket, Plus, Percent, DollarSign, Loader2 } from "lucide-react";
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

export function BillingDiscountsSection() {
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED_COP">("PERCENT");
  const [discountValue, setDiscountValue] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [validTo, setValidTo] = useState("");
  const [notes, setNotes] = useState("");

  const createDiscountMutation = useCreateDiscountCode();
  const updateDiscountMutation = useUpdateDiscountCode();

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

  const handleCreate = async () => {
    if (!code || !discountValue) {
      toast.error("Completa los campos requeridos");
      return;
    }

    createDiscountMutation.mutate({
      code: code.toUpperCase().trim(),
      discount_type: discountType,
      discount_value: parseInt(discountValue),
      max_redemptions: maxRedemptions ? parseInt(maxRedemptions) : null,
      valid_to: validTo ? new Date(validTo).toISOString() : null,
      notes: notes || undefined,
    });

    setCode("");
    setDiscountValue("");
    setMaxRedemptions("");
    setValidTo("");
    setNotes("");
    setCreateOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Discount Codes */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5" />
            Códigos de Descuento
          </CardTitle>
          <CardDescription>
            Crea y gestiona códigos de descuento para promociones
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="mb-4 gap-2">
                <Plus className="h-4 w-4" /> Nuevo Código
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Crear Código de Descuento</DialogTitle>
                <DialogDescription>
                  Define las condiciones del descuento en COP (enteros)
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="code">Código</Label>
                  <Input
                    id="code"
                    placeholder="ej: LAUNCH50"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="type">Tipo</Label>
                    <Select value={discountType} onValueChange={(v) => setDiscountType(v as typeof discountType)}>
                      <SelectTrigger id="type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PERCENT">Porcentaje (%)</SelectItem>
                        <SelectItem value="FIXED_COP">Monto Fijo (COP)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="value">Valor</Label>
                    <Input
                      id="value"
                      type="number"
                      placeholder={discountType === "PERCENT" ? "50" : "50000"}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="max">Redenciones Máximas (opcional)</Label>
                  <Input
                    id="max"
                    type="number"
                    placeholder="ej: 100 (sin límite si está vacío)"
                    value={maxRedemptions}
                    onChange={(e) => setMaxRedemptions(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="valid">Válido Hasta (opcional)</Label>
                  <Input
                    id="valid"
                    type="date"
                    value={validTo}
                    onChange={(e) => setValidTo(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="notes">Notas Internas</Label>
                  <Textarea
                    id="notes"
                    placeholder="ej: Descuento por referral"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={createDiscountMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createDiscountMutation.isPending}
                >
                  {createDiscountMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creando...
                    </>
                  ) : (
                    "Crear"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {discounts?.map((discount) => {
                const isExpired = discount.valid_to && new Date(discount.valid_to) < new Date();
                const isActive = discount.is_active && !isExpired;

                return (
                  <div key={discount.id} className="flex items-center justify-between rounded-md border border-border p-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <code className="font-mono font-bold">{discount.code}</code>
                        {discount.discount_type === "PERCENT" ? (
                          <Badge variant="secondary" className="gap-1">
                            <Percent className="h-3 w-3" /> {discount.discount_value}%
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <DollarSign className="h-3 w-3" /> {formatCOP(discount.discount_value)}
                          </Badge>
                        )}
                        <Badge variant={isActive ? "default" : "outline"}>
                          {isActive ? "Activo" : isExpired ? "Expirado" : "Inactivo"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {discount.max_redemptions ? `${discount.max_redemptions - discount.current_redemptions} redenciones restantes` : "Sin límite"}
                        {discount.valid_to && ` • Expira: ${format(new Date(discount.valid_to), "PPP", { locale: es })}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={discount.is_active}
                        onCheckedChange={(checked) =>
                          updateDiscountMutation.mutate({
                            code_id: discount.id,
                            is_active: checked,
                          })
                        }
                        disabled={updateDiscountMutation.isPending}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Redemptions History */}
      {redemptions && redemptions.length > 0 && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Redenciones Recientes</CardTitle>
            <CardDescription>
              Últimos 50 usos de códigos de descuento
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm max-h-64 overflow-y-auto">
              {redemptions.map((redemption) => (
                <div key={redemption.id} className="border-b border-border pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <code className="font-mono">{(redemption.billing_discount_codes as any)?.code}</code>
                      <p className="text-xs text-muted-foreground">
                        Descuento: {formatCOP(redemption.discount_amount_cop)} → {formatCOP(redemption.final_amount_cop)}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(redemption.created_at), "PP", { locale: es })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
