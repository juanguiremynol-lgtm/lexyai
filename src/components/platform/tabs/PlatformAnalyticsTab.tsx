/**
 * Platform Analytics & Observability Settings Tab
 * Superadmin-only: global toggles, allowlist editor, tenant overrides, status panel, implementation wizard.
 */

import { useState } from "react";
import { AnalyticsImplementationWizard } from "@/components/platform/analytics/AnalyticsImplementationWizard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  BarChart3,
  Shield,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plus,
  Trash2,
  Building2,
  RefreshCw,
  Info,
} from "lucide-react";
import { DEFAULT_ALLOWED_PROPERTIES, BLOCKED_PROPERTIES, getAnalyticsState } from "@/lib/analytics";

// --- Types ---
interface GlobalSettings {
  analytics_enabled_global: boolean;
  posthog_enabled: boolean;
  sentry_enabled: boolean;
  session_replay_enabled: boolean;
  analytics_allowed_properties: string[];
  analytics_hash_secret_configured: boolean;
  analytics_last_event_at: string | null;
  analytics_posthog_host: string;
}

interface OrgOverride {
  id: string;
  organization_id: string;
  analytics_enabled: boolean | null;
  session_replay_enabled: boolean | null;
  allowed_properties_override: string[] | null;
  notes: string | null;
  updated_at: string;
  organization_name?: string;
}

