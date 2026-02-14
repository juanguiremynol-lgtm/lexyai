/**
 * AnalyticsImplementationWizard — Step-by-step wizard for superadmins
 * to configure PostHog, Sentry, and ANALYTICS_HASH_SECRET secrets,
 * then wire them as analytics providers. No code changes needed.
 */

import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Shield,
  BarChart3,
  AlertTriangle,
  Key,
  Rocket,
  Loader2,
  ExternalLink,
  Copy,
  Lock,
  Eye,
} from "lucide-react";

type WizardStep = "overview" | "posthog" | "sentry" | "hash_secret" | "activate" | "done";

const STEPS: { key: WizardStep; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Visión General", icon: <Eye className="h-4 w-4" /> },
  { key: "posthog", label: "PostHog", icon: <BarChart3 className="h-4 w-4" /> },
  { key: "sentry", label: "Sentry", icon: <Shield className="h-4 w-4" /> },
  { key: "hash_secret", label: "Hash Secret", icon: <Lock className="h-4 w-4" /> },
  { key: "activate", label: "Activar", icon: <Rocket className="h-4 w-4" /> },
  { key: "done", label: "Completado", icon: <CheckCircle2 className="h-4 w-4" /> },
];

interface SecretStatus {
  posthog_api_key: boolean;
  sentry_dsn: boolean;
  analytics_hash_secret: boolean;
}

