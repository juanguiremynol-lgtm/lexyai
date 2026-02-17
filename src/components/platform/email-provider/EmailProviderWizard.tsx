/**
 * EmailProviderWizard — Step-by-step wizard for configuring email providers.
 * Pattern mirrors Wompi billing setup: just enter keys, no code.
 * Includes AI guidance via Gemini for each step.
 */

import { useState, useCallback } from "react";
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
  Mail,
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
  HelpCircle,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { EmailProviderAIGuide } from "./EmailProviderAIGuide";

// ─── Provider definitions ───
const EMAIL_PROVIDERS = [
  {
    id: "resend",
    name: "Resend",
    description: "API moderna de email. Fácil de configurar, excelente deliverability.",
    docUrl: "https://resend.com/docs/introduction",
    recommended: true,
    keys: [
      { key: "RESEND_API_KEY", label: "API Key", secret: true, hint: "Encuentre su API Key en resend.com/api-keys", required: true },
      { key: "RESEND_FROM_EMAIL", label: "Email de envío (From)", secret: false, hint: "Ej: ATENIA <noreply@sudominio.com>. Debe verificar el dominio en Resend.", required: true },
      { key: "RESEND_WEBHOOK_SECRET", label: "Webhook Secret", secret: true, hint: "Opcional: para verificar webhooks de delivery status.", required: false },
    ],
  },
  {
    id: "sendgrid",
    name: "SendGrid (Twilio)",
    description: "Plataforma robusta de email transaccional por Twilio.",
    docUrl: "https://docs.sendgrid.com/for-developers/sending-email/quickstart-nodejs",
    recommended: false,
    keys: [
      { key: "SENDGRID_API_KEY", label: "API Key", secret: true, hint: "Cree una API Key en Settings > API Keys con permisos de Mail Send.", required: true },
      { key: "SENDGRID_FROM_EMAIL", label: "Email de envío (From)", secret: false, hint: "Debe ser un Sender verificado en SendGrid.", required: true },
      { key: "SENDGRID_WEBHOOK_SECRET", label: "Webhook Verification Key", secret: true, hint: "Opcional: para Event Webhooks.", required: false },
    ],
  },
  {
    id: "aws_ses",
    name: "Amazon SES",
    description: "Servicio de email escalable de AWS. Requiere credenciales IAM.",
    docUrl: "https://docs.aws.amazon.com/ses/latest/dg/Welcome.html",
    recommended: false,
    keys: [
      { key: "AWS_SES_ACCESS_KEY_ID", label: "Access Key ID", secret: true, hint: "Cree un usuario IAM con permisos ses:SendEmail.", required: true },
      { key: "AWS_SES_SECRET_ACCESS_KEY", label: "Secret Access Key", secret: true, hint: "La clave secreta del usuario IAM.", required: true },
      { key: "AWS_SES_REGION", label: "Región", secret: false, hint: "Ej: us-east-1, eu-west-1", required: true },
      { key: "AWS_SES_FROM_EMAIL", label: "Email de envío (From)", secret: false, hint: "Debe estar verificado en SES.", required: true },
    ],
  },
  {
    id: "mailgun",
    name: "Mailgun",
    description: "API de email popular con buen soporte de webhooks.",
    docUrl: "https://documentation.mailgun.com/docs/mailgun/quickstart/",
    recommended: false,
    keys: [
      { key: "MAILGUN_API_KEY", label: "API Key", secret: true, hint: "Encuentre su Private API Key en Settings > API Keys.", required: true },
      { key: "MAILGUN_DOMAIN", label: "Dominio", secret: false, hint: "El dominio verificado en Mailgun (ej: mg.sudominio.com).", required: true },
      { key: "MAILGUN_FROM_EMAIL", label: "Email de envío (From)", secret: false, hint: "Ej: ATENIA <noreply@mg.sudominio.com>", required: true },
      { key: "MAILGUN_WEBHOOK_SECRET", label: "Webhook Signing Key", secret: true, hint: "Opcional: para verificar webhooks.", required: false },
    ],
  },
  {
    id: "smtp",
    name: "SMTP Personalizado",
    description: "Cualquier servidor SMTP compatible. Configuración manual avanzada.",
    docUrl: "",
    recommended: false,
    keys: [
      { key: "SMTP_HOST", label: "Host", secret: false, hint: "Ej: smtp.gmail.com, smtp.office365.com", required: true },
      { key: "SMTP_PORT", label: "Puerto", secret: false, hint: "Común: 587 (TLS), 465 (SSL), 25 (no seguro)", required: true },
      { key: "SMTP_USER", label: "Usuario", secret: false, hint: "Generalmente su dirección de email.", required: true },
      { key: "SMTP_PASS", label: "Contraseña", secret: true, hint: "Contraseña o App Password del email.", required: true },
      { key: "SMTP_FROM_EMAIL", label: "Email de envío (From)", secret: false, hint: "Dirección que aparecerá como remitente.", required: true },
      { key: "SMTP_TLS", label: "TLS habilitado", secret: false, hint: "'true' o 'false'. Recomendado: true.", required: true },
    ],
  },
];

