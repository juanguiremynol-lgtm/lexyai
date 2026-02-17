/**
 * EmailSetupWizard — 5-step stepper for Super Admin email configuration.
 * Steps: 1) Outbound Provider, 2) Sender Identity, 3) Test Send, 4) Resend Inbound Webhook, 5) Activate
 * IMAP is NOT offered — Supabase Edge runtime blocks raw TLS sockets.
 */

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  CheckCircle, Circle, Loader2, Mail, Send, Shield, Inbox,
  Power, AlertTriangle, ChevronRight, ChevronLeft, Webhook, Copy,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────

interface SetupState {
  id: string;
  step_resend_key_ok: boolean;
  step_from_identity_ok: boolean;
  step_test_send_ok: boolean;
  step_inbound_selected: boolean;
  step_inbound_ok: boolean;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: string;
}

interface EmailSettings {
  id: string;
  from_email: string;
  from_name: string;
  reply_to: string | null;
  outbound_provider: string;
  inbound_mode: string;
  is_enabled: boolean;
}

const STEPS = [
  { key: "provider", label: "Proveedor Outbound", icon: Mail },
  { key: "identity", label: "Identidad de Envío", icon: Shield },
  { key: "test", label: "Test de Envío", icon: Send },
  { key: "inbound", label: "Webhook Inbound", icon: Webhook },
  { key: "activate", label: "Activar", icon: Power },
] as const;

const SETUP_STATE_ID = "00000000-0000-0000-0000-000000000001";

// ─── Data fetching ──────────────────────────────────────

