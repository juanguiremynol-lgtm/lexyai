/**
 * Billing Settings Section — Gateway configuration (Wompi secrets) + Audit trail
 * Super admins can securely store Wompi keys without needing Lovable or DB access.
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
} from "@/components/ui/dialog";
import { Settings, History, Shield, Key, Loader2, Save, CheckCircle, Eye, EyeOff } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

interface GatewayConfigItem {
  key: string;
  is_secret: boolean;
  configured: boolean;
  environment: string | null;
  updated_at: string | null;
}

export function BillingSettingsSection() {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editEnvironment, setEditEnvironment] = useState("sandbox");
  const [showValue, setShowValue] = useState(false);

  // Fetch gateway config status
  const { data: gatewayConfig, isLoading: configLoading } = useQuery({
    queryKey: ["platform-gateway-config"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing-admin-gateway`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Failed to fetch config");
      return data.config as GatewayConfigItem[];
    },
    staleTime: 30_000,
  });

  // Save config mutation
  const saveConfig = useMutation({
    mutationFn: async ({ config_key, config_value, environment }: { config_key: string; config_value: string; environment: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing-admin-gateway`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ config_key, config_value, environment }),
        }
      );

      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Failed to save config");
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["platform-gateway-config"] });
      toast.success(`${variables.config_key} guardado correctamente`);
      setEditingKey(null);
      setEditValue("");
      setShowValue(false);
    },
    onError: (error) => {
      toast.error(`Error: ${(error as Error).message}`);
    },
  });

  // Fetch recent billing audit actions
  const { data: auditActions, isLoading: auditLoading } = useQuery({
    queryKey: ["platform-billing-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atenia_ai_actions")
        .select("*")
        .in("action_type", [
          "VERIFY_PAYMENT",
          "ACTIVATE_PLAN",
          "ADMIN_OVERRIDE",
          "EXTEND_TRIAL",
          "CANCEL_SUBSCRIPTION",
          "SUSPEND_SUBSCRIPTION",
          "REFUND_PROPOSED",
        ])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    staleTime: 15_000,
  });

  const handleEditKey = (key: string, currentEnv: string | null) => {
    setEditingKey(key);
    setEditValue("");
    setEditEnvironment(currentEnv || "sandbox");
    setShowValue(false);
  };

  const handleSave = () => {
    if (!editingKey || !editValue.trim()) {
      toast.error("Ingrese un valor válido");
      return;
    }
    saveConfig.mutate({
      config_key: editingKey,
      config_value: editValue.trim(),
      environment: editEnvironment,
    });
  };

  const getKeyDescription = (key: string): string => {
    switch (key) {
      case "WOMPI_PUBLIC_KEY": return "Clave pública del comercio. Se usa en el frontend para iniciar transacciones.";
      case "WOMPI_PRIVATE_KEY": return "Clave privada del comercio. Solo se usa en el backend para verificar y crear transacciones.";
      case "WOMPI_WEBHOOK_SECRET": return "Secreto para verificar la firma HMAC-SHA256 de los webhooks entrantes.";
      case "WOMPI_INTEGRITY_SECRET": return "Secreto para generar la firma de integridad de la transacción.";
      case "WOMPI_ENVIRONMENT": return "Ambiente: 'sandbox' para pruebas, 'production' para producción.";
      default: return "";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Settings className="h-6 w-6 text-amber-400" />
          Configuración y Auditoría
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Configure la pasarela de pagos Wompi y revise el trail de auditoría.
        </p>
      </div>

      {/* Gateway Configuration — Wompi Secrets */}
      <Card className="bg-slate-900/50 border-amber-500/20">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base flex items-center gap-2">
            <Key className="h-4 w-4 text-amber-400" />
            Configuración de Wompi
          </CardTitle>
          <CardDescription className="text-slate-400">
            Almacene las claves de la pasarela de forma segura. Los valores secretos nunca se muestran una vez guardados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {configLoading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando configuración...
            </div>
          ) : (
            gatewayConfig?.map((item) => (
              <div key={item.key} className="flex items-center justify-between p-3 rounded-lg border border-slate-700/50 bg-slate-800/30">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-slate-200">{item.key}</span>
                    {item.is_secret && (
                      <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">Secreto</Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{getKeyDescription(item.key)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  {item.configured ? (
                    <>
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1">
                        <CheckCircle className="h-3 w-3" />
                        {item.environment || "sandbox"}
                      </Badge>
                      {item.updated_at && (
                        <span className="text-xs text-slate-500">
                          {format(new Date(item.updated_at), "dd MMM", { locale: es })}
                        </span>
                      )}
                    </>
                  ) : (
                    <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">No configurado</Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => handleEditKey(item.key, item.environment)}
                  >
                    {item.configured ? "Actualizar" : "Configurar"}
                  </Button>
                </div>
              </div>
            ))
          )}

          <p className="text-xs text-amber-500/70 mt-3">
            ⚠️ Los valores secretos se almacenan cifrados en la base de datos y solo se usan en funciones del backend.
            Nunca se exponen al frontend ni se incluyen en logs.
          </p>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingKey} onOpenChange={(open) => { if (!open) setEditingKey(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar {editingKey}</DialogTitle>
            <DialogDescription>
              {editingKey && getKeyDescription(editingKey)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Ambiente</Label>
              <Select value={editEnvironment} onValueChange={setEditEnvironment}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox (Pruebas)</SelectItem>
                  <SelectItem value="production">Producción</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Valor</Label>
              <div className="relative">
                <Input
                  type={showValue ? "text" : "password"}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder={editingKey === "WOMPI_ENVIRONMENT" ? "sandbox o production" : "Ingrese el valor..."}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowValue(!showValue)}
                >
                  {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                El valor anterior será reemplazado. Esta acción se registra en auditoría.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingKey(null)} disabled={saveConfig.isPending}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saveConfig.isPending || !editValue.trim()}>
              {saveConfig.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit Policy */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-400" />
            Política de Auditoría
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-300">
          <p>• Toda acción administrativa genera un registro en <code className="text-amber-300">atenia_ai_actions</code> con actor, razón y evidencia.</p>
          <p>• Cada cambio de estado de suscripción crea una entrada inmutable en <code className="text-amber-300">subscription_events</code>.</p>
          <p>• Las anulaciones manuales (ADMIN_OVERRIDE) requieren justificación obligatoria y quedan marcadas explícitamente.</p>
          <p>• Todos los payloads almacenados pasan por <code className="text-amber-300">redactSecrets()</code> antes de persistirse.</p>
          <p>• Cambios en la configuración del gateway se registran en <code className="text-amber-300">audit_logs</code> con tipo GATEWAY_CONFIG_UPDATED.</p>
        </CardContent>
      </Card>

      {/* Audit Trail */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base flex items-center gap-2">
            <History className="h-4 w-4 text-amber-400" />
            Trail de Auditoría — Facturación
          </CardTitle>
          <CardDescription className="text-slate-400">
            Últimas 50 acciones de facturación registradas en atenia_ai_actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <p className="text-sm text-slate-400">Cargando...</p>
          ) : (auditActions?.length || 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay acciones de facturación registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Acción</th>
                    <th className="text-left py-2 px-2">Actor</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Razonamiento</th>
                  </tr>
                </thead>
                <tbody>
                  {auditActions?.map((a) => (
                    <tr key={a.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="py-2 px-2 text-slate-300">
                        {a.created_at ? format(new Date(a.created_at), "dd MMM HH:mm", { locale: es }) : "—"}
                      </td>
                      <td className="py-2 px-2">
                        <Badge variant="outline" className="text-xs">{a.action_type}</Badge>
                      </td>
                      <td className="py-2 px-2 text-slate-400">{a.actor || "SYSTEM"}</td>
                      <td className="py-2 px-2">
                        <Badge
                          className={
                            a.status === "EXECUTED"
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : a.status === "FAILED"
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : "bg-slate-500/20 text-slate-300 border-slate-500/30"
                          }
                        >
                          {a.status || "—"}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-slate-400 max-w-xs truncate">{a.reasoning}</td>
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