type WizardStep = "select" | "configure" | "test" | "activate" | "done";

const STEPS: { id: WizardStep; label: string; icon: React.ReactNode }[] = [
  { id: "select", label: "Elegir Proveedor", icon: <Mail className="h-4 w-4" /> },
  { id: "configure", label: "Configurar Claves", icon: <Key className="h-4 w-4" /> },
  { id: "test", label: "Probar Conexión", icon: <TestTube className="h-4 w-4" /> },
  { id: "activate", label: "Activar", icon: <Zap className="h-4 w-4" /> },
  { id: "done", label: "¡Listo!", icon: <CheckCircle className="h-4 w-4" /> },
];

async function fetchEmailProviderStatus() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-provider-admin`,
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
  return data;
}

async function callEmailProviderAdmin(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-provider-admin`,
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
  if (!response.ok || !data.ok) throw new Error(data.error || data.message || "Operation failed");
  return data;
}

export function EmailProviderWizard() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>("select");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [environment, setEnvironment] = useState("sandbox");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; details?: unknown } | null>(null);
  const [testing, setTesting] = useState(false);
  const [sendTestResult, setSendTestResult] = useState<{ ok: boolean; message: string; test?: string; details?: unknown } | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [testEmail, setTestEmail] = useState("");

  // Fetch current status
  const { data: status, isLoading } = useQuery({
    queryKey: ["email-provider-status"],
    queryFn: fetchEmailProviderStatus,
    staleTime: 10_000,
  });

  // Save key mutation
  const saveKey = useMutation({
    mutationFn: async ({ config_key, config_value }: { config_key: string; config_value: string }) => {
      return callEmailProviderAdmin({ action: "save_key", config_key, config_value, environment });
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["email-provider-status"] });
      toast.success(`${vars.config_key} guardado correctamente`);
      setEditingKey(null);
      setEditValue("");
      setShowValue(false);
    },
    onError: (err) => toast.error(`Error: ${(err as Error).message}`),
  });

  // Set provider mutation
  const setProvider = useMutation({
    mutationFn: async (provider_type: string) => {
      return callEmailProviderAdmin({ action: "set_provider", provider_type, environment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-provider-status"] });
      toast.success("Proveedor seleccionado");
      setStep("configure");
    },
    onError: (err) => toast.error(`Error: ${(err as Error).message}`),
  });

  // Activate mutation
  const activate = useMutation({
    mutationFn: async () => callEmailProviderAdmin({ action: "activate" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-provider-status"] });
      toast.success("¡Proveedor de email activado exitosamente!");
      setStep("done");
    },
    onError: (err) => toast.error(`Error: ${(err as Error).message}`),
  });

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await callEmailProviderAdmin({ action: "test_connection" });
      setTestResult({ ok: result.test === "passed" || result.test === "keys_present", message: result.message, details: result.details });
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleSendTestEmail = async () => {
    setSendingTest(true);
    setSendTestResult(null);
    try {
      const result = await callEmailProviderAdmin({
        action: "send_test_email",
        ...(testEmail.trim() ? { to_email: testEmail.trim() } : {}),
      });
      setSendTestResult(result);
    } catch (err) {
      setSendTestResult({ ok: false, message: (err as Error).message, test: "error" });
    } finally {
      setSendingTest(false);
    }
  };

  const handleSelectProvider = (providerId: string) => {
    setSelectedProvider(providerId);
    setProvider.mutate(providerId);
  };

  const providerDef = EMAIL_PROVIDERS.find((p) => p.id === selectedProvider || p.id === status?.active_provider);
  const currentProviderId = selectedProvider || status?.active_provider;
  const currentProviderDef = EMAIL_PROVIDERS.find((p) => p.id === currentProviderId);

  // Determine key status from fetched data
  const getKeyStatus = (configKey: string): boolean => {
    if (!status?.providers) return false;
    for (const p of status.providers) {
      for (const k of p.keys) {
        if (k.key === configKey && k.configured) return true;
      }
    }
    return false;
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  // Auto-advance: if provider already selected, start at configure
  const effectiveStep = step;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Mail className="h-7 w-7 text-primary" />
          Integración de Proveedor de Email
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure su proveedor de email externo paso a paso. Sin necesidad de tocar código.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {STEPS.map((s, i) => {
          const isCurrent = s.id === effectiveStep;
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

      {/* Content + AI Guide */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 min-h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Cargando configuración...
            </div>
          ) : (
            <>
              {/* Step: Select Provider */}
              {effectiveStep === "select" && (
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Mail className="h-5 w-5 text-primary" />
                        Paso 1: Seleccione su proveedor de email
                      </CardTitle>
                      <CardDescription>
                        Elija el servicio que usará para enviar emails transaccionales (alertas, recordatorios, notificaciones).
                        Todos los proveedores se integran sin tocar código — solo ingrese sus credenciales.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {/* Environment selector */}
                      <div className="mb-6">
                        <Label>Ambiente</Label>
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

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {EMAIL_PROVIDERS.map((provider) => (
                          <button
                            key={provider.id}
                            onClick={() => handleSelectProvider(provider.id)}
                            disabled={setProvider.isPending}
                            className={`relative text-left p-4 rounded-lg border-2 transition-all hover:border-primary/50 hover:bg-accent/50 ${
                              status?.active_provider === provider.id
                                ? "border-primary bg-primary/5"
                                : "border-border"
                            }`}
                          >
                            {provider.recommended && (
                              <Badge className="absolute top-2 right-2 bg-primary/20 text-primary border-primary/30">
                                Recomendado
                              </Badge>
                            )}
                            <h3 className="font-semibold text-foreground">{provider.name}</h3>
                            <p className="text-sm text-muted-foreground mt-1">{provider.description}</p>
                            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                              <Key className="h-3 w-3" />
                              {provider.keys.filter((k) => k.required).length} claves requeridas
                              {provider.docUrl && (
                                <a
                                  href={provider.docUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-primary hover:underline ml-auto"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Docs <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Step: Configure Keys */}
              {effectiveStep === "configure" && currentProviderDef && (
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Key className="h-5 w-5 text-primary" />
                        Paso 2: Configure las credenciales de {currentProviderDef.name}
                      </CardTitle>
                      <CardDescription>
                        Ingrese cada clave una por una. Los valores secretos se almacenan cifrados y nunca se muestran una vez guardados.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {currentProviderDef.keys.map((keyDef) => {
                        const configured = getKeyStatus(keyDef.key);
                        return (
                          <div key={keyDef.key} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-medium">{keyDef.label}</span>
                                {keyDef.secret && (
                                  <Badge variant="outline" className="text-xs">Secreto</Badge>
                                )}
                                {!keyDef.required && (
                                  <Badge variant="secondary" className="text-xs">Opcional</Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">{keyDef.hint}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-4">
                              {configured ? (
                                <Badge className="bg-emerald-500/20 text-emerald-600 border-emerald-500/30 gap-1">
                                  <CheckCircle className="h-3 w-3" />
                                  Configurado
                                </Badge>
                              ) : keyDef.required ? (
                                <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30 gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  Pendiente
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">No configurado</Badge>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                onClick={() => {
                                  setEditingKey(keyDef.key);
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

                      <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 mt-4">
                        <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <div className="text-sm text-muted-foreground">
                          <strong className="text-foreground">Seguridad:</strong> Los valores secretos se almacenan cifrados en la base de datos.
                          Solo se usan en funciones del backend. Nunca se exponen al frontend ni se incluyen en logs.
                          Cada cambio queda registrado en auditoría.
                        </div>
                      </div>

                      {currentProviderDef.docUrl && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-accent/50 border">
                          <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm text-muted-foreground">
                            ¿No sabe dónde encontrar las claves?{" "}
                            <a
                              href={currentProviderDef.docUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline font-medium"
                            >
                              Consulte la documentación oficial →
                            </a>
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setStep("select")}>
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Volver
                    </Button>
                    <Button
                      onClick={() => setStep("test")}
                      disabled={!currentProviderDef.keys.filter((k) => k.required).every((k) => getKeyStatus(k.key))}
                    >
                      Continuar
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step: Test Connection + E2E Test Email */}
              {effectiveStep === "test" && (
                <div className="space-y-4">
                  {/* Sub-step A: API Connection Test */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <TestTube className="h-5 w-5 text-primary" />
                        Paso 3A: Verificar credenciales
                      </CardTitle>
                      <CardDescription>
                        Verificamos que las credenciales sean válidas y que el proveedor esté accesible.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Button onClick={handleTestConnection} disabled={testing} className="gap-2">
                        {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube className="h-4 w-4" />}
                        {testing ? "Probando..." : "Ejecutar prueba de conexión"}
                      </Button>

                      {testResult && (
                        <div className={`p-4 rounded-lg border ${
                          testResult.ok
                            ? "bg-emerald-500/10 border-emerald-500/30"
                            : "bg-destructive/10 border-destructive/30"
                        }`}>
                          <div className="flex items-center gap-2">
                            {testResult.ok ? (
                              <CheckCircle className="h-5 w-5 text-emerald-500" />
                            ) : (
                              <XCircle className="h-5 w-5 text-destructive" />
                            )}
                            <span className={`font-medium ${testResult.ok ? "text-emerald-600" : "text-destructive"}`}>
                              {testResult.ok ? "Conexión exitosa" : "Error en la conexión"}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-2">{testResult.message}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Sub-step B: Send Test Email (E2E pipeline test) */}
                  <Card className={!testResult?.ok ? "opacity-60 pointer-events-none" : ""}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Mail className="h-5 w-5 text-primary" />
                        Paso 3B: Enviar email de prueba (E2E)
                      </CardTitle>
                      <CardDescription>
                        Envía un email real a través del pipeline completo para verificar que todo funciona de extremo a extremo.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        <Input
                          type="email"
                          placeholder="Email destino (vacío = tu email)"
                          value={testEmail}
                          onChange={(e) => setTestEmail(e.target.value)}
                          className="flex-1"
                        />
                        <Button onClick={handleSendTestEmail} disabled={sendingTest} className="gap-2 shrink-0">
                          {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          {sendingTest ? "Enviando..." : "Enviar prueba E2E"}
                        </Button>
                      </div>

                      {sendTestResult && (
                        <div className={`p-4 rounded-lg border ${
                          sendTestResult.ok
                            ? sendTestResult.test === "sent"
                              ? "bg-emerald-500/10 border-emerald-500/30"
                              : "bg-blue-500/10 border-blue-500/30"
                            : "bg-destructive/10 border-destructive/30"
                        }`}>
                          <div className="flex items-center gap-2">
                            {sendTestResult.ok ? (
                              sendTestResult.test === "sent" ? (
                                <CheckCircle className="h-5 w-5 text-emerald-500" />
                              ) : (
                                <Mail className="h-5 w-5 text-blue-500" />
                              )
                            ) : (
                              <XCircle className="h-5 w-5 text-destructive" />
                            )}
                            <span className={`font-medium ${
                              sendTestResult.ok
                                ? sendTestResult.test === "sent" ? "text-emerald-600" : "text-blue-600"
                                : "text-destructive"
                            }`}>
                              {sendTestResult.ok
                                ? sendTestResult.test === "sent" ? "Email enviado" : "Email encolado"
                                : "Error al enviar"}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-2">{sendTestResult.message}</p>
                        </div>
                      )}

                      <div className="flex items-start gap-2 p-3 rounded-lg bg-accent/50 border">
                        <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <p className="text-sm text-muted-foreground">
                          El email se envía a través del pipeline real (email_outbox → {currentProviderDef?.name}).
                          Si lo recibes, el proveedor está listo para activarse.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setStep("configure")}>
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Volver
                    </Button>
                    <Button onClick={() => setStep("activate")} disabled={!testResult?.ok}>
                      Continuar
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step: Activate */}
              {effectiveStep === "activate" && (
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Zap className="h-5 w-5 text-primary" />
                        Paso 4: Activar proveedor
                      </CardTitle>
                      <CardDescription>
                        Revise la configuración y active el proveedor de email para toda la plataforma.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Summary */}
                      <div className="rounded-lg border p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Proveedor</span>
                          <Badge>{currentProviderDef?.name}</Badge>
                        </div>
                        <Separator />
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Ambiente</span>
                          <Badge variant="outline">{environment === "production" ? "🚀 Producción" : "🧪 Sandbox"}</Badge>
                        </div>
                        <Separator />
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Claves configuradas</span>
                          <span className="text-sm">
                            {currentProviderDef?.keys.filter((k) => getKeyStatus(k.key)).length} / {currentProviderDef?.keys.length}
                          </span>
                        </div>
                        <Separator />
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Test de conexión</span>
                          <Badge className="bg-emerald-500/20 text-emerald-600 border-emerald-500/30 gap-1">
                            <CheckCircle className="h-3 w-3" />
                            Aprobado
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-sm text-amber-700 dark:text-amber-400">
                          Al activar, todos los emails de la plataforma se enviarán a través de <strong>{currentProviderDef?.name}</strong>.
                          Asegúrese de que las credenciales sean correctas y que su dominio esté verificado en el proveedor.
                        </p>
                      </div>

                      <Button
                        onClick={() => activate.mutate()}
                        disabled={activate.isPending}
                        className="w-full gap-2"
                        size="lg"
                      >
                        {activate.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                        Activar Proveedor de Email
                      </Button>
                    </CardContent>
                  </Card>

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setStep("test")}>
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Volver
                    </Button>
                  </div>
                </div>
              )}

              {/* Step: Done */}
              {effectiveStep === "done" && (
                <Card>
                  <CardContent className="py-12 text-center space-y-4">
                    <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-emerald-500/20 mx-auto">
                      <CheckCircle className="h-8 w-8 text-emerald-500" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground">¡Proveedor de Email Activado!</h2>
                    <p className="text-muted-foreground max-w-md mx-auto">
                      {currentProviderDef?.name} está configurado y activo. Todos los emails transaccionales
                      (alertas, recordatorios, notificaciones) se enviarán a través de este proveedor.
                    </p>
                    <div className="flex items-center justify-center gap-2 pt-4">
                      <Button variant="outline" onClick={() => { setStep("select"); setTestResult(null); }}>
                        Cambiar Proveedor
                      </Button>
                      <Button variant="outline" onClick={() => setStep("configure")}>
                        Actualizar Claves
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        {/* AI Guide Panel */}
        <div className="xl:col-span-1">
          <EmailProviderAIGuide step={effectiveStep} provider={currentProviderId || null} />
        </div>
      </div>

      {/* Edit Key Dialog */}
      <Dialog open={!!editingKey} onOpenChange={(open) => { if (!open) { setEditingKey(null); setEditValue(""); setShowValue(false); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar {editingKey}</DialogTitle>
            <DialogDescription>
              {currentProviderDef?.keys.find((k) => k.key === editingKey)?.hint}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Valor</Label>
              <div className="relative">
                <Input
                  type={showValue ? "text" : "password"}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Ingrese el valor..."
                  className="pr-10"
                  autoFocus
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
                El valor anterior será reemplazado. Esta acción se registra en auditoría.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingKey(null)} disabled={saveKey.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (editingKey && editValue.trim()) {
                  saveKey.mutate({ config_key: editingKey, config_value: editValue.trim() });
                }
              }}
              disabled={saveKey.isPending || !editValue.trim()}
            >
              {saveKey.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