async function fetchSetupState(): Promise<SetupState | null> {
  const { data, error } = await (supabase.from("system_email_setup_state") as any)
    .select("*")
    .eq("id", SETUP_STATE_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchSettings(): Promise<EmailSettings | null> {
  const { data, error } = await (supabase.from("system_email_settings") as any)
    .select("id, from_email, from_name, reply_to, outbound_provider, inbound_mode, is_enabled")
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Wizard Component ───────────────────────────────────

export function EmailSetupWizard() {
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);

  const { data: setupState, isLoading: stateLoading } = useQuery({
    queryKey: ["email-setup-state"],
    queryFn: fetchSetupState,
  });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["system-email-settings-wizard"],
    queryFn: fetchSettings,
  });

  const isLoading = stateLoading || settingsLoading;

  const completedSteps = [
    setupState?.step_resend_key_ok ?? false,
    setupState?.step_from_identity_ok ?? false,
    setupState?.step_test_send_ok ?? false,
    setupState?.step_inbound_selected ?? false,
    setupState?.step_inbound_ok ?? false,
  ];

  const completedCount = completedSteps.filter(Boolean).length;

  // Auto-restore to the first incomplete step on mount
  useEffect(() => {
    if (setupState) {
      const firstIncomplete = completedSteps.findIndex((done) => !done);
      if (firstIncomplete >= 0) setActiveStep(firstIncomplete);
    }
  }, [setupState?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Email Setup Wizard</h1>
        <p className="text-muted-foreground text-sm">
          Configura el sistema de email de la plataforma paso a paso. {completedCount}/5 completados.
        </p>
      </div>

      {/* Error Banner */}
      {setupState?.last_error_message && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">
              {setupState.last_error_code || "Error"}
            </p>
            <p className="text-sm text-muted-foreground">{setupState.last_error_message}</p>
          </div>
        </div>
      )}

      {/* Stepper */}
      <div className="flex items-center gap-1">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const done = completedSteps[i];
          const active = i === activeStep;
          return (
            <button
              key={step.key}
              onClick={() => setActiveStep(i)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors flex-1 justify-center
                ${active ? "bg-primary text-primary-foreground" : done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              {done ? <CheckCircle className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
              <Icon className="h-4 w-4 hidden sm:block" />
              <span className="hidden md:inline">{step.label}</span>
              <span className="md:hidden text-xs">{i + 1}</span>
            </button>
          );
        })}
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="pt-6">
          {activeStep === 0 && <StepOutboundProvider setupState={setupState} queryClient={queryClient} />}
          {activeStep === 1 && <StepSenderIdentity settings={settings} queryClient={queryClient} />}
          {activeStep === 2 && <StepTestSend setupState={setupState} queryClient={queryClient} />}
          {activeStep === 3 && <StepResendInbound settings={settings} setupState={setupState} queryClient={queryClient} />}
          {activeStep === 4 && <StepActivate settings={settings} setupState={setupState} queryClient={queryClient} />}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" disabled={activeStep === 0} onClick={() => setActiveStep(s => s - 1)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
        </Button>
        <Button disabled={activeStep === STEPS.length - 1} onClick={() => setActiveStep(s => s + 1)}>
          Siguiente <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 1: Outbound Provider ──────────────────────────

function StepOutboundProvider({ setupState, queryClient }: { setupState: SetupState | null; queryClient: any }) {
  const [checking, setChecking] = useState(false);

  const checkResendKey = async () => {
    setChecking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No autenticado");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-provider-admin`,
        { method: "GET", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" } }
      );
      const data = await res.json();
      const keyOk = res.ok && data.ok && data.is_configured;

      await (supabase.from("system_email_setup_state") as any)
        .update({
          step_resend_key_ok: keyOk,
          last_error_code: keyOk ? null : "RESEND_NOT_CONFIGURED",
          last_error_message: keyOk ? null : "La API key de Resend no está configurada o el proveedor no está activo.",
        })
        .eq("id", SETUP_STATE_ID);

      queryClient.invalidateQueries({ queryKey: ["email-setup-state"] });
      toast[keyOk ? "success" : "error"](keyOk ? "RESEND_API_KEY detectada ✓" : "RESEND_API_KEY no encontrada");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Proveedor de Outbound</h3>
        <p className="text-sm text-muted-foreground">
          Atenia usa <strong>Resend</strong> como proveedor exclusivo de envío de emails.
        </p>
      </div>

      <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-3">
          <Mail className="h-5 w-5 text-primary" />
          <div>
            <p className="font-medium">Resend</p>
            <p className="text-xs text-muted-foreground">API de email transaccional</p>
          </div>
        </div>
        <Badge variant={setupState?.step_resend_key_ok ? "default" : "secondary"}>
          {setupState?.step_resend_key_ok ? "✓ Configurado" : "Pendiente"}
        </Badge>
      </div>

      <div className="p-4 rounded-lg bg-muted/50 text-sm space-y-2">
        <p className="font-medium">Instrucciones:</p>
        <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
          <li>Crea una cuenta en <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">resend.com</a></li>
          <li>Genera una API Key en Dashboard → API Keys</li>
          <li>Agrega <code className="text-xs bg-background px-1 rounded">RESEND_API_KEY</code> a los Secrets de las Edge Functions</li>
          <li>Haz clic en "Verificar" abajo</li>
        </ol>
      </div>

      <Button onClick={checkResendKey} disabled={checking}>
        {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
        Verificar RESEND_API_KEY
      </Button>
    </div>
  );
}

// ─── Step 2: Sender Identity ────────────────────────────

function StepSenderIdentity({ settings, queryClient }: { settings: EmailSettings | null; queryClient: any }) {
  const [fromEmail, setFromEmail] = useState(settings?.from_email || "info@andromeda.legal");
  const [fromName, setFromName] = useState(settings?.from_name || "ATENIA");
  const [replyTo, setReplyTo] = useState(settings?.reply_to || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (!settings?.id) throw new Error("No settings row found");
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(fromEmail)) throw new Error("Email inválido");

      await (supabase.from("system_email_settings") as any)
        .update({ from_email: fromEmail.trim(), from_name: fromName.trim(), reply_to: replyTo.trim() || null })
        .eq("id", settings.id);

      await (supabase.from("system_email_setup_state") as any)
        .update({ step_from_identity_ok: true, last_error_code: null, last_error_message: null })
        .eq("id", SETUP_STATE_ID);

      queryClient.invalidateQueries({ queryKey: ["email-setup-state"] });
      queryClient.invalidateQueries({ queryKey: ["system-email-settings-wizard"] });
      toast.success("Identidad guardada");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Identidad del Remitente</h3>
        <p className="text-sm text-muted-foreground">
          Configura el "From" de todos los emails enviados por la plataforma.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Email del remitente</Label>
          <Input value={fromEmail} onChange={e => setFromEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Nombre del remitente</Label>
          <Input value={fromName} onChange={e => setFromName(e.target.value)} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Reply-To (opcional)</Label>
          <Input value={replyTo} onChange={e => setReplyTo(e.target.value)} placeholder="soporte@andromeda.legal" />
        </div>
      </div>
      <Button onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
        Guardar Identidad
      </Button>
    </div>
  );
}

// ─── Step 3: Test Send ──────────────────────────────────

function StepTestSend({ setupState, queryClient }: { setupState: SetupState | null; queryClient: any }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; provider_id?: string } | null>(null);

  const handleTestSend = async () => {
    setSending(true);
    setResult(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("No se pudo obtener tu email");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No autenticado");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-provider-admin`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send_test_email", to_email: user.email }),
        }
      );
      const data = await res.json();

      if (res.ok && data.ok) {
        setResult({ ok: true, message: `Test enviado a ${user.email}`, provider_id: data.provider_message_id });
        await (supabase.from("system_email_setup_state") as any)
          .update({ step_test_send_ok: true, last_error_code: null, last_error_message: null })
          .eq("id", SETUP_STATE_ID);
      } else {
        const errMsg = data.error || data.message || "Error desconocido de Resend";
        setResult({ ok: false, message: errMsg });
        await (supabase.from("system_email_setup_state") as any)
          .update({ last_error_code: "TEST_SEND_FAILED", last_error_message: errMsg })
          .eq("id", SETUP_STATE_ID);
      }
      queryClient.invalidateQueries({ queryKey: ["email-setup-state"] });
    } catch (err: any) {
      setResult({ ok: false, message: err.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Test de Envío</h3>
        <p className="text-sm text-muted-foreground">
          Envía un email de prueba real a tu cuenta de Super Admin para verificar que todo funciona.
        </p>
      </div>
      <Button onClick={handleTestSend} disabled={sending} size="lg">
        {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
        Enviar email de prueba
      </Button>
      {result && (
        <div className={`p-4 rounded-lg border ${result.ok ? "bg-primary/10 border-primary/30" : "bg-destructive/10 border-destructive/30"}`}>
          <div className="flex items-center gap-2">
            {result.ok ? <CheckCircle className="h-5 w-5 text-primary" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}
            <span className="text-sm font-medium">{result.ok ? "Éxito" : "Error"}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{result.message}</p>
          {result.provider_id && (
            <p className="text-xs text-muted-foreground mt-1 font-mono">ID: {result.provider_id}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 4: Resend Inbound Webhook (IMAP removed) ─────

function StepResendInbound({ settings, setupState, queryClient }: { settings: EmailSettings | null; setupState: SetupState | null; queryClient: any }) {
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [secretStatus, setSecretStatus] = useState<{ hasSecret: boolean; lastEvent: { id: string; at: string } | null; hasRecentEvent: boolean } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/system-email-inbound-webhook`;
  const INBOUND_ADDRESS = "info@inbound.andromeda.legal";

  const handleSaveMode = async () => {
    setSaving(true);
    try {
      if (!settings?.id) throw new Error("No settings row");
      await (supabase.from("system_email_settings") as any)
        .update({ inbound_mode: "resend_inbound" })
        .eq("id", settings.id);

      await (supabase.from("system_email_setup_state") as any)
        .update({ step_inbound_selected: true })
        .eq("id", SETUP_STATE_ID);

      queryClient.invalidateQueries({ queryKey: ["email-setup-state"] });
      queryClient.invalidateQueries({ queryKey: ["system-email-settings-wizard"] });
      toast.success("Modo inbound configurado");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyInbound = async () => {
    setVerifying(true);
    setVerifyError(null);
    setSecretStatus(null);
    try {
      const { data, error } = await supabase.functions.invoke("system-email-inbound-status", { method: "GET" });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Error desconocido");

      setSecretStatus(data);

      if (data.hasSecret && data.hasRecentEvent) {
        // Mark step as complete
        await (supabase.from("system_email_setup_state") as any)
          .update({ step_inbound_ok: true, last_error_code: null, last_error_message: null })
          .eq("id", SETUP_STATE_ID);
        queryClient.invalidateQueries({ queryKey: ["email-setup-state"] });
        toast.success("Inbound verificado ✓");
      }
    } catch (err: any) {
      setVerifyError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Webhook de Entrada (Resend Inbound)</h3>
        <p className="text-sm text-muted-foreground">
          Configura Resend para recibir correos entrantes en la plataforma vía webhook.
          Hostinger sigue siendo tu buzón real — solo necesitas un reenvío.
        </p>
      </div>

      {/* Hostinger Forwarding Banner */}
      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 text-sm space-y-2">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary shrink-0" />
          <p className="font-medium">Reenvío desde Hostinger</p>
        </div>
        <p className="text-muted-foreground">
          Configura una regla de reenvío en Hostinger para que una copia de los emails a{" "}
          <code className="text-xs bg-background px-1 rounded border">info@andromeda.legal</code> se reenvíe a:
        </p>
        <div className="flex items-center gap-2">
          <code className="bg-background px-2 py-1 rounded text-xs break-all flex-1 border font-mono">
            {INBOUND_ADDRESS}
          </code>
          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(INBOUND_ADDRESS)} className="shrink-0">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Esto permite que Resend reciba una copia y dispare el webhook sin afectar tu buzón en Hostinger.
        </p>
      </div>

      {/* Setup Instructions */}
      <div className="p-4 rounded-lg bg-muted/50 text-sm space-y-3">
        <p className="font-medium">Instrucciones de configuración:</p>
        <ol className="list-decimal pl-4 space-y-2 text-muted-foreground">
          <li>
            Ve a <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="text-primary underline">resend.com → Domains</a> → tu dominio → <strong>Inbound</strong>
          </li>
          <li>
            Configura el webhook URL:
            <div className="flex items-center gap-2 mt-1">
              <code className="bg-background px-2 py-1 rounded text-xs break-all flex-1 border">
                {webhookUrl}
              </code>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(webhookUrl)} className="shrink-0">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
          <li>
            Eventos requeridos: <code className="text-xs bg-background px-1 rounded border">email.received</code>
          </li>
          <li>
            Copia el <strong>Webhook Signing Secret</strong> de Resend (formato <code className="text-xs">whsec_...</code>) y guárdalo como secret:
            <div className="flex items-center gap-2 mt-1">
              <code className="bg-background px-2 py-1 rounded text-xs border">RESEND_INBOUND_WEBHOOK_SECRET</code>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard("RESEND_INBOUND_WEBHOOK_SECRET")} className="shrink-0">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
          <li>
            Envía un email de prueba a <code className="text-xs bg-background px-1 rounded border">{INBOUND_ADDRESS}</code> y verifica abajo.
          </li>
        </ol>
      </div>

      {/* Secret Status Banner */}
      {secretStatus && !secretStatus.hasSecret && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">Secret faltante</p>
            <p className="text-sm text-muted-foreground">
              <code className="text-xs">RESEND_INBOUND_WEBHOOK_SECRET</code> no está configurado en los secrets de las Edge Functions.
              El webhook rechazará todas las solicitudes hasta que se configure.
            </p>
          </div>
        </div>
      )}

      {/* Verification Result */}
      {secretStatus && secretStatus.hasSecret && (
        <div className={`p-4 rounded-lg border ${secretStatus.hasRecentEvent ? "bg-primary/10 border-primary/30" : "bg-muted border-border"}`}>
          <div className="flex items-center gap-2">
            {secretStatus.hasRecentEvent ? (
              <CheckCircle className="h-5 w-5 text-primary" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            )}
            <span className="text-sm font-medium">
              {secretStatus.hasRecentEvent
                ? "Inbound verificado"
                : "No hay eventos en las últimas 24h"}
            </span>
          </div>
          {secretStatus.lastEvent && (
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              Último evento: {new Date(secretStatus.lastEvent.at).toLocaleString("es-CO")} — ID: {secretStatus.lastEvent.id}
            </p>
          )}
          {!secretStatus.hasRecentEvent && (
            <p className="text-xs text-muted-foreground mt-1">
              Envía un test email a <code>{INBOUND_ADDRESS}</code> o usa "Test Webhook" en el dashboard de Resend.
            </p>
          )}
        </div>
      )}

      {verifyError && (
        <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <span className="text-sm">{verifyError}</span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button onClick={handleSaveMode} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
          Marcar como configurado
        </Button>
        <Button variant="outline" onClick={handleVerifyInbound} disabled={verifying}>
          {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Webhook className="h-4 w-4 mr-2" />}
          Verificar inbound
        </Button>
      </div>
    </div>
  );
}

// ─── Step 5: Activate ───────────────────────────────────

function StepActivate({ settings, setupState, queryClient }: { settings: EmailSettings | null; setupState: SetupState | null; queryClient: any }) {
  const [enabling, setEnabling] = useState(false);

  const allStepsDone = setupState?.step_resend_key_ok && setupState?.step_from_identity_ok && setupState?.step_test_send_ok;

  const toggleEnabled = async (enabled: boolean) => {
    setEnabling(true);
    try {
      if (!settings?.id) throw new Error("No settings row");
      await (supabase.from("system_email_settings") as any)
        .update({ is_enabled: enabled })
        .eq("id", settings.id);

      queryClient.invalidateQueries({ queryKey: ["system-email-settings-wizard"] });
      queryClient.invalidateQueries({ queryKey: ["email-setup-state"] });
      toast.success(enabled ? "Email habilitado ✓" : "Email deshabilitado");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setEnabling(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Activar Sistema de Email</h3>
        <p className="text-sm text-muted-foreground">
          Habilita el envío de emails desde la plataforma. Compose y alertas usarán esta configuración.
        </p>
      </div>

      {/* Checklist Summary */}
      <div className="space-y-2">
        {[
          { done: setupState?.step_resend_key_ok, label: "RESEND_API_KEY configurada" },
          { done: setupState?.step_from_identity_ok, label: "Identidad del remitente guardada" },
          { done: setupState?.step_test_send_ok, label: "Test de envío exitoso" },
          { done: setupState?.step_inbound_selected, label: "Webhook inbound configurado" },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            {item.done ? <CheckCircle className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
            <span className={item.done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 p-4 rounded-lg border">
        <Switch
          checked={settings?.is_enabled ?? false}
          onCheckedChange={toggleEnabled}
          disabled={enabling || !allStepsDone}
        />
        <div>
          <p className="font-medium">{settings?.is_enabled ? "Email Activo" : "Email Desactivado"}</p>
          {!allStepsDone && (
            <p className="text-xs text-muted-foreground">Completa los pasos 1-3 para poder activar.</p>
          )}
        </div>
        {enabling && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>
    </div>
  );
}
