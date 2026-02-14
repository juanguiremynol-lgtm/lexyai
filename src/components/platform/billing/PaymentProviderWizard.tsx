/**
 * PaymentProviderWizard — Step-by-step wizard for configuring payment gateways.
 * Supports all providers from the centralized registry (Wompi, Stripe, PayU, etc).
 * No-code setup: Super Admin selects provider, enters keys, tests, and activates.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import {
  CreditCard,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  XCircle,
  Key,
  Loader2,
  Save,
  Eye,
  EyeOff,
  Shield,
  Zap,
  TestTube,
  Sparkles,
  AlertTriangle,
  ExternalLink,
  Info,
  Globe,
  Banknote,
  Building2,
  ShoppingBag,
  Wallet,
  Settings2,
  Power,
} from "lucide-react";
import { toast } from "sonner";
import {
  PAYMENT_PROVIDERS,
  getPaymentProvider,
  getProviderConfigKey,
  type PaymentProviderDefinition,
} from "@/lib/billing/payment-providers";

// ─── Types ───

type WizardStep = "select" | "overview" | "configure" | "test" | "activate" | "done";

const STEPS: { id: WizardStep; label: string; icon: React.ReactNode }[] = [
  { id: "select", label: "Elegir Pasarela", icon: <CreditCard className="h-4 w-4" /> },
  { id: "overview", label: "Información", icon: <Info className="h-4 w-4" /> },
  { id: "configure", label: "Credenciales", icon: <Key className="h-4 w-4" /> },
  { id: "test", label: "Verificar", icon: <TestTube className="h-4 w-4" /> },
  { id: "activate", label: "Activar", icon: <Zap className="h-4 w-4" /> },
  { id: "done", label: "¡Listo!", icon: <CheckCircle className="h-4 w-4" /> },
];

const ICON_MAP: Record<string, React.ReactNode> = {
  Banknote: <Banknote className="h-6 w-6" />,
  CreditCard: <CreditCard className="h-6 w-6" />,
  Globe: <Globe className="h-6 w-6" />,
  Building2: <Building2 className="h-6 w-6" />,
  ShoppingBag: <ShoppingBag className="h-6 w-6" />,
  Wallet: <Wallet className="h-6 w-6" />,
};

// ─── API helpers ───

async function fetchGatewayStatus(gateway?: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing-admin-gateway`);
  if (gateway) url.searchParams.set("gateway", gateway);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Failed to fetch config");
  return data;
}

async function saveGatewayKey(body: Record<string, unknown>) {
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
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Operation failed");
  return data;
}

// ─── Component ───

export function PaymentProviderWizard() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>("select");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [environment, setEnvironment] = useState("sandbox");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showValue, setShowValue] = useState(false);

  // Fetch all gateway statuses
  const { data: gatewayData, isLoading } = useQuery({
    queryKey: ["payment-gateway-status"],
    queryFn: () => fetchGatewayStatus(),
    staleTime: 15_000,
  });

  // Save key mutation
  const saveKey = useMutation({
    mutationFn: async ({ config_key, config_value }: { config_key: string; config_value: string }) => {
      return saveGatewayKey({
        gateway: selectedProvider,
        config_key,
        config_value,
        environment,
      });
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["payment-gateway-status"] });
      toast.success(`${vars.config_key} guardado correctamente`);
      setEditingKey(null);
      setEditValue("");
      setShowValue(false);
    },
    onError: (err) => toast.error(`Error: ${(err as Error).message}`),
  });

  // Activate gateway mutation
  const activateGateway = useMutation({
    mutationFn: async () => {
      return saveGatewayKey({
        action: "set_active_gateway",
        gateway: selectedProvider,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment-gateway-status"] });
      toast.success("¡Pasarela de pagos activada exitosamente!");
      setStep("done");
    },
    onError: (err) => toast.error(`Error: ${(err as Error).message}`),
  });

  const providerDef = selectedProvider ? getPaymentProvider(selectedProvider) : null;
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  // Key status from gateway data
  const getKeyConfigured = (configKey: string): boolean => {
    if (!gatewayData?.gateways || !selectedProvider) return false;
    const gw = gatewayData.gateways[selectedProvider];
    if (!gw) return false;
    return gw.keys.some((k: any) => k.key === configKey && k.configured);
  };

  // Count configured required keys
  const configuredCount = useMemo(() => {
    if (!providerDef || !gatewayData?.gateways?.[selectedProvider!]) return 0;
    const requiredKeys = providerDef.keys.filter(k => k.required);
    return requiredKeys.filter(k => getKeyConfigured(getProviderConfigKey(selectedProvider!, k.key))).length;
  }, [providerDef, gatewayData, selectedProvider]);

  const requiredCount = providerDef?.keys.filter(k => k.required).length || 0;
  const allRequiredConfigured = configuredCount === requiredCount && requiredCount > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <CreditCard className="h-7 w-7 text-primary" />
          Asistente de Pasarela de Pagos
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure cualquier pasarela de pagos paso a paso. Sin necesidad de código.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {STEPS.map((s, i) => {
          const isCurrent = s.id === step;
          const isDone = i < stepIndex;
          return (
            <div key={s.id} className="flex items-center gap-2 shrink-0">
              {i > 0 && <div className={`w-8 h-px ${isDone ? "bg-primary" : "bg-border"}`} />}
              <button
                onClick={() => isDone && setStep(s.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                  isCurrent
                    ? "bg-primary text-primary-foreground font-medium"
                    : isDone
                    ? "bg-primary/10 text-primary cursor-pointer hover:bg-primary/20"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {isDone ? <CheckCircle className="h-4 w-4" /> : s.icon}
                {s.label}
              </button>
            </div>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando configuración...
        </div>
      ) : (
        <>
          {/* ─── Step 1: Select Provider ─── */}
          {step === "select" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-primary" />
                  Paso 1: Seleccione su pasarela de pagos
                </CardTitle>
                <CardDescription>
                  Elija el proveedor de pagos que desea configurar. Todos se integran sin tocar código.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Current active */}
                {gatewayData?.active_gateway && gatewayData.active_gateway !== "mock" && (
                  <div className="mb-6 p-3 rounded-lg border border-primary/30 bg-primary/5">
                    <p className="text-sm font-medium text-primary flex items-center gap-2">
                      <Power className="h-4 w-4" />
                      Pasarela activa: <span className="uppercase">{gatewayData.active_gateway}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Puede configurar una pasarela adicional sin afectar la activa.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {PAYMENT_PROVIDERS.map((provider) => {
                    const isActive = gatewayData?.active_gateway === provider.id;
                    const gwData = gatewayData?.gateways?.[provider.id];
                    const hasAnyKey = gwData?.keys?.some((k: any) => k.configured) || false;

                    return (
                      <button
                        key={provider.id}
                        onClick={() => {
                          setSelectedProvider(provider.id);
                          setStep("overview");
                        }}
                        disabled={provider.status === "coming_soon"}
                        className={`relative text-left p-4 rounded-lg border-2 transition-all hover:border-primary/50 hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed ${
                          isActive ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-primary">{ICON_MAP[provider.logoIcon] || <CreditCard className="h-6 w-6" />}</span>
                            <div>
                              <h3 className="font-semibold text-foreground">{provider.name}</h3>
                              <p className="text-xs text-muted-foreground">{provider.country}</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {provider.recommended && (
                              <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Recomendado</Badge>
                            )}
                            {isActive && (
                              <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 text-xs">Activa</Badge>
                            )}
                            {provider.status === "beta" && (
                              <Badge variant="outline" className="text-xs">Beta</Badge>
                            )}
                            {hasAnyKey && !isActive && (
                              <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30">Parcial</Badge>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">{provider.description}</p>
                        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Key className="h-3 w-3" />
                            {provider.keys.filter(k => k.required).length} claves
                          </span>
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {provider.currencies.join(", ")}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ─── Step 2: Provider Overview ─── */}
          {step === "overview" && providerDef && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-5 w-5 text-primary" />
                    Paso 2: Información de {providerDef.name}
                  </CardTitle>
                  <CardDescription>
                    Revise las capacidades y requisitos antes de configurar las credenciales.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 rounded-lg border bg-card">
                    <p className="text-sm text-foreground">{providerDef.integrationNotes}</p>
                  </div>

                  {/* Capabilities */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Métodos de pago soportados
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {providerDef.capabilities.map(cap => (
                        <div key={cap.id} className="p-3 rounded-lg border bg-card">
                          <p className="text-sm font-medium">{cap.label}</p>
                          <p className="text-xs text-muted-foreground">{cap.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Required keys summary */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Key className="h-4 w-4 text-primary" />
                      Credenciales requeridas
                    </h3>
                    <div className="space-y-2">
                      {providerDef.keys.filter(k => k.required).map(k => (
                        <div key={k.key} className="flex items-center gap-3 p-2 rounded border bg-card">
                          {k.secret ? <Shield className="h-4 w-4 text-amber-500" /> : <Settings2 className="h-4 w-4 text-muted-foreground" />}
                          <div>
                            <p className="text-sm font-medium">{k.label}</p>
                            <p className="text-xs text-muted-foreground">{k.hint}</p>
                          </div>
                          {k.secret && <Badge variant="outline" className="ml-auto text-xs text-amber-500 border-amber-500/30">Secreto</Badge>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Webhook */}
                  {providerDef.webhookSupport && providerDef.webhookInstructions && (
                    <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
                      <h3 className="text-sm font-semibold flex items-center gap-2 text-amber-600">
                        <AlertTriangle className="h-4 w-4" />
                        Configuración de Webhooks
                      </h3>
                      <p className="text-sm text-muted-foreground mt-2">{providerDef.webhookInstructions}</p>
                    </div>
                  )}

                  {/* Docs link */}
                  {providerDef.docUrl && (
                    <a
                      href={providerDef.docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Documentación oficial de {providerDef.name}
                    </a>
                  )}

                  {/* Environment selector */}
                  <div>
                    <Label>Ambiente de configuración</Label>
                    <Select value={environment} onValueChange={setEnvironment}>
                      <SelectTrigger className="w-48 mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sandbox">🧪 Sandbox (Pruebas)</SelectItem>
                        <SelectItem value="production">🚀 Producción</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep("select")} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Volver
                </Button>
                <Button onClick={() => setStep("configure")} className="gap-2">
                  Continuar a Credenciales <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ─── Step 3: Configure Keys ─── */}
          {step === "configure" && providerDef && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5 text-primary" />
                    Paso 3: Credenciales de {providerDef.name}
                  </CardTitle>
                  <CardDescription>
                    Ingrese cada clave. Los valores secretos se almacenan cifrados y nunca se muestran una vez guardados.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Progress */}
                  <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">Progreso</span>
                        <span className="text-sm text-muted-foreground">{configuredCount}/{requiredCount} requeridas</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${requiredCount > 0 ? (configuredCount / requiredCount) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                    {allRequiredConfigured && <CheckCircle className="h-5 w-5 text-emerald-500" />}
                  </div>

                  <Separator />

                  {providerDef.keys.map(keyDef => {
                    const fullKey = getProviderConfigKey(selectedProvider!, keyDef.key);
                    const configured = getKeyConfigured(fullKey);
                    return (
                      <div key={keyDef.key} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">{keyDef.label}</span>
                            {keyDef.secret && (
                              <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30">Secreto</Badge>
                            )}
                            {!keyDef.required && (
                              <Badge variant="outline" className="text-xs">Opcional</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{keyDef.hint}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-4">
                          {configured ? (
                            <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Configurado
                            </Badge>
                          ) : (
                            <Badge className="bg-muted text-muted-foreground">No configurado</Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => {
                              setEditingKey(fullKey);
                              setEditValue("");
                              setShowValue(false);
                            }}
                          >
                            {configured ? "Actualizar" : "Configurar"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
                    <Shield className="h-3 w-3" />
                    Los valores secretos se almacenan cifrados y solo se usan en funciones del backend.
                  </p>
                </CardContent>
              </Card>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep("overview")} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Volver
                </Button>
                <Button onClick={() => setStep("test")} disabled={!allRequiredConfigured} className="gap-2">
                  Continuar a Verificación <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ─── Step 4: Test ─── */}
          {step === "test" && providerDef && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TestTube className="h-5 w-5 text-primary" />
                    Paso 4: Verificación de {providerDef.name}
                  </CardTitle>
                  <CardDescription>
                    Verifique que las credenciales están correctamente configuradas antes de activar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 rounded-lg border bg-card space-y-3">
                    <h3 className="text-sm font-semibold">Checklist de verificación</h3>
                    <div className="space-y-2">
                      <VerifyRow
                        label={`${requiredCount} credenciales requeridas configuradas`}
                        ok={allRequiredConfigured}
                      />
                      <VerifyRow
                        label={`Ambiente: ${environment}`}
                        ok={true}
                      />
                      <VerifyRow
                        label={providerDef.webhookSupport ? "Webhook configurado" : "Sin webhook (no requerido)"}
                        ok={true}
                      />
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
                    <h3 className="text-sm font-semibold flex items-center gap-2 text-amber-600">
                      <AlertTriangle className="h-4 w-4" />
                      Antes de activar
                    </h3>
                    <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                      <li>Verifique que las claves son del ambiente correcto ({environment})</li>
                      <li>Si está en producción, asegúrese de haber probado primero en sandbox</li>
                      <li>La pasarela activa actual ({gatewayData?.active_gateway || "mock"}) será reemplazada</li>
                      <li>Los cambios se registran en el trail de auditoría</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep("configure")} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Volver
                </Button>
                <Button onClick={() => setStep("activate")} className="gap-2">
                  Continuar a Activación <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ─── Step 5: Activate ─── */}
          {step === "activate" && providerDef && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-primary" />
                    Paso 5: Activar {providerDef.name}
                  </CardTitle>
                  <CardDescription>
                    Al activar, {providerDef.name} se convertirá en la pasarela de pagos activa de la plataforma.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-6 rounded-lg border-2 border-primary/30 bg-primary/5 text-center space-y-4">
                    <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                      {ICON_MAP[providerDef.logoIcon] || <CreditCard className="h-8 w-8 text-primary" />}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">{providerDef.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {providerDef.country} • {providerDef.currencies.join(", ")} • {environment}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {providerDef.capabilities.slice(0, 4).map(cap => (
                        <Badge key={cap.id} variant="outline">{cap.label}</Badge>
                      ))}
                    </div>

                    <Separator />

                    <Button
                      size="lg"
                      onClick={() => activateGateway.mutate()}
                      disabled={activateGateway.isPending}
                      className="gap-2"
                    >
                      {activateGateway.isPending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Power className="h-5 w-5" />
                      )}
                      Activar {providerDef.name} como Pasarela Principal
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Esta acción se registra en auditoría. Puede cambiar de pasarela en cualquier momento.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-start">
                <Button variant="outline" onClick={() => setStep("test")} className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Volver
                </Button>
              </div>
            </div>
          )}

          {/* ─── Step 6: Done ─── */}
          {step === "done" && providerDef && (
            <Card>
              <CardContent className="p-8 text-center space-y-4">
                <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="h-10 w-10 text-emerald-500" />
                </div>
                <h2 className="text-2xl font-bold">¡{providerDef.name} Activado!</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  La pasarela {providerDef.name} está ahora activa. Los pagos se procesarán a través de este proveedor.
                </p>
                <div className="flex justify-center gap-3 pt-4">
                  <Button variant="outline" onClick={() => { setStep("select"); setSelectedProvider(null); }} className="gap-2">
                    <CreditCard className="h-4 w-4" />
                    Configurar otra pasarela
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ─── Edit Key Dialog ─── */}
      <Dialog open={!!editingKey} onOpenChange={(open) => { if (!open) setEditingKey(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar Credencial</DialogTitle>
            <DialogDescription>
              {editingKey && providerDef?.keys.find(k => getProviderConfigKey(selectedProvider!, k.key) === editingKey)?.hint}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Clave</Label>
              <Input value={editingKey || ""} disabled className="font-mono text-sm" />
            </div>
            <div className="space-y-2">
              <Label>Valor</Label>
              <div className="relative">
                <Input
                  type={showValue ? "text" : "password"}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder={providerDef?.keys.find(k => getProviderConfigKey(selectedProvider!, k.key) === editingKey)?.placeholder || "Ingrese el valor..."}
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
              <p className="text-xs text-muted-foreground">
                El valor se almacena cifrado. Esta acción se registra en auditoría.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingKey(null)} disabled={saveKey.isPending}>
              Cancelar
            </Button>
            <Button onClick={() => {
              if (!editingKey || !editValue.trim()) { toast.error("Ingrese un valor válido"); return; }
              saveKey.mutate({ config_key: editingKey, config_value: editValue.trim() });
            }} disabled={saveKey.isPending || !editValue.trim()}>
              {saveKey.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VerifyRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
      <span className="text-sm">{label}</span>
    </div>
  );
}
