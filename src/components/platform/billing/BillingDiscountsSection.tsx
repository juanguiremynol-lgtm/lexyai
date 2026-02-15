/**
 * Billing Discounts & Vouchers Section — CRUD for discount codes + courtesy vouchers
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Ticket, Plus, Percent, DollarSign, Loader2, Gift, XCircle, CheckCircle2, Copy, Link as LinkIcon } from "lucide-react";
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
  const queryClient = useQueryClient();
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

  // Courtesy Voucher state and mutations
  const [voucherDialogOpen, setVoucherDialogOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [voucherNote, setVoucherNote] = useState("");
  const [expiresDays, setExpiresDays] = useState(30);
  const [createdVoucher, setCreatedVoucher] = useState<any>(null);

  const { data: vouchers, isLoading: vouchersLoading } = useQuery({
    queryKey: ["platform-courtesy-vouchers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_vouchers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const createVoucherMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("platform_create_courtesy_voucher", {
        p_recipient_email: recipientEmail,
        p_note: voucherNote || null,
        p_expires_days: expiresDays,
      });
      if (error) throw error;
      return data as unknown as any;
    },
    onSuccess: (data) => {
      if (data.ok) {
        setCreatedVoucher(data);
        queryClient.invalidateQueries({ queryKey: ["platform-courtesy-vouchers"] });
        toast.success("Voucher de cortesía creado exitosamente");
      } else {
        toast.error(data.error || "Error al crear voucher");
      }
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const revokeVoucherMutation = useMutation({
    mutationFn: async (voucherId: string) => {
      const { data, error } = await supabase.rpc("platform_revoke_voucher", {
        p_voucher_id: voucherId,
        p_reason: "Revocado manualmente desde consola",
      });
      if (error) throw error;
      const result = data as unknown as { ok: boolean; error?: string };
      if (!result.ok) throw new Error(result.error || "Error al revocar");
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-courtesy-vouchers"] });
      toast.success("Voucher revocado exitosamente");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const handleCreateVoucher = () => {
    if (!recipientEmail) {
      toast.error("Completa los campos requeridos");
      return;
    }
    createVoucherMutation.mutate();
  };

  const handleCloseVoucherDialog = () => {
    setRecipientEmail("");
    setVoucherNote("");
    setExpiresDays(30);
    setCreatedVoucher(null);
    setVoucherDialogOpen(false);
  };

  const getVoucherStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Activo</Badge>;
      case "REDEEMED":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Canjeado</Badge>;
      case "REVOKED":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Revocado</Badge>;
      case "EXPIRED":
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400">Expirado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado al portapapeles`);
  };

  const getRedeemUrl = () => {
    if (!createdVoucher?.raw_token) return "";
    return `https://andromeda.legal/v/redeem/${createdVoucher.raw_token}`;
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

      {/* Courtesy Vouchers */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            Vouchers de Cortesía
          </CardTitle>
          <CardDescription>
            Genere vouchers gratuitos para otorgar acceso Enterprise
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Dialog open={voucherDialogOpen} onOpenChange={setVoucherDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Crear Voucher de Cortesía
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Crear Voucher de Cortesía</DialogTitle>
                <DialogDescription>
                  Enterprise por 1 año a COP $0 (IVA incluido)
                </DialogDescription>
              </DialogHeader>

              {!createdVoucher ? (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="recipient-email">Email del destinatario *</Label>
                    <Input
                      id="recipient-email"
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="cliente@ejemplo.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="expires-days">Válido por (días)</Label>
                    <Input
                      id="expires-days"
                      type="number"
                      min={1}
                      max={180}
                      value={expiresDays}
                      onChange={(e) => setExpiresDays(parseInt(e.target.value) || 30)}
                    />
                    <p className="text-xs text-muted-foreground">
                      El voucher debe canjearse dentro de este plazo (1-180 días)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="voucher-note">Nota (opcional)</Label>
                    <Textarea
                      id="voucher-note"
                      value={voucherNote}
                      onChange={(e) => setVoucherNote(e.target.value)}
                      placeholder="Ej: Cortesía para demostración de producto"
                      rows={2}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4 py-4">
                  <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-medium">Voucher creado exitosamente</span>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground">Código</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-muted rounded text-sm font-mono">
                          {createdVoucher.code}
                        </code>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => copyToClipboard(createdVoucher.code || "", "Código")}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm text-muted-foreground">Enlace de canje</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-muted rounded text-xs font-mono truncate">
                          {getRedeemUrl()}
                        </code>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => copyToClipboard(getRedeemUrl(), "Enlace")}
                        >
                          <LinkIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="text-sm text-muted-foreground">
                      <p>Destinatario: <strong>{createdVoucher.recipient_email}</strong></p>
                      <p>Expira: <strong>{new Date(createdVoucher.expires_at || "").toLocaleDateString("es-CO")}</strong></p>
                    </div>
                  </div>

                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    ⚠️ Este enlace solo se muestra una vez. Cópielo ahora para enviarlo al destinatario.
                  </p>
                </div>
              )}

              <DialogFooter>
                {!createdVoucher ? (
                  <>
                    <Button variant="outline" onClick={handleCloseVoucherDialog}>
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleCreateVoucher}
                      disabled={createVoucherMutation.isPending || !recipientEmail}
                    >
                      {createVoucherMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                      )}
                      Crear Voucher
                    </Button>
                  </>
                ) : (
                  <Button onClick={handleCloseVoucherDialog}>Cerrar</Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {vouchersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : vouchers && vouchers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Destinatario</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Expira</TableHead>
                  <TableHead>Canjeado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers.map((voucher: any) => (
                  <TableRow key={voucher.id}>
                    <TableCell>
                      <code className="text-sm font-mono">{voucher.code}</code>
                    </TableCell>
                    <TableCell className="text-sm">{voucher.recipient_email}</TableCell>
                    <TableCell>{getVoucherStatusBadge(voucher.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {voucher.expires_at
                        ? format(new Date(voucher.expires_at), "dd MMM yyyy", { locale: es })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {voucher.redeemed_at
                        ? format(new Date(voucher.redeemed_at), "dd MMM yyyy", { locale: es })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {voucher.status === "ACTIVE" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive">
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Revocar Voucher</AlertDialogTitle>
                              <AlertDialogDescription>
                                El voucher <strong>{voucher.code}</strong> ya no podrá ser utilizado.
                                Esta acción no puede deshacerse.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => revokeVoucherMutation.mutate(voucher.id)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Revocar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              No hay vouchers de cortesía creados
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