export function AnalyticsImplementationWizard() {
  const [currentStep, setCurrentStep] = useState<WizardStep>("overview");
  const [posthogKey, setPosthogKey] = useState("");
  const [posthogHost, setPosthogHost] = useState("https://us.i.posthog.com");
  const [sentryDsn, setSentryDsn] = useState("");
  const [hashSecret, setHashSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  // Fetch current settings
  const { data: settings } = useQuery({
    queryKey: ["wizard-analytics-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("analytics_enabled_global, posthog_enabled, sentry_enabled, session_replay_enabled, analytics_hash_secret_configured, analytics_posthog_host")
        .eq("id", "singleton")
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Check which secrets exist by checking edge function
  const { data: secretStatus, refetch: refetchSecrets } = useQuery({
    queryKey: ["wizard-secret-status"],
    queryFn: async (): Promise<SecretStatus> => {
      // We check via the platform_settings flag for hash secret
      // For PostHog/Sentry, we rely on the settings toggles + hash_secret_configured flag
      return {
        posthog_api_key: settings?.posthog_enabled ?? false,
        sentry_dsn: settings?.sentry_enabled ?? false,
        analytics_hash_secret: settings?.analytics_hash_secret_configured ?? false,
      };
    },
    enabled: !!settings,
  });

  const stepIndex = STEPS.findIndex(s => s.key === currentStep);
  const canGoBack = stepIndex > 0 && currentStep !== "done";
  const canGoNext = stepIndex < STEPS.length - 1;

  const goNext = () => {
    if (canGoNext) setCurrentStep(STEPS[stepIndex + 1].key);
  };
  const goBack = () => {
    if (canGoBack) setCurrentStep(STEPS[stepIndex - 1].key);
  };

  // Save a secret via edge function
  const saveSecret = useCallback(async (secretName: string, secretValue: string) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-analytics-secrets", {
        body: { action: "set", secret_name: secretName, secret_value: secretValue },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Failed to save secret");
      toast.success(`${secretName} configurado correctamente`);
      refetchSecrets();
      return true;
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [refetchSecrets]);

  // Update platform settings
  const updateSettings = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await supabase
        .from("platform_settings")
        .update(updates as any)
        .eq("id", "singleton");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wizard-analytics-settings"] });
      queryClient.invalidateQueries({ queryKey: ["platform-analytics-settings"] });
    },
  });

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((step, i) => (
          <div key={step.key} className="flex items-center">
            <button
              onClick={() => setCurrentStep(step.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                step.key === currentStep
                  ? "bg-primary text-primary-foreground"
                  : i < stepIndex
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {step.icon}
              {step.label}
            </button>
            {i < STEPS.length - 1 && (
              <ArrowRight className="h-3 w-3 text-muted-foreground mx-1 shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      {currentStep === "overview" && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Rocket className="h-5 w-5 text-cyan-400" />
              Wizard de Implementación de Analíticas
            </CardTitle>
            <CardDescription className="text-white/60">
              Este wizard te guiará paso a paso para configurar los proveedores de analíticas y observabilidad.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-cyan-500/10 border-cyan-500/30">
              <BarChart3 className="h-4 w-4 text-cyan-400" />
              <AlertTitle className="text-cyan-300">¿Qué se configurará?</AlertTitle>
              <AlertDescription className="text-cyan-200/70 space-y-2">
                <p>Este wizard agregará tres secrets al entorno de backend:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li><strong>POSTHOG_API_KEY</strong> — Analítica de producto (eventos de uso, flujos de usuario)</li>
                  <li><strong>SENTRY_DSN</strong> — Monitoreo de errores y rendimiento</li>
                  <li><strong>ANALYTICS_HASH_SECRET</strong> — Clave HMAC-SHA256 para pseudonimizar IDs</li>
                </ul>
              </AlertDescription>
            </Alert>

            <Alert className="bg-amber-500/10 border-amber-500/30">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <AlertTitle className="text-amber-300">Seguridad Garantizada</AlertTitle>
              <AlertDescription className="text-amber-200/70">
                Los secrets se almacenan cifrados y solo son accesibles desde funciones de backend.
                Nunca se exponen al cliente. La telemetría nunca incluye datos legales ni PII.
              </AlertDescription>
            </Alert>

            {/* Current status */}
            <div className="grid gap-2 sm:grid-cols-3">
              <StatusBadge label="POSTHOG_API_KEY" configured={secretStatus?.posthog_api_key} />
              <StatusBadge label="SENTRY_DSN" configured={secretStatus?.sentry_dsn} />
              <StatusBadge label="HASH_SECRET" configured={secretStatus?.analytics_hash_secret} />
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "posthog" && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-cyan-400" />
              Paso 1: Configurar PostHog
            </CardTitle>
            <CardDescription className="text-white/60">
              PostHog es la plataforma de analítica de producto. Obtén tu API Key desde el panel de PostHog.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white/80">PostHog API Key (Project API Key)</Label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={posthogKey}
                  onChange={(e) => setPosthogKey(e.target.value)}
                  placeholder="phc_xxxxxxxxxxxx"
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/30 font-mono"
                />
              </div>
              <p className="text-xs text-white/40">
                Encuéntrala en PostHog → Settings → Project → Project API Key
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-white/80">PostHog Host</Label>
              <Input
                value={posthogHost}
                onChange={(e) => setPosthogHost(e.target.value)}
                placeholder="https://us.i.posthog.com"
                className="bg-white/5 border-white/20 text-white placeholder:text-white/30 font-mono"
              />
              <p className="text-xs text-white/40">
                Usa <code>https://us.i.posthog.com</code> (US) o <code>https://eu.i.posthog.com</code> (EU)
              </p>
            </div>

            <Button
              onClick={async () => {
                if (!posthogKey.trim()) { toast.error("Ingresa la API Key de PostHog"); return; }
                const ok = await saveSecret("POSTHOG_API_KEY", posthogKey.trim());
                if (ok) {
                  await updateSettings.mutateAsync({
                    posthog_enabled: true,
                    analytics_posthog_host: posthogHost.trim(),
                  });
                  setPosthogKey("");
                  toast.success("PostHog configurado — proveedor habilitado");
                }
              }}
              disabled={saving || !posthogKey.trim()}
              className="w-full bg-cyan-600 hover:bg-cyan-700"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
              Guardar POSTHOG_API_KEY
            </Button>

            {secretStatus?.posthog_api_key && (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <CheckCircle2 className="h-4 w-4" /> PostHog ya está configurado
              </div>
            )}

            <a
              href="https://posthog.com/docs/getting-started/send-events"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
            >
              <ExternalLink className="h-3 w-3" /> Documentación de PostHog
            </a>
          </CardContent>
        </Card>
      )}

      {currentStep === "sentry" && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-cyan-400" />
              Paso 2: Configurar Sentry
            </CardTitle>
            <CardDescription className="text-white/60">
              Sentry captura errores y métricas de rendimiento. Obtén el DSN desde tu proyecto en Sentry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white/80">Sentry DSN</Label>
              <Input
                type="password"
                value={sentryDsn}
                onChange={(e) => setSentryDsn(e.target.value)}
                placeholder="https://xxxxx@o12345.ingest.sentry.io/67890"
                className="bg-white/5 border-white/20 text-white placeholder:text-white/30 font-mono"
              />
              <p className="text-xs text-white/40">
                Encuéntralo en Sentry → Settings → Projects → [tu proyecto] → Client Keys (DSN)
              </p>
            </div>

            <Button
              onClick={async () => {
                if (!sentryDsn.trim()) { toast.error("Ingresa el DSN de Sentry"); return; }
                const ok = await saveSecret("SENTRY_DSN", sentryDsn.trim());
                if (ok) {
                  await updateSettings.mutateAsync({ sentry_enabled: true });
                  setSentryDsn("");
                  toast.success("Sentry configurado — proveedor habilitado");
                }
              }}
              disabled={saving || !sentryDsn.trim()}
              className="w-full bg-cyan-600 hover:bg-cyan-700"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
              Guardar SENTRY_DSN
            </Button>

            {secretStatus?.sentry_dsn && (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <CheckCircle2 className="h-4 w-4" /> Sentry ya está configurado
              </div>
            )}

            <a
              href="https://docs.sentry.io/platforms/javascript/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
            >
              <ExternalLink className="h-3 w-3" /> Documentación de Sentry
            </a>
          </CardContent>
        </Card>
      )}

      {currentStep === "hash_secret" && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Lock className="h-5 w-5 text-cyan-400" />
              Paso 3: Configurar Hash Secret
            </CardTitle>
            <CardDescription className="text-white/60">
              Esta clave se usa para HMAC-SHA256 de IDs (tenant, user, matter) antes de enviarlos a proveedores externos.
              Sin ella, los IDs se envían como UUIDs directos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white/80">ANALYTICS_HASH_SECRET</Label>
              <Input
                type="password"
                value={hashSecret}
                onChange={(e) => setHashSecret(e.target.value)}
                placeholder="Mínimo 32 caracteres aleatorios..."
                className="bg-white/5 border-white/20 text-white placeholder:text-white/30 font-mono"
              />
              <p className="text-xs text-white/40">
                Genera una clave aleatoria de al menos 32 caracteres. Puedes usar: <code>openssl rand -hex 32</code>
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="border-white/20 text-white/60"
              onClick={() => {
                const bytes = new Uint8Array(32);
                crypto.getRandomValues(bytes);
                const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
                setHashSecret(hex);
                toast.info("Clave generada — recuerda guardarla");
              }}
            >
              🎲 Generar clave aleatoria
            </Button>

            <Button
              onClick={async () => {
                if (hashSecret.trim().length < 32) { toast.error("La clave debe tener al menos 32 caracteres"); return; }
                const ok = await saveSecret("ANALYTICS_HASH_SECRET", hashSecret.trim());
                if (ok) {
                  await updateSettings.mutateAsync({ analytics_hash_secret_configured: true });
                  setHashSecret("");
                  toast.success("Hash secret configurado — IDs serán pseudonimizados");
                }
              }}
              disabled={saving || hashSecret.trim().length < 32}
              className="w-full bg-cyan-600 hover:bg-cyan-700"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Key className="h-4 w-4 mr-2" />}
              Guardar ANALYTICS_HASH_SECRET
            </Button>

            {secretStatus?.analytics_hash_secret && (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <CheckCircle2 className="h-4 w-4" /> Hash Secret ya está configurado
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {currentStep === "activate" && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Rocket className="h-5 w-5 text-cyan-400" />
              Paso 4: Activar Proveedores
            </CardTitle>
            <CardDescription className="text-white/60">
              Revisa el estado de cada componente y activa el sistema cuando estés listo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Readiness checklist */}
            <div className="space-y-2">
              <ReadinessItem label="POSTHOG_API_KEY" ok={secretStatus?.posthog_api_key} />
              <ReadinessItem label="SENTRY_DSN" ok={secretStatus?.sentry_dsn} />
              <ReadinessItem label="ANALYTICS_HASH_SECRET" ok={secretStatus?.analytics_hash_secret} />
            </div>

            <Separator className="bg-white/10" />

            <Alert className="bg-amber-500/10 border-amber-500/30">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <AlertDescription className="text-amber-200/70 text-sm">
                Activar analíticas globalmente comenzará a enviar eventos a los proveedores configurados.
                Los tenants pueden optar por desactivarlas desde su consola de administración.
              </AlertDescription>
            </Alert>

            <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
              <div>
                <Label className="text-white font-medium">Activar Analíticas Globalmente</Label>
                <p className="text-xs text-white/40">Switch maestro — habilita el envío de eventos</p>
              </div>
              <Switch
                checked={settings?.analytics_enabled_global ?? false}
                onCheckedChange={(v) => {
                  updateSettings.mutate({ analytics_enabled_global: v });
                  if (v) toast.success("Analíticas activadas globalmente");
                  else toast.info("Analíticas desactivadas globalmente");
                }}
              />
            </div>

            <Button
              className="w-full bg-green-600 hover:bg-green-700"
              onClick={() => {
                if (!settings?.analytics_enabled_global) {
                  updateSettings.mutate({ analytics_enabled_global: true });
                }
                setCurrentStep("done");
              }}
              disabled={!secretStatus?.posthog_api_key && !secretStatus?.sentry_dsn}
            >
              <Rocket className="h-4 w-4 mr-2" />
              Finalizar Configuración
            </Button>
          </CardContent>
        </Card>
      )}

      {currentStep === "done" && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-400" />
              ¡Configuración Completada!
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-white/70 text-sm">
              Los proveedores de analíticas están configurados. Los eventos de uso comenzarán a fluir
              según la configuración global y los overrides de cada organización.
            </p>

            <div className="grid gap-2 sm:grid-cols-3">
              <StatusBadge label="PostHog" configured={settings?.posthog_enabled} />
              <StatusBadge label="Sentry" configured={settings?.sentry_enabled} />
              <StatusBadge label="Hash Secret" configured={settings?.analytics_hash_secret_configured} />
            </div>

            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <span className="text-sm text-green-300">
                Global: {settings?.analytics_enabled_global ? "✅ Activo" : "❌ Inactivo"}
              </span>
            </div>

            <p className="text-xs text-white/40">
              Puedes ajustar los toggles individuales y la allowlist de propiedades desde el panel principal de Analíticas.
              Las organizaciones pueden gestionar sus propios overrides.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={goBack}
          disabled={!canGoBack}
          className="border-white/20 text-white/60"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Anterior
        </Button>
        {currentStep !== "done" && (
          <Button
            onClick={goNext}
            disabled={!canGoNext}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            Siguiente <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ label, configured }: { label: string; configured?: boolean }) {
  return (
    <div className={`flex items-center gap-2 p-2 rounded border text-xs ${
      configured
        ? "bg-green-500/10 border-green-500/20 text-green-300"
        : "bg-white/5 border-white/10 text-white/40"
    }`}>
      {configured ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </div>
  );
}

function ReadinessItem({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded bg-white/5">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-green-400" />
      ) : (
        <XCircle className="h-4 w-4 text-white/30" />
      )}
      <span className={`text-sm ${ok ? "text-green-300" : "text-white/50"}`}>{label}</span>
      <Badge className={`ml-auto text-[10px] ${ok ? "bg-green-500/20 text-green-300" : "bg-white/10 text-white/40"}`}>
        {ok ? "Listo" : "Pendiente"}
      </Badge>
    </div>
  );
}
