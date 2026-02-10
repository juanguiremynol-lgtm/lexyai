/**
 * ProviderInstanceManager — Admin settings page for managing external provider instances.
 * Lists instances, allows creating new ones, testing connections, rotating secrets, and toggling enabled state.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Server,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  Key,
  Loader2,
  Plug,
  Globe,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useOrganization } from "@/contexts/OrganizationContext";

interface ProviderConnector {
  id: string;
  key: string;
  name: string;
  description: string | null;
  capabilities: string[];
  allowed_domains: string[];
  is_enabled: boolean;
}

interface ProviderInstance {
  id: string;
  organization_id: string;
  connector_id: string;
  name: string;
  base_url: string;
  auth_type: string;
  timeout_ms: number;
  rpm_limit: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  provider_connectors?: ProviderConnector;
}

export function ProviderInstanceManager() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRotateDialog, setShowRotateDialog] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, any>>({});

  // Form state
  const [formName, setFormName] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formAuthType, setFormAuthType] = useState("API_KEY");
  const [formSecret, setFormSecret] = useState("");
  const [formConnectorId, setFormConnectorId] = useState("");
  const [formTimeoutMs, setFormTimeoutMs] = useState("8000");
  const [formRpmLimit, setFormRpmLimit] = useState("60");
  const [rotateSecret, setRotateSecret] = useState("");

  // Load connectors
  const { data: connectors = [] } = useQuery({
    queryKey: ["provider-connectors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_connectors")
        .select("*")
        .eq("is_enabled", true)
        .order("name");
      if (error) throw error;
      return data as ProviderConnector[];
    },
  });

  // Load instances
  const { data: instances = [], isLoading } = useQuery({
    queryKey: ["provider-instances", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("provider_instances")
        .select("*, provider_connectors(*)")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      return data as ProviderInstance[];
    },
    enabled: !!orgId,
  });

  // Create instance
  const createMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("provider-create-instance", {
        body: {
          organization_id: orgId,
          connector_id: formConnectorId,
          name: formName,
          base_url: formBaseUrl,
          auth_type: formAuthType,
          secret_value: formSecret,
          timeout_ms: parseInt(formTimeoutMs) || 8000,
          rpm_limit: parseInt(formRpmLimit) || 60,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-instances"] });
      toast.success("Instancia de proveedor creada");
      resetForm();
      setShowCreateDialog(false);
    },
    onError: (err) => toast.error("Error: " + err.message),
  });

  // Test connection
  const testMutation = useMutation({
    mutationFn: async (instanceId: string) => {
      setTestingId(instanceId);
      const { data, error } = await supabase.functions.invoke("provider-test-connection", {
        body: { provider_instance_id: instanceId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { instanceId, results: data.results };
    },
    onSuccess: ({ instanceId, results }) => {
      setTestResults((prev) => ({ ...prev, [instanceId]: results }));
      const healthOk = results?.health?.ok;
      if (healthOk) {
        toast.success("Conexión verificada correctamente");
      } else {
        toast.error("La prueba de conexión falló");
      }
    },
    onError: (err) => toast.error("Error de conexión: " + err.message),
    onSettled: () => setTestingId(null),
  });

  // Rotate secret
  const rotateMutation = useMutation({
    mutationFn: async () => {
      if (!showRotateDialog || !rotateSecret) return;
      const { data, error } = await supabase.functions.invoke("provider-rotate-secret", {
        body: { provider_instance_id: showRotateDialog, new_secret_value: rotateSecret },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Secreto rotado a versión ${data?.key_version || "nueva"}`);
      setShowRotateDialog(null);
      setRotateSecret("");
    },
    onError: (err) => toast.error("Error al rotar: " + err.message),
  });

  // Toggle enabled
  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("provider_instances")
        .update({ is_enabled: enabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-instances"] }),
    onError: (err) => toast.error("Error: " + err.message),
  });

  function resetForm() {
    setFormName("");
    setFormBaseUrl("");
    setFormAuthType("API_KEY");
    setFormSecret("");
    setFormConnectorId("");
    setFormTimeoutMs("8000");
    setFormRpmLimit("60");
  }

  const selectedConnector = connectors.find((c) => c.id === formConnectorId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Proveedores Externos
              </CardTitle>
              <CardDescription>
                Conecta APIs externas de datos judiciales para sincronización automática
              </CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} disabled={connectors.length === 0}>
              <Plus className="h-4 w-4 mr-2" />
              Nueva Instancia
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : instances.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Plug className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No hay proveedores configurados</p>
              <p className="text-sm mt-1">Crea una instancia para conectar un API externo</p>
            </div>
          ) : (
            <div className="space-y-4">
              {instances.map((inst) => {
                const connector = inst.provider_connectors;
                const test = testResults[inst.id];
                return (
                  <div
                    key={inst.id}
                    className="border rounded-lg p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${inst.is_enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                          <Server className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{inst.name}</p>
                            <Badge variant={inst.is_enabled ? "default" : "secondary"} className="text-xs">
                              {inst.is_enabled ? "Activo" : "Deshabilitado"}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {connector?.name || "Conector"} · {new URL(inst.base_url).hostname}
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={inst.is_enabled}
                        onCheckedChange={(checked) => toggleMutation.mutate({ id: inst.id, enabled: checked })}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline">
                        <Shield className="h-3 w-3 mr-1" />
                        {inst.auth_type}
                      </Badge>
                      <Badge variant="outline">
                        <Clock className="h-3 w-3 mr-1" />
                        {inst.timeout_ms}ms
                      </Badge>
                      <Badge variant="outline">
                        <Zap className="h-3 w-3 mr-1" />
                        {inst.rpm_limit} rpm
                      </Badge>
                      {connector?.capabilities?.map((cap) => (
                        <Badge key={cap} variant="secondary" className="text-xs">
                          {cap}
                        </Badge>
                      ))}
                    </div>

                    {connector?.allowed_domains && connector.allowed_domains.length > 0 && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Globe className="h-3 w-3" />
                        Dominios: {connector.allowed_domains.join(", ")}
                      </div>
                    )}

                    {test && (
                      <div className="bg-muted/50 rounded p-3 text-sm space-y-1">
                        <div className="flex items-center gap-2">
                          {test.health?.ok ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                          <span>Health: {test.health?.ok ? "OK" : "Error"}</span>
                          {test.health?.latency_ms && (
                            <span className="text-muted-foreground">({test.health.latency_ms}ms)</span>
                          )}
                        </div>
                        {test.capabilities && (
                          <div className="flex items-center gap-2">
                            {test.capabilities.ok ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                            <span>Capabilities: {test.capabilities.ok ? "OK" : "Error"}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testMutation.mutate(inst.id)}
                        disabled={testingId === inst.id}
                      >
                        {testingId === inst.id ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3 mr-1" />
                        )}
                        Probar conexión
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowRotateDialog(inst.id)}
                      >
                        <Key className="h-3 w-3 mr-1" />
                        Rotar secreto
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Creado {formatDistanceToNow(new Date(inst.created_at), { addSuffix: true, locale: es })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Instance Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva Instancia de Proveedor</DialogTitle>
            <DialogDescription>
              Configura una conexión a un API externo de datos judiciales
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Conector</Label>
              <Select value={formConnectorId} onValueChange={setFormConnectorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un conector" />
                </SelectTrigger>
                <SelectContent>
                  {connectors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.key})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedConnector?.description && (
                <p className="text-xs text-muted-foreground">{selectedConnector.description}</p>
              )}
              {selectedConnector?.allowed_domains && (
                <p className="text-xs text-muted-foreground">
                  Dominios permitidos: {selectedConnector.allowed_domains.join(", ")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="inst-name">Nombre</Label>
              <Input
                id="inst-name"
                placeholder="Mi proveedor"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="inst-url">URL Base (HTTPS)</Label>
              <Input
                id="inst-url"
                placeholder="https://api.proveedor.com/v1"
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Solo HTTPS. El dominio debe estar en la lista permitida del conector.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo de Auth</Label>
                <Select value={formAuthType} onValueChange={setFormAuthType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="API_KEY">API Key</SelectItem>
                    <SelectItem value="HMAC_SHARED_SECRET">HMAC Shared Secret</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inst-secret">Secreto / API Key</Label>
                <Input
                  id="inst-secret"
                  type="password"
                  placeholder="••••••••"
                  value={formSecret}
                  onChange={(e) => setFormSecret(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="inst-timeout">Timeout (ms)</Label>
                <Input
                  id="inst-timeout"
                  type="number"
                  value={formTimeoutMs}
                  onChange={(e) => setFormTimeoutMs(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inst-rpm">RPM Limit</Label>
                <Input
                  id="inst-rpm"
                  type="number"
                  value={formRpmLimit}
                  onChange={(e) => setFormRpmLimit(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !formConnectorId || !formName || !formBaseUrl || !formSecret}
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Crear Instancia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotate Secret Dialog */}
      <AlertDialog open={!!showRotateDialog} onOpenChange={() => { setShowRotateDialog(null); setRotateSecret(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotar Secreto</AlertDialogTitle>
            <AlertDialogDescription>
              Ingresa el nuevo secreto / API key. El secreto anterior será desactivado inmediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label htmlFor="rotate-secret">Nuevo Secreto</Label>
            <Input
              id="rotate-secret"
              type="password"
              placeholder="••••••••"
              value={rotateSecret}
              onChange={(e) => setRotateSecret(e.target.value)}
              className="mt-2"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rotateMutation.mutate()}
              disabled={rotateMutation.isPending || !rotateSecret}
            >
              {rotateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Rotar Secreto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
