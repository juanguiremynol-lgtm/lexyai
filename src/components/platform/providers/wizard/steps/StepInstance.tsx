/**
 * Step 3 — Instance Provisioning (Org-scoped)
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Check, Key, Loader2, Server, ShieldAlert, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardConnector, WizardInstance, WizardMode } from "../WizardTypes";

interface StepInstanceProps {
  mode: WizardMode;
  connector: WizardConnector;
  instance: WizardInstance | null;
  organizationId: string | null;
  onInstanceSaved: (i: WizardInstance) => void;
  onNext: () => void;
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

export function StepInstance({ mode, connector, instance, organizationId, onInstanceSaved, onNext }: StepInstanceProps) {
  const queryClient = useQueryClient();
  const isPlatform = mode === "PLATFORM";

  const [orgId, setOrgId] = useState(organizationId || "");
  const [instanceName, setInstanceName] = useState(instance?.name || `${connector.name} Instance`);
  const [baseUrl, setBaseUrl] = useState(instance?.base_url || "https://");
  const [authType, setAuthType] = useState(instance?.auth_type || "API_KEY");
  const [secretValue, setSecretValue] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(instance?.timeout_ms || 8000);
  const [rpmLimit, setRpmLimit] = useState(instance?.rpm_limit || 60);

  const { data: organizations } = useQuery({
    queryKey: ["wizard-orgs"],
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("id, name").order("name");
      return data || [];
    },
    enabled: isPlatform, // Only platform admins need the full list
  });

  const baseUrlHost = getBaseUrlHost(baseUrl);
  const isHttps = baseUrl.startsWith("https://");
  const allowlist = connector.allowed_domains || [];
  const hostInAllowlist = baseUrlHost ? isHostInAllowlist(baseUrlHost, allowlist) : false;
  const baseUrlValid = isHttps && baseUrlHost && hostInAllowlist;
  const alreadySaved = !!instance;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!baseUrlValid) throw new Error("base_url inválido o no en allowlist");
      if (!secretValue.trim()) throw new Error("Secreto requerido");

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
      return data.instance as WizardInstance;
    },
    onSuccess: (inst) => {
      toast.success("Instancia creada");
      setSecretValue("");
      queryClient.invalidateQueries({ queryKey: ["provider-instances"] });
      onInstanceSaved(inst);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-5">
        <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
          <Server className="h-5 w-5 text-primary" />
          Provisionar Instancia
        </h2>

        {isPlatform && (
          <div className="flex items-start gap-2 text-xs bg-primary/5 border border-primary/20 rounded-lg p-3">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span className="text-foreground/80">
              Como Super Admin, crea una instancia de prueba bajo tu organización. Cada org creará la suya con sus propios secretos.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Organización</Label>
            {isPlatform ? (
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  {organizations?.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value="Mi Organización" disabled />
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nombre de instancia</Label>
            <Input value={instanceName} onChange={(e) => setInstanceName(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-2">
            Base URL
            {baseUrl.length > 8 && !isHttps && <Badge variant="destructive" className="text-[10px]">Solo HTTPS</Badge>}
            {baseUrlHost && !hostInAllowlist && (
              <Badge variant="destructive" className="text-[10px]">
                <ShieldAlert className="h-3 w-3 mr-1" /> Host no en allowlist
              </Badge>
            )}
            {baseUrlValid && (
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30 bg-emerald-500/10">
                <Check className="h-3 w-3 mr-1" /> SSRF OK
              </Badge>
            )}
          </Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://my-provider.example.com" />
          {baseUrlHost && !hostInAllowlist && (
            <p className="text-xs text-destructive">
              El host "{baseUrlHost}" no coincide con: [{allowlist.join(", ")}]
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Auth Mode</Label>
            <Select value={authType} onValueChange={setAuthType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="API_KEY">API_KEY</SelectItem>
                <SelectItem value="HMAC_SHARED_SECRET">HMAC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Timeout (ms)</Label>
            <Input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Rate Limit (rpm)</Label>
            <Input type="number" value={rpmLimit} onChange={(e) => setRpmLimit(Number(e.target.value))} />
          </div>
        </div>

        {/* Secret */}
        {!alreadySaved && (
          <div className="space-y-1.5 border border-border/50 rounded-lg p-4 bg-muted/20">
            <Label className="text-xs text-muted-foreground flex items-center gap-2">
              <Key className="h-3.5 w-3.5 text-primary" />
              Secreto ({authType === "API_KEY" ? "API Key" : "HMAC Secret"})
            </Label>
            <Input type="password" value={secretValue} onChange={(e) => setSecretValue(e.target.value)} placeholder="Write-only — no se mostrará después" />
          </div>
        )}

        {alreadySaved && (
          <div className="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
            <Check className="h-4 w-4 text-emerald-500" />
            <span className="text-sm text-emerald-700">Instancia guardada: {instance.name}</span>
          </div>
        )}

        <div className="flex justify-between items-center">
          {!alreadySaved ? (
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !baseUrlValid || !orgId || !instanceName.trim() || !secretValue.trim()}
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Crear Instancia
            </Button>
          ) : <div />}
          <Button onClick={onNext} disabled={!alreadySaved && !createMutation.isSuccess} className="gap-2">
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Instancia de Proveedor"
          whatItDoes="Crea una conexión concreta con la API del proveedor: URL base, credenciales (encriptadas AES-256-GCM), y límites de rate."
          whyItMatters="La instancia conecta el template abstracto con la API real. Los secretos se almacenan encriptados y nunca se exponen en la UI."
          commonMistakes={[
            "URL con HTTP en vez de HTTPS → rechazado por SSRF",
            "Host que no coincide con la allowlist del conector",
            "Timeout demasiado bajo para APIs lentas (proveedores judiciales suelen necesitar 8-15s)",
          ]}
        />
      </div>
    </div>
  );
}
