/**
 * Step 3 — Instance Provisioning
 * PLATFORM mode: single platform-managed instance (no org selection, stored once).
 * ORG mode: org-scoped instance as before.
 * Supports secret management for already-saved instances (rotation/initial setup).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Check, Key, Loader2, Server, ShieldAlert, Info, Globe, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWizardSessionContext } from "../WizardSessionContext";
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
  const { invokeWithSession } = useWizardSessionContext();
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

  // Check secret status for existing instances
  const { data: secretStatus, refetch: refetchSecretStatus } = useQuery({
    queryKey: ["instance-secret-status", instance?.id],
    queryFn: async () => {
      if (!instance?.id) return null;
      const { data } = await supabase
        .from("provider_instance_secrets")
        .select("id, is_active, key_version, scope, created_at")
        .eq("provider_instance_id", instance.id)
        .eq("is_active", true)
        .order("key_version", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!instance?.id,
  });

  // Check readiness status (decrypt success/failure)
  const { data: readinessStatus, refetch: refetchReadiness } = useQuery({
    queryKey: ["provider-readiness", connector?.id],
    queryFn: async () => {
      if (!connector?.id) return null;
      try {
        const res = await fetch(
          `https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/provider-secret-readiness?connector_id=${encodeURIComponent(connector.id)}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}`,
            },
          }
        );
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    enabled: !!connector?.id && !!instance?.id,
  });

  const hasActiveSecret = !!secretStatus;
  const decryptFailed = readinessStatus?.failure_reason === "DECRYPT_FAILED";

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!baseUrlValid) throw new Error("base_url inválido o no en allowlist");
      if (!secretValue.trim()) throw new Error("Secreto requerido");
      if (!isPlatform && !orgId) throw new Error("Organización requerida");

      const { data, error } = await invokeWithSession("provider-create-instance", {
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
      refetchSecretStatus();
      onInstanceSaved(inst);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Mutation for setting secret on existing instance
  const setSecretMutation = useMutation({
    mutationFn: async () => {
      if (!instance?.id) throw new Error("No instance selected");
      if (!secretValue.trim()) throw new Error("Secreto requerido");

      const { data, error } = await invokeWithSession("provider-set-instance-secret", {
        body: {
          instance_id: instance.id,
          secret_value: secretValue.trim(),
          enable: true,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Secreto v${data.secret?.key_version || "?"} configurado y activo`);
      setSecretValue("");
      refetchSecretStatus();
      refetchReadiness();
      queryClient.invalidateQueries({ queryKey: ["instance-secret-status"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Mutation for re-encrypting secret (DECRYPT_FAILED remediation)
  const reencryptMutation = useMutation({
    mutationFn: async () => {
      if (!instance?.id) throw new Error("No instance selected");
      if (!secretValue.trim()) throw new Error("Secreto requerido para re-encriptar");

      const { data, error } = await invokeWithSession("provider-set-instance-secret", {
        body: {
          instance_id: instance.id,
          secret_value: secretValue.trim(),
          mode: "REENCRYPT",
          enable: true,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Secreto re-encriptado (v${data.secret?.key_version || "?"}) — sin cambios en el valor`);
      setSecretValue("");
      refetchSecretStatus();
      refetchReadiness();
      queryClient.invalidateQueries({ queryKey: ["instance-secret-status"] });
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
              Esta instancia se gestiona <strong>centralmente por el Super Admin</strong>. Las credenciales se almacenan una sola vez y se usan automáticamente para todas las organizaciones.
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

        {!isPlatform && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Organización</Label>
            <Input value="Mi Organización" disabled />
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Nombre de instancia</Label>
          <Input value={instanceName} onChange={(e) => setInstanceName(e.target.value)} disabled={alreadySaved} />
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
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://my-provider.example.com" disabled={alreadySaved} />
          {baseUrlHost && !hostInAllowlist && (
            <p className="text-xs text-destructive">
              El host "{baseUrlHost}" no coincide con: [{allowlist.join(", ")}]
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Auth Mode</Label>
            <Select value={authType} onValueChange={setAuthType} disabled={alreadySaved}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="API_KEY">API_KEY</SelectItem>
                <SelectItem value="HMAC_SHARED_SECRET">HMAC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Timeout (ms)</Label>
            <Input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} disabled={alreadySaved} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Rate Limit (rpm)</Label>
            <Input type="number" value={rpmLimit} onChange={(e) => setRpmLimit(Number(e.target.value))} disabled={alreadySaved} />
          </div>
        </div>

        {/* Secret Section */}
        <div className="space-y-3 border border-border/50 rounded-lg p-4 bg-muted/20">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground flex items-center gap-2">
              <Key className="h-3.5 w-3.5 text-primary" />
              {alreadySaved ? "Estado del Secreto" : `Secreto (${authType === "API_KEY" ? "API Key" : "HMAC Secret"})`}
            </Label>
            {alreadySaved && decryptFailed && (
              <Badge variant="destructive" className="text-[10px]">
                <AlertTriangle className="h-3 w-3 mr-1" /> No puede descifrarse
              </Badge>
            )}
            {alreadySaved && hasActiveSecret && !decryptFailed && (
              <Badge variant="outline" className="text-[10px] text-primary border-primary/30 bg-primary/10">
                <CheckCircle2 className="h-3 w-3 mr-1" /> v{secretStatus?.key_version} activo
              </Badge>
            )}
            {alreadySaved && !hasActiveSecret && !decryptFailed && (
              <Badge variant="destructive" className="text-[10px]">
                <AlertTriangle className="h-3 w-3 mr-1" /> Sin secreto activo
              </Badge>
            )}
          </div>

          {decryptFailed && (
            <div className="flex items-start gap-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>⚠️ El secreto existe pero no puede descifrarse.</strong> Re-encripte con la clave actual de la plataforma.
                El valor del secreto no cambiará.
              </span>
            </div>
          )}

          {alreadySaved && !hasActiveSecret && !decryptFailed && (
            <div className="flex items-start gap-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>⚠️ Sin secreto activo.</strong> El proveedor no podrá sincronizar datos.
                Ingrese la API Key a continuación para activar esta instancia.
              </span>
            </div>
          )}

          <Input
            type="password"
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
            placeholder={decryptFailed ? "Pegue el mismo valor de API Key para re-encriptar" : alreadySaved ? "Ingrese nueva API Key para configurar/rotar" : "Write-only — no se mostrará después"}
          />

          {alreadySaved && (
            <div className="flex gap-2">
              {decryptFailed ? (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => reencryptMutation.mutate()}
                  disabled={reencryptMutation.isPending || !secretValue.trim()}
                  className="gap-2"
                >
                  {reencryptMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  <RefreshCw className="h-3 w-3" />
                  Re-encriptar (sin cambiar el secreto)
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={hasActiveSecret ? "outline" : "default"}
                  onClick={() => setSecretMutation.mutate()}
                  disabled={setSecretMutation.isPending || !secretValue.trim()}
                  className="gap-2"
                >
                  {setSecretMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  <RefreshCw className="h-3 w-3" />
                  {hasActiveSecret ? "Rotar Secreto" : "Configurar Secreto"}
                </Button>
              )}
            </div>
          )}
        </div>

        {alreadySaved && hasActiveSecret && (
          <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <Check className="h-4 w-4 text-primary" />
            <span className="text-sm text-foreground/80">Instancia guardada: {instance.name}</span>
          </div>
        )}

        {isPlatform && (
          <div className={`flex items-center gap-2 text-xs rounded-lg p-3 border ${
            alreadySaved && hasActiveSecret
              ? "bg-primary/5 border-primary/20"
              : alreadySaved && !hasActiveSecret
              ? "bg-destructive/5 border-destructive/20"
              : "bg-muted/30 border-border/50"
          }`}>
            {alreadySaved && hasActiveSecret ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-foreground/80">
                  <strong className="text-primary">Activo</strong> — Secret: ✅ activo (v{secretStatus?.key_version}). Aplica automáticamente a todas las organizaciones.
                </span>
              </>
            ) : alreadySaved && !hasActiveSecret ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                <span className="text-destructive">
                  <strong>Instancia creada pero SIN SECRETO ACTIVO</strong> — Configure la API Key arriba para activar el proveedor.
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">
                  <strong>No activo</strong> — Cree la instancia de plataforma para activar el proveedor.
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
            ? "Crea una única instancia centralizada con credenciales que se usan automáticamente para todas las organizaciones."
            : "Crea una conexión concreta con la API del proveedor: URL base, credenciales (encriptadas AES-256-GCM), y límites de rate."
          }
          whyItMatters={isPlatform
            ? "Al centralizar la instancia, el Super Admin controla las credenciales, URL y rate limits. Las organizaciones se benefician sin configurar nada."
            : "La instancia conecta el template abstracto con la API real. Los secretos se almacenan encriptados y nunca se exponen en la UI."
          }
          commonMistakes={[
            "URL con HTTP en vez de HTTPS → rechazado por SSRF",
            "Host que no coincide con la allowlist del conector",
            "Timeout demasiado bajo para APIs lentas (8-15s para judiciales)",
            "Crear instancia sin secreto → el proveedor no podrá autenticarse",
          ]}
        />
      </div>
    </div>
  );
}