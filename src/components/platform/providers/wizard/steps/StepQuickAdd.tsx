/**
 * StepQuickAdd — Streamlined provider onboarding.
 * Accepts: Provider Name, Base URL, and API Key/Master Key.
 * Auto-creates connector + instance in one step.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Check, Key, Loader2, Zap, Globe, Building2, Link, Type, ShieldCheck, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardMode, WizardConnector, WizardInstance } from "../WizardTypes";

interface StepQuickAddProps {
  mode: WizardMode;
  organizationId: string | null;
  onComplete: (connector: WizardConnector, instance: WizardInstance) => void;
  onNext: () => void;
}

const WORKFLOW_OPTIONS = [
  { value: "CGP", label: "CGP — Código General del Proceso" },
  { value: "LABORAL", label: "LABORAL — Proceso Laboral" },
  { value: "CPACA", label: "CPACA — Contencioso Administrativo" },
  { value: "TUTELA", label: "TUTELA — Acción de Tutela" },
  { value: "PENAL_906", label: "PENAL — Ley 906" },
];

/** Derive a slug key from the provider name */
function deriveKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

/** Extract hostname from a URL */
function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function StepQuickAdd({ mode, organizationId, onComplete, onNext }: StepQuickAddProps) {
  const queryClient = useQueryClient();
  const isPlatform = mode === "PLATFORM";

  const [providerName, setProviderName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [masterKey, setMasterKey] = useState("");
  const [workflow, setWorkflow] = useState("CPACA");
  const [completed, setCompleted] = useState(false);

  // Fetch existing connectors to show as reference
  const { data: existingConnectors } = useQuery({
    queryKey: ["wizard-connectors-quickadd"],
    queryFn: async () => {
      const { data } = await supabase
        .from("provider_connectors")
        .select("id, key, name, allowed_domains, is_enabled")
        .eq("is_enabled", true)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const host = extractHost(baseUrl);
  const isHttps = baseUrl.startsWith("https://");
  const isValid = providerName.trim().length > 0 && isHttps && host && masterKey.trim().length > 0;

  const quickAddMutation = useMutation({
    mutationFn: async () => {
      if (!isValid) throw new Error("Todos los campos son requeridos");

      const key = deriveKey(providerName);
      const hostname = host!;
      const visibility = isPlatform ? "GLOBAL" : "ORG_PRIVATE";

      // 1. Create connector
      const { data: connData, error: connErr } = await supabase.functions.invoke("provider-create-connector", {
        body: {
          key,
          name: providerName.trim(),
          description: `Proveedor externo: ${providerName.trim()}`,
          capabilities: ["ACTUACIONES", "PUBLICACIONES"],
          allowed_domains: [hostname],
          schema_version: "atenia.v1",
          visibility,
          organization_id: visibility === "ORG_PRIVATE" ? organizationId : undefined,
        },
      });
      if (connErr) throw connErr;
      if (connData?.error) throw new Error(connData.error);
      const connector = connData.connector as WizardConnector;

      // 2. Create instance
      const { data: instData, error: instErr } = await supabase.functions.invoke("provider-create-instance", {
        body: {
          organization_id: isPlatform ? null : organizationId,
          connector_id: connector.id,
          name: `${providerName.trim()} (${isPlatform ? "Platform" : "Org"})`,
          base_url: baseUrl.trim(),
          auth_type: "API_KEY",
          secret_value: masterKey.trim(),
          timeout_ms: 10000,
          rpm_limit: 60,
          scope: isPlatform ? "PLATFORM" : "ORG",
        },
      });
      if (instErr) throw instErr;
      if (instData?.error) throw new Error(instData.error);
      const instance = instData.instance as WizardInstance;

      // 3. Create global route
      const routeFn = isPlatform ? "provider-set-global-routes" : "provider-set-category-routes-org";
      const routeBody = isPlatform
        ? {
            routes: [{ workflow, scope: "BOTH", route_kind: "PRIMARY", priority: 1, provider_connector_id: connector.id, enabled: true }],
          }
        : {
            organization_id: organizationId,
            routes: [{ workflow, scope: "BOTH", route_kind: "PRIMARY", priority: 1, provider_connector_id: connector.id, enabled: true }],
          };

      const { error: routeErr } = await supabase.functions.invoke(routeFn, { body: routeBody });
      if (routeErr) {
        console.warn("Route creation failed (non-blocking):", routeErr);
      }

      return { connector, instance };
    },
    onSuccess: ({ connector, instance }) => {
      toast.success("¡Proveedor configurado exitosamente!");
      setCompleted(true);
      queryClient.invalidateQueries({ queryKey: ["wizard-connectors"] });
      queryClient.invalidateQueries({ queryKey: ["provider-connectors"] });
      queryClient.invalidateQueries({ queryKey: ["provider-instances"] });
      queryClient.invalidateQueries({ queryKey: ["global-routes"] });
      onComplete(connector, instance);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-5">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-display font-semibold text-foreground">
              Agregar Proveedor Rápido
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Pegue la información que le compartió el contacto del proveedor externo. Solo necesita: nombre, URL y clave.
          </p>
        </div>

        {/* Existing providers reference */}
        {existingConnectors && existingConnectors.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Proveedores ya configurados</Label>
            <div className="flex flex-wrap gap-2">
              {existingConnectors.map((c) => (
                <Badge key={c.id} variant="outline" className="text-xs bg-muted/30 border-border/50">
                  <CheckCircle2 className="h-3 w-3 mr-1 text-primary" />
                  {c.name}
                  <span className="ml-1 text-muted-foreground">({c.allowed_domains?.[0] || "—"})</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Quick Add Form */}
        <Card className="border-2 border-primary/20 bg-primary/[0.02]">
          <CardContent className="p-6 space-y-5">
            {/* Provider Name */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Type className="h-3.5 w-3.5" /> Nombre del proveedor
              </Label>
              <Input
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder='Ej: "samai estados", "API Tutelas Norte"'
                disabled={completed}
              />
              {providerName && (
                <p className="text-[11px] text-muted-foreground">
                  Key auto: <code className="bg-muted/50 px-1 rounded">{deriveKey(providerName)}</code>
                </p>
              )}
            </div>

            {/* Base URL */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Link className="h-3.5 w-3.5" /> URL Base del proveedor
              </Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://samai-estados-api-xxxx.us-central1.run.app"
                disabled={completed}
              />
              <div className="flex items-center gap-2 text-[11px]">
                {baseUrl.length > 8 && !isHttps && (
                  <Badge variant="destructive" className="text-[10px]">Solo HTTPS</Badge>
                )}
                {host && isHttps && (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/30 bg-primary/10">
                    <ShieldCheck className="h-3 w-3 mr-1" /> {host}
                  </Badge>
                )}
              </div>
            </div>

            {/* Master Key / API Key */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Key className="h-3.5 w-3.5" /> Master Key / API Key
              </Label>
              <Input
                type="password"
                value={masterKey}
                onChange={(e) => setMasterKey(e.target.value)}
                placeholder="LEXETLIT-CPNU-2026-xxxxxxxx..."
                disabled={completed}
              />
              <p className="text-[11px] text-muted-foreground">
                Se almacena encriptado (AES-256-GCM). No se mostrará después.
              </p>
            </div>

            {/* Workflow */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Workflow principal
              </Label>
              <Select value={workflow} onValueChange={setWorkflow} disabled={completed}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKFLOW_OPTIONS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Scope */}
            <div className="flex items-start gap-2 text-xs rounded-lg p-3 border bg-muted/30 border-border/50">
              {isPlatform ? <Globe className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" /> : <Building2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />}
              <span className="text-foreground/80">
                {isPlatform
                  ? "Se creará como conector GLOBAL con instancia de plataforma. Activo automáticamente para todas las organizaciones."
                  : "Se creará como conector PRIVADO para tu organización únicamente."}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Success state */}
        {completed && (
          <div className="flex items-center gap-2 p-4 bg-primary/5 border border-primary/20 rounded-lg">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                ¡Proveedor "{providerName}" configurado!
              </p>
              <p className="text-xs text-muted-foreground">
                Conector + instancia + routing creados. Puede continuar al preflight para verificar la conexión.
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center">
          {!completed ? (
            <Button
              onClick={() => quickAddMutation.mutate()}
              disabled={quickAddMutation.isPending || !isValid}
              size="lg"
              className="gap-2"
            >
              {quickAddMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Configurando...</>
              ) : (
                <><Zap className="h-4 w-4" /> Configurar Proveedor</>
              )}
            </Button>
          ) : (
            <div />
          )}
          {completed && (
            <Button onClick={onNext} className="gap-2">
              Continuar al Preflight <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Quick Add"
          whatItDoes="Crea automáticamente el conector, la instancia con credenciales, y el routing en un solo paso. Solo necesita la información que le compartieron: nombre, URL y clave."
          whyItMatters="Muchos proveedores externos comparten su integración con tres datos simples. Este flujo elimina la complejidad de configurar cada pieza por separado."
          commonMistakes={[
            "Asegúrese que la URL sea HTTPS (no HTTP)",
            "Copie la Master Key exactamente — incluyendo guiones y mayúsculas",
            "Si la URL termina con /api o /v1, inclúyala completa",
          ]}
        />
      </div>
    </div>
  );
}
