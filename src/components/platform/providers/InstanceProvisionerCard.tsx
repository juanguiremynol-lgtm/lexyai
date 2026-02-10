/**
 * InstanceProvisionerCard — Create/manage provider instances for a target org.
 * Handles secret input (write-only), rotation, and SSRF base_url pre-validation.
 */

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Check, Copy, Key, Loader2, RefreshCw, Server, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Connector {
  id: string;
  key: string;
  name: string;
  allowed_domains: string[];
  is_enabled: boolean;
  capabilities: string[];
}

interface Instance {
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
}

type InstanceStatus = "NOT_CONFIGURED" | "NEEDS_REVIEW" | "READY" | "ERROR";

interface InstanceProvisionerCardProps {
  connector: Connector | null;
  selectedInstance: Instance | null;
  onInstanceChange: (i: Instance | null) => void;
}

function getBaseUrlHost(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function isHostInAllowlist(host: string, allowlist: string[]): boolean {
  const h = host.toLowerCase();
  for (const pat of allowlist) {
    const p = pat.toLowerCase().trim();
    if (!p) continue;
    if (p.startsWith("*.")) {
      const suffix = p.slice(1);
      if (h === p.slice(2) || h.endsWith(suffix)) return true;
    } else if (h === p) return true;
  }
  return false;
}

export function InstanceProvisionerCard({ connector, selectedInstance, onInstanceChange }: InstanceProvisionerCardProps) {
  const queryClient = useQueryClient();

  const [orgId, setOrgId] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://");
  const [authType, setAuthType] = useState("API_KEY");
  const [secretValue, setSecretValue] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(8000);
  const [rpmLimit, setRpmLimit] = useState(60);
  const [isEnabled, setIsEnabled] = useState(true);
  const [hasSecret, setHasSecret] = useState(false);
  const [showRotate, setShowRotate] = useState(false);
  const [newSecretValue, setNewSecretValue] = useState("");

  // Load orgs
  const { data: organizations } = useQuery({
    queryKey: ["platform-all-organizations"],
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("id, name").order("name");
      return data || [];
    },
  });

  // Load existing instances for this connector
  const { data: instances } = useQuery({
    queryKey: ["provider-instances", connector?.id],
    queryFn: async () => {
      if (!connector) return [];
      const { data } = await supabase
        .from("provider_instances")
        .select("*")
        .eq("connector_id", connector.id)
        .order("created_at", { ascending: false });
      return (data || []) as Instance[];
    },
    enabled: !!connector,
  });

  useEffect(() => {
    if (selectedInstance) {
      setOrgId(selectedInstance.organization_id);
      setInstanceName(selectedInstance.name);
      setBaseUrl(selectedInstance.base_url);
      setAuthType(selectedInstance.auth_type);
      setTimeoutMs(selectedInstance.timeout_ms);
      setRpmLimit(selectedInstance.rpm_limit);
      setIsEnabled(selectedInstance.is_enabled);
      setHasSecret(true);
      setSecretValue("");
    }
  }, [selectedInstance]);

  const baseUrlHost = getBaseUrlHost(baseUrl);
  const isHttps = baseUrl.startsWith("https://");
  const allowlist = connector?.allowed_domains || [];
  const hostInAllowlist = baseUrlHost ? isHostInAllowlist(baseUrlHost, allowlist) : false;
  const baseUrlValid = isHttps && baseUrlHost && hostInAllowlist;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!connector) throw new Error("Seleccione un conector primero");
      if (!baseUrlValid) throw new Error("base_url inválido o no está en la allowlist del conector");
      if (!secretValue.trim()) throw new Error("El secreto es requerido para la primera creación");

      const { data, error } = await supabase.functions.invoke("provider-create-instance", {
        body: {
          organization_id: orgId,
          connector_id: connector.id,
          name: instanceName.trim(),
          base_url: baseUrl.trim(),
          auth_type: authType,
          secret_value: secretValue,
          timeout_ms: timeoutMs,
          rpm_limit: rpmLimit,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.instance as Instance;
    },
    onSuccess: (inst) => {
      toast.success("Instancia creada exitosamente");
      setSecretValue("");
      setHasSecret(true);
      queryClient.invalidateQueries({ queryKey: ["provider-instances"] });
      onInstanceChange(inst);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rotateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedInstance) throw new Error("No instance selected");
      if (!newSecretValue.trim()) throw new Error("Ingrese el nuevo secreto");

      const { data, error } = await supabase.functions.invoke("provider-rotate-secret", {
        body: {
          provider_instance_id: selectedInstance.id,
          new_secret_value: newSecretValue,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Secreto rotado a versión ${data.key_version}`);
      setNewSecretValue("");
      setShowRotate(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const status: InstanceStatus = !selectedInstance
    ? "NOT_CONFIGURED"
    : !hasSecret ? "ERROR"
    : !baseUrlValid ? "NEEDS_REVIEW"
    : "READY";

  const statusMap = {
    NOT_CONFIGURED: { label: "No configurado", className: "text-slate-400 border-slate-600" },
    NEEDS_REVIEW: { label: "Necesita revisión", className: "text-amber-400 border-amber-500/50 bg-amber-500/10" },
    READY: { label: "Listo", className: "text-emerald-400 border-emerald-500/50 bg-emerald-500/10" },
    ERROR: { label: "Error", className: "text-red-400 border-red-500/50 bg-red-500/10" },
  };

  const copyConfig = () => {
    const config = {
      organization_id: orgId,
      connector_id: connector?.id,
      name: instanceName,
      base_url: baseUrl,
      auth_type: authType,
      timeout_ms: timeoutMs,
      rpm_limit: rpmLimit,
      is_enabled: isEnabled,
      has_secret: hasSecret,
    };
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    toast.success("Configuración copiada (sin secretos)");
  };

  if (!connector) {
    return (
      <Card className="border-slate-700 bg-slate-900/50 opacity-60">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Server className="h-5 w-5 text-amber-400" />
            B) Instancia para Organización
          </CardTitle>
          <CardDescription>Seleccione un conector primero en el panel A</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Server className="h-5 w-5 text-amber-400" />
            B) Instancia para Organización
          </CardTitle>
          <CardDescription>Provisionar instancia con conector: {connector.name}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={statusMap[status].className}>{statusMap[status].label}</Badge>
          <Button size="sm" variant="ghost" onClick={copyConfig}><Copy className="h-4 w-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Instance selector */}
        {instances && instances.length > 0 && (
          <div className="space-y-2">
            <Label className="text-slate-300">Instancias existentes</Label>
            <div className="flex flex-wrap gap-2">
              {instances.map((inst) => {
                const orgName = organizations?.find((o) => o.id === inst.organization_id)?.name || inst.organization_id.slice(0, 8);
                return (
                  <Button
                    key={inst.id}
                    size="sm"
                    variant={selectedInstance?.id === inst.id ? "default" : "outline"}
                    className={selectedInstance?.id === inst.id ? "bg-amber-600 hover:bg-amber-700" : "border-slate-600"}
                    onClick={() => onInstanceChange(inst)}
                  >
                    {inst.name} ({orgName})
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Organización</Label>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger className="bg-slate-800 border-slate-600">
                <SelectValue placeholder="Seleccionar organización..." />
              </SelectTrigger>
              <SelectContent>
                {organizations?.map((org) => (
                  <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Nombre de instancia</Label>
            <Input
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              placeholder="CPNU Provider - OrgX"
              className="bg-slate-800 border-slate-600"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-300 flex items-center gap-2">
            Base URL
            {baseUrl.length > 8 && !isHttps && (
              <Badge variant="destructive" className="text-xs">Solo HTTPS permitido</Badge>
            )}
            {baseUrlHost && !hostInAllowlist && (
              <Badge variant="destructive" className="text-xs">
                <ShieldAlert className="h-3 w-3 mr-1" />
                Host no está en allowlist
              </Badge>
            )}
            {baseUrlValid && (
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/50 bg-emerald-500/10 text-xs">
                <Check className="h-3 w-3 mr-1" /> SSRF OK
              </Badge>
            )}
          </Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://my-provider.example.com"
            className="bg-slate-800 border-slate-600"
          />
          {baseUrlHost && !hostInAllowlist && (
            <p className="text-xs text-red-400">
              El host "{baseUrlHost}" no coincide con la allowlist del conector: [{allowlist.join(", ")}]
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">Auth Mode</Label>
            <Select value={authType} onValueChange={setAuthType}>
              <SelectTrigger className="bg-slate-800 border-slate-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="API_KEY">API_KEY</SelectItem>
                <SelectItem value="HMAC_SHARED_SECRET">HMAC_SHARED_SECRET</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Timeout (ms)</Label>
            <Input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className="bg-slate-800 border-slate-600"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Rate Limit (rpm)</Label>
            <Input
              type="number"
              value={rpmLimit}
              onChange={(e) => setRpmLimit(Number(e.target.value))}
              className="bg-slate-800 border-slate-600"
            />
          </div>
        </div>

        {/* Secret management */}
        <div className="space-y-2 border border-slate-700 rounded-lg p-4 bg-slate-800/30">
          <Label className="text-slate-300 flex items-center gap-2">
            <Key className="h-4 w-4 text-amber-400" />
            Secreto ({authType === "API_KEY" ? "API Key" : "HMAC Shared Secret"})
          </Label>
          {hasSecret && selectedInstance ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-emerald-400 border-emerald-500/50 bg-emerald-500/10">
                  <Check className="h-3 w-3 mr-1" /> Secreto almacenado ✓
                </Badge>
                <Button size="sm" variant="outline" className="border-slate-600" onClick={() => setShowRotate(!showRotate)}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Rotar secreto
                </Button>
              </div>
              {showRotate && (
                <div className="flex gap-2 mt-2">
                  <Input
                    type="password"
                    value={newSecretValue}
                    onChange={(e) => setNewSecretValue(e.target.value)}
                    placeholder="Nuevo secreto..."
                    className="bg-slate-800 border-slate-600"
                  />
                  <Button
                    onClick={() => rotateMutation.mutate()}
                    disabled={rotateMutation.isPending || !newSecretValue.trim()}
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    {rotateMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Rotar
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Input
              type="password"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder="Ingrese el secreto (write-only, no se mostrará después)"
              className="bg-slate-800 border-slate-600"
            />
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            <Label className="text-slate-300">Habilitado</Label>
          </div>
          {!selectedInstance && (
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !baseUrlValid || !orgId || !instanceName.trim() || !secretValue.trim()}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Crear Instancia
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
