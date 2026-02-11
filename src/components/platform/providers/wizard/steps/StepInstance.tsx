/**
 * Step 3 — Instance Provisioning
 * PLATFORM mode: single platform-managed instance (no org selection, stored once).
 * ORG mode: org-scoped instance as before.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Check, Key, Loader2, Server, ShieldAlert, Info, Globe, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardConnector, WizardInstance, WizardMode } from "../WizardTypes";

interface StepInstanceProps {
  mode: WizardMode;
  connector: WizardConnector;
  instance: WizardInstance | null;
  organizationId: string | null;
  onInstanceSaved: (i: WizardInstance, coverageCount?: number) => void;
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
  const [instanceName, setInstanceName] = useState(instance?.name || `${connector.name} ${isPlatform ? "Platform" : ""} Instance`);
  const [baseUrl, setBaseUrl] = useState(instance?.base_url || "https://");
  const [authType, setAuthType] = useState(instance?.auth_type || "API_KEY");
  const [secretValue, setSecretValue] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(instance?.timeout_ms || 8000);
  const [rpmLimit, setRpmLimit] = useState(instance?.rpm_limit || 60);

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
      if (!isPlatform && !orgId) throw new Error("Organización requerida");

      const { data, error } = await supabase.functions.invoke("provider-create-instance", {
        body: {
          organization_id: isPlatform ? null : orgId,
          connector_id: connector.id,
          name: instanceName.trim(),
          base_url: baseUrl.trim(),
          auth_type: authType,
          secret_value: secretValue,
          timeout_ms: timeoutMs,
          rpm_limit: rpmLimit,
          scope: isPlatform ? "PLATFORM" : "ORG",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.instance as WizardInstance;
    },
    onSuccess: (inst) => {
      toast.success(isPlatform ? "Instancia de plataforma creada — activa para todas las organizaciones" : "Instancia creada");
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
          {isPlatform ? "Instancia de Plataforma" : "Provisionar Instancia"}
        </h2>

        {isPlatform ? (
          <div className="flex items-start gap-2 text-xs bg-primary/5 border border-primary/20 rounded-lg p-3">
            <Globe className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span className="text-foreground/80">
              Esta instancia se gestiona <strong>centralmente por el Super Admin</strong>. Las credenciales se almacenan una sola vez y se usan automáticamente para todas las organizaciones. Los administradores de organización y usuarios no necesitan configurar nada.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-xs bg-primary/5 border border-primary/20 rounded-lg p-3">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span className="text-foreground/80">
              Esta instancia es <strong>específica de tu organización</strong>. Las credenciales solo se usan para tu org.
            </span>
          </div>
        )}

        {/* Org selector — only for ORG mode */}
        {!isPlatform && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Organización</Label>
            <Input value="Mi Organización" disabled />
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Nombre de instancia</Label>
          <Input value={instanceName} onChange={(e) => setInstanceName(e.target.value)} />
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
              <Badge variant="outline" className="text-[10px] text-primary border-primary/30 bg-primary/10">
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
          <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <Check className="h-4 w-4 text-primary" />
            <span className="text-sm text-foreground/80">Instancia guardada: {instance.name}</span>
          </div>
        )}

        {/* Activation status for PLATFORM */}
        {isPlatform && (
          <div className={`flex items-center gap-2 text-xs rounded-lg p-3 border ${
            alreadySaved
              ? "bg-primary/5 border-primary/20"
              : "bg-muted/30 border-border/50"
          }`}>
            {alreadySaved ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-foreground/80">
                  <strong className="text-primary">Activo</strong> — Esta instancia de plataforma aplica automáticamente a todas las organizaciones. Cobertura: 100% orgs.
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">
                  <strong>No activo</strong> — Cree la instancia de plataforma para activar el proveedor para todas las organizaciones.
                </span>
              </>
            )}
          </div>
        )}

        <div className="flex justify-between items-center">
          {!alreadySaved ? (
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !baseUrlValid || (!isPlatform && !orgId) || !instanceName.trim() || !secretValue.trim()}
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {isPlatform ? "Crear Instancia de Plataforma" : "Crear Instancia"}
            </Button>
          ) : <div />}
          <Button onClick={onNext} disabled={!alreadySaved && !createMutation.isSuccess} className="gap-2">
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title={isPlatform ? "Instancia de Plataforma" : "Instancia de Proveedor"}
          whatItDoes={isPlatform
            ? "Crea una única instancia centralizada con credenciales que se usan automáticamente para todas las organizaciones. No requiere acción de los org admins."
            : "Crea una conexión concreta con la API del proveedor: URL base, credenciales (encriptadas AES-256-GCM), y límites de rate."
          }
          whyItMatters={isPlatform
            ? "Al centralizar la instancia, el Super Admin controla las credenciales, URL y rate limits. Las organizaciones se benefician sin configurar nada."
            : "La instancia conecta el template abstracto con la API real. Los secretos se almacenan encriptados y nunca se exponen en la UI."
          }
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