export function PlatformAnalyticsTab() {
  const queryClient = useQueryClient();
  const [newProp, setNewProp] = useState("");

  // Fetch global settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ["platform-analytics-settings"],
    queryFn: async (): Promise<GlobalSettings> => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("analytics_enabled_global, posthog_enabled, sentry_enabled, session_replay_enabled, analytics_allowed_properties, analytics_hash_secret_configured, analytics_last_event_at, analytics_posthog_host")
        .eq("id", "singleton")
        .single();
      if (error) throw error;
      return {
        ...data,
        analytics_allowed_properties: Array.isArray(data.analytics_allowed_properties)
          ? data.analytics_allowed_properties
          : DEFAULT_ALLOWED_PROPERTIES,
      } as GlobalSettings;
    },
  });

  // Fetch org overrides
  const { data: overrides = [] } = useQuery({
    queryKey: ["platform-analytics-overrides"],
    queryFn: async (): Promise<OrgOverride[]> => {
      const { data, error } = await (supabase.from("org_analytics_overrides") as any)
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) return [];
      // Enrich with org names
      const orgIds = (data || []).map((o: any) => o.organization_id);
      if (orgIds.length === 0) return data || [];
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name")
        .in("id", orgIds);
      const orgMap = new Map((orgs || []).map(o => [o.id, o.name]));
      return (data || []).map((o: any) => ({
        ...o,
        organization_name: orgMap.get(o.organization_id) || o.organization_id,
      }));
    },
  });

  // Update global setting
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<GlobalSettings>) => {
      const { error } = await supabase
        .from("platform_settings")
        .update(updates as any)
        .eq("id", "singleton");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-analytics-settings"] });
      toast.success("Configuración actualizada");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Toggle helpers
  const toggleSetting = (key: keyof GlobalSettings, value: boolean) => {
    updateMutation.mutate({ [key]: value } as any);
  };

  // Allowlist management
  const addProperty = () => {
    const prop = newProp.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!prop) return;
    if (BLOCKED_PROPERTIES.includes(prop)) {
      toast.error(`"${prop}" está en la lista de bloqueo PII`);
      return;
    }
    const current = settings?.analytics_allowed_properties || [];
    if (current.includes(prop)) {
      toast.info("Ya existe");
      return;
    }
    updateMutation.mutate({
      analytics_allowed_properties: [...current, prop],
    } as any);
    setNewProp("");
  };

  const removeProperty = (prop: string) => {
    const current = settings?.analytics_allowed_properties || [];
    updateMutation.mutate({
      analytics_allowed_properties: current.filter(p => p !== prop),
    } as any);
  };

  const resetToDefaults = () => {
    updateMutation.mutate({
      analytics_allowed_properties: DEFAULT_ALLOWED_PROPERTIES,
    } as any);
  };

  // Client-side state
  const clientState = getAnalyticsState();

  if (isLoading) {
    return <div className="text-white/50 py-12 text-center">Cargando configuración…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
          <BarChart3 className="h-5 w-5 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Analíticas y Observabilidad</h2>
          <p className="text-white/50 text-sm">Control global de telemetría — sin PII, sin datos legales</p>
        </div>
      </div>

      {/* Implementation Wizard */}
      <AnalyticsImplementationWizard />

      {/* Safety banner */}
      <Alert className="bg-amber-500/10 border-amber-500/30">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <AlertTitle className="text-amber-300">Datos Legales Protegidos</AlertTitle>
        <AlertDescription className="text-amber-200/70">
          La telemetría nunca envía contenidos de casos, nombres de partes, documentos, correos,
          números de identificación ni texto libre. Solo IDs hasheados y metadatos seguros.
        </AlertDescription>
      </Alert>

      {/* Global Toggles */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-white text-lg">Controles Globales</CardTitle>
          <CardDescription className="text-white/50">
            Estas configuraciones aplican a TODA la plataforma por defecto
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Master switch */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-5 w-5 text-cyan-400" />
              <div>
                <Label className="text-white font-medium">Analíticas Habilitadas</Label>
                <p className="text-xs text-white/40">Switch maestro — si está OFF, ningún evento se envía</p>
              </div>
            </div>
            <Switch
              checked={settings?.analytics_enabled_global ?? false}
              onCheckedChange={(v) => toggleSetting("analytics_enabled_global", v)}
            />
          </div>

          <Separator className="bg-white/10" />

          {/* Provider toggles */}
          <div className="grid gap-4 sm:grid-cols-3">
            <ProviderToggle
              icon={<BarChart3 className="h-4 w-4" />}
              label="PostHog"
              description="Analítica de producto"
              enabled={settings?.posthog_enabled ?? false}
              onChange={(v) => toggleSetting("posthog_enabled", v)}
              disabled={!settings?.analytics_enabled_global}
            />
            <ProviderToggle
              icon={<Shield className="h-4 w-4" />}
              label="Sentry"
              description="Errores y rendimiento"
              enabled={settings?.sentry_enabled ?? false}
              onChange={(v) => toggleSetting("sentry_enabled", v)}
              disabled={!settings?.analytics_enabled_global}
            />
            <ProviderToggle
              icon={settings?.session_replay_enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              label="Session Replay"
              description="Grabación de sesión (OFF por defecto)"
              enabled={settings?.session_replay_enabled ?? false}
              onChange={(v) => toggleSetting("session_replay_enabled", v)}
              disabled={!settings?.analytics_enabled_global}
              warning={settings?.session_replay_enabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* Allowlist Editor */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white text-lg">Propiedades Permitidas</CardTitle>
              <CardDescription className="text-white/50">
                Solo estas claves se envían a proveedores externos. Todo lo demás se descarta.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={resetToDefaults}
              className="border-white/20 text-white/60 hover:text-white"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Restaurar defaults
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new */}
          <div className="flex gap-2">
            <Input
              value={newProp}
              onChange={(e) => setNewProp(e.target.value)}
              placeholder="nueva_propiedad_segura"
              className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
              onKeyDown={(e) => e.key === 'Enter' && addProperty()}
            />
            <Button onClick={addProperty} size="sm" className="bg-cyan-600 hover:bg-cyan-700">
              <Plus className="h-3 w-3 mr-1" /> Agregar
            </Button>
          </div>

          {/* Property tags */}
          <div className="flex flex-wrap gap-1.5">
            {(settings?.analytics_allowed_properties || []).map((prop) => (
              <Badge
                key={prop}
                variant="secondary"
                className="bg-white/10 text-white/70 hover:bg-white/15 gap-1 group cursor-default"
              >
                {prop}
                <button
                  onClick={() => removeProperty(prop)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-2.5 w-2.5 text-red-400" />
                </button>
              </Badge>
            ))}
          </div>

          {/* Blocked list info */}
          <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/20">
            <Info className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-red-300 font-medium">Propiedades Bloqueadas (siempre excluidas)</p>
              <p className="text-xs text-red-200/60 mt-1">
                {BLOCKED_PROPERTIES.join(", ")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tenant Overrides */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <Building2 className="h-5 w-5 text-white/40" />
            Overrides por Organización
          </CardTitle>
          <CardDescription className="text-white/50">
            Las organizaciones heredan la configuración global salvo override explícito.
            Los administradores de org pueden gestionar sus propios overrides.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overrides.length === 0 ? (
            <p className="text-white/30 text-sm py-4 text-center">
              Sin overrides — todas las organizaciones heredan configuración global
            </p>
          ) : (
            <div className="space-y-2">
              {overrides.map((o) => (
                <div key={o.id} className="flex items-center justify-between p-3 rounded bg-white/5 border border-white/10">
                  <div>
                    <p className="text-sm text-white font-medium">{o.organization_name}</p>
                    <p className="text-xs text-white/40">
                      Analíticas: {o.analytics_enabled === null ? 'Heredado' : o.analytics_enabled ? 'ON' : 'OFF'}
                      {' · '}
                      Replay: {o.session_replay_enabled === null ? 'Heredado' : o.session_replay_enabled ? 'ON' : 'OFF'}
                    </p>
                    {o.notes && <p className="text-xs text-white/30 mt-1">{o.notes}</p>}
                  </div>
                  <Badge className={
                    o.analytics_enabled === false
                      ? "bg-red-500/20 text-red-300 border-red-500/30"
                      : "bg-white/10 text-white/50 border-white/15"
                  }>
                    {o.analytics_enabled === false ? 'Deshabilitado' : 'Override'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status Panel */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-white text-lg">Estado del Sistema</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatusItem
              label="Analytics Wrapper"
              ok={true}
              detail={`${clientState.providerCount} proveedor(es): ${clientState.providerNames.join(', ') || 'ninguno'}`}
            />
            <StatusItem
              label="ANALYTICS_HASH_SECRET"
              ok={settings?.analytics_hash_secret_configured ?? false}
              detail={settings?.analytics_hash_secret_configured ? 'Configurado' : 'No configurado — IDs no se hashean'}
            />
            <StatusItem
              label="POSTHOG_API_KEY"
              ok={false}
              detail="No configurada (pendiente)"
            />
            <StatusItem
              label="SENTRY_DSN"
              ok={false}
              detail="No configurada (pendiente)"
            />
            <StatusItem
              label="Último evento"
              ok={!!settings?.analytics_last_event_at}
              detail={settings?.analytics_last_event_at
                ? new Date(settings.analytics_last_event_at).toLocaleString('es-CO')
                : 'Nunca'}
            />
            <StatusItem
              label="Estado efectivo (cliente)"
              ok={clientState.effectivelyEnabled}
              detail={clientState.effectivelyEnabled ? 'Enviando eventos' : 'Inactivo'}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Sub-components ---

function ProviderToggle({
  icon,
  label,
  description,
  enabled,
  onChange,
  disabled,
  warning,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  warning?: boolean;
}) {
  return (
    <div className={`p-3 rounded-lg border transition-colors ${
      warning ? 'bg-amber-500/10 border-amber-500/30' : 'bg-white/5 border-white/10'
    } ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-white/80">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <Switch checked={enabled} onCheckedChange={onChange} disabled={disabled} />
      </div>
      <p className="text-xs text-white/40">{description}</p>
      {warning && (
        <p className="text-xs text-amber-300 mt-1 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Grabación activa — verificar mascareo
        </p>
      )}
    </div>
  );
}

function StatusItem({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded bg-white/5 border border-white/10">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-white/30 mt-0.5 shrink-0" />
      )}
      <div>
        <p className="text-xs text-white/70 font-medium">{label}</p>
        <p className="text-xs text-white/40">{detail}</p>
      </div>
    </div>
  );
}
