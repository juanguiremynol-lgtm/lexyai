/**
 * Platform Vouchers Tab - Create and manage trial vouchers
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  Ticket, 
  Plus,
  Copy,
  XCircle,
  CheckCircle2,
  Loader2,
  Calendar,
  Building2
} from "lucide-react";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit-log";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";

interface Voucher {
  id: string;
  code: string;
  extension_days: number;
  expires_at: string | null;
  usage_limit: number;
  usage_count: number;
  restricted_org_id: string | null;
  restricted_org_name?: string;
  created_at: string;
  revoked_at: string | null;
  notes: string | null;
}

function generateVoucherCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "ATENIA-";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function PlatformVouchersTab() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [newVoucher, setNewVoucher] = useState({
    code: generateVoucherCode(),
    extensionDays: 30,
    usageLimit: 1,
    expiresInDays: 90,
    restrictedOrgId: "",
    notes: "",
  });

  // Fetch vouchers
  const { data: vouchers, isLoading } = useQuery({
    queryKey: ["platform-vouchers"],
    queryFn: async () => {
      const { data: vouchersData, error } = await supabase
        .from("trial_vouchers")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get org names for restricted vouchers
      const restrictedOrgIds = vouchersData
        ?.filter((v) => v.restricted_org_id)
        .map((v) => v.restricted_org_id) || [];

      if (restrictedOrgIds.length > 0) {
        const { data: orgs } = await supabase
          .from("organizations")
          .select("id, name")
          .in("id", restrictedOrgIds);

        const orgMap = new Map(orgs?.map((o) => [o.id, o.name]));

        return vouchersData?.map((v) => ({
          ...v,
          restricted_org_name: v.restricted_org_id ? orgMap.get(v.restricted_org_id) : undefined,
        })) as Voucher[];
      }

      return vouchersData as Voucher[];
    },
  });

  // Fetch organizations for restriction dropdown
  const { data: organizations } = useQuery({
    queryKey: ["platform-orgs-for-vouchers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Create voucher mutation
  const createVoucher = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const expiresAt = addDays(new Date(), newVoucher.expiresInDays);

      const { data, error } = await supabase
        .from("trial_vouchers")
        .insert({
          code: newVoucher.code,
          extension_days: newVoucher.extensionDays,
          expires_at: expiresAt.toISOString(),
          usage_limit: newVoucher.usageLimit,
          restricted_org_id: newVoucher.restrictedOrgId || null,
          notes: newVoucher.notes || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Log the creation
      await logAudit({
        organizationId: newVoucher.restrictedOrgId || "00000000-0000-0000-0000-000000000000",
        action: "PLATFORM_VOUCHER_CREATED",
        entityType: "subscription",
        entityId: data.id,
        metadata: {
          code: newVoucher.code,
          extensionDays: newVoucher.extensionDays,
          usageLimit: newVoucher.usageLimit,
          expiresAt: expiresAt.toISOString(),
          restrictedOrgId: newVoucher.restrictedOrgId || null,
        },
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-vouchers"] });
      toast.success("Voucher creado exitosamente");
      setIsCreating(false);
      setNewVoucher({
        code: generateVoucherCode(),
        extensionDays: 30,
        usageLimit: 1,
        expiresInDays: 90,
        restrictedOrgId: "",
        notes: "",
      });
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Revoke voucher mutation
  const revokeVoucher = useMutation({
    mutationFn: async (voucher: Voucher) => {
      const { error } = await supabase
        .from("trial_vouchers")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", voucher.id);

      if (error) throw error;

      await logAudit({
        organizationId: voucher.restricted_org_id || "00000000-0000-0000-0000-000000000000",
        action: "PLATFORM_VOUCHER_REVOKED",
        entityType: "subscription",
        entityId: voucher.id,
        metadata: {
          code: voucher.code,
          remainingUses: voucher.usage_limit - voucher.usage_count,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-vouchers"] });
      toast.success("Voucher revocado");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Código copiado al portapapeles");
  };

  const getVoucherStatus = (voucher: Voucher) => {
    if (voucher.revoked_at) {
      return { label: "Revocado", className: "bg-red-100 text-red-800" };
    }
    if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
      return { label: "Expirado", className: "bg-gray-100 text-gray-800" };
    }
    if (voucher.usage_count >= voucher.usage_limit) {
      return { label: "Agotado", className: "bg-amber-100 text-amber-800" };
    }
    return { label: "Activo", className: "bg-green-100 text-green-800" };
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando vouchers...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create Voucher */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            {isCreating ? "Crear Nuevo Voucher" : "Vouchers de Prueba"}
          </CardTitle>
          <CardDescription>
            {isCreating 
              ? "Configure los parámetros del nuevo voucher de extensión de trial"
              : "Genere códigos para extender períodos de prueba"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isCreating ? (
            <Button onClick={() => setIsCreating(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Crear Voucher
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Código</Label>
                  <div className="flex gap-2">
                    <Input
                      value={newVoucher.code}
                      onChange={(e) => setNewVoucher({ ...newVoucher, code: e.target.value.toUpperCase() })}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setNewVoucher({ ...newVoucher, code: generateVoucherCode() })}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Días de Extensión</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={newVoucher.extensionDays}
                    onChange={(e) => setNewVoucher({ ...newVoucher, extensionDays: parseInt(e.target.value) || 30 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Límite de Usos</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={newVoucher.usageLimit}
                    onChange={(e) => setNewVoucher({ ...newVoucher, usageLimit: parseInt(e.target.value) || 1 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Válido por (días)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={newVoucher.expiresInDays}
                    onChange={(e) => setNewVoucher({ ...newVoucher, expiresInDays: parseInt(e.target.value) || 90 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Restricción de Organización (opcional)</Label>
                  <Select
                    value={newVoucher.restrictedOrgId}
                    onValueChange={(v) => setNewVoucher({ ...newVoucher, restrictedOrgId: v === "none" ? "" : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sin restricción" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin restricción</SelectItem>
                      {organizations?.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notas (opcional)</Label>
                  <Textarea
                    value={newVoucher.notes}
                    onChange={(e) => setNewVoucher({ ...newVoucher, notes: e.target.value })}
                    placeholder="Ej: Promoción Black Friday 2024"
                    rows={2}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => createVoucher.mutate()}
                  disabled={createVoucher.isPending || !newVoucher.code}
                >
                  {createVoucher.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Crear Voucher
                </Button>
                <Button variant="outline" onClick={() => setIsCreating(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vouchers List */}
      <Card>
        <CardHeader>
          <CardTitle>Vouchers Existentes</CardTitle>
          <CardDescription>
            {vouchers?.length || 0} vouchers en el sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {vouchers?.map((voucher) => {
              const status = getVoucherStatus(voucher);
              const isActive = !voucher.revoked_at && 
                (!voucher.expires_at || new Date(voucher.expires_at) > new Date()) &&
                voucher.usage_count < voucher.usage_limit;

              return (
                <div
                  key={voucher.id}
                  className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="px-2 py-1 bg-muted rounded text-sm font-mono">
                          {voucher.code}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => copyCode(voucher.code)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Badge className={status.className}>{status.label}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          +{voucher.extension_days} días
                        </span>
                        <span>
                          Usos: {voucher.usage_count}/{voucher.usage_limit}
                        </span>
                        {voucher.expires_at && (
                          <span>
                            Expira: {format(new Date(voucher.expires_at), "dd MMM yyyy", { locale: es })}
                          </span>
                        )}
                        {voucher.restricted_org_name && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            Solo para: {voucher.restricted_org_name}
                          </span>
                        )}
                      </div>
                      {voucher.notes && (
                        <p className="text-xs text-muted-foreground">{voucher.notes}</p>
                      )}
                    </div>
                    {isActive && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-destructive">
                            <XCircle className="h-4 w-4 mr-1" />
                            Revocar
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revocar Voucher</AlertDialogTitle>
                            <AlertDialogDescription>
                              El voucher <strong>{voucher.code}</strong> ya no podrá ser utilizado.
                              Esta acción no afecta extensiones ya aplicadas.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => revokeVoucher.mutate(voucher)}
                              className="bg-destructive hover:bg-destructive/90"
                            >
                              Revocar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              );
            })}

            {(!vouchers || vouchers.length === 0) && (
              <p className="text-center text-muted-foreground py-8">
                No hay vouchers creados
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
