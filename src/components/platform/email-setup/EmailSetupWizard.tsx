/**
 * EmailSetupWizard — 5-step stepper for Super Admin email configuration.
 * Steps: 1) Outbound Provider, 2) Sender Identity, 3) Test Send, 4) Inbound Mode, 5) Activate
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  CheckCircle, Circle, Loader2, Mail, Send, Shield, Inbox,
  Power, AlertTriangle, ChevronRight, ChevronLeft, ExternalLink,
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
  { key: "inbound", label: "Modo Inbound", icon: Inbox },
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
          {activeStep === 1 && <StepSenderIdentity settings={settings} queryClient={queryClient} setupState={setupState} />}
          {activeStep === 2 && <StepTestSend setupState={setupState} queryClient={queryClient} />}
          {activeStep === 3 && <StepInboundMode settings={settings} setupState={setupState} queryClient={queryClient} />}
          {activeStep === 4 && <StepActivate settings={settings} setupState={setupState} queryClient={queryClient} />}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          disabled={activeStep === 0}
          onClick={() => setActiveStep(s => s - 1)}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
        </Button>
        <Button
          disabled={activeStep === STEPS.length - 1}
          onClick={() => setActiveStep(s => s + 1)}
        >
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
        {
          method: "GET",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        }
      );
      const data = await res.json();

      // Update setup state
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

function StepSenderIdentity({ settings, queryClient, setupState }: { settings: EmailSettings | null; queryClient: any; setupState: SetupState | null }) {
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
        .update({
          from_email: fromEmail.trim(),
          from_name: fromName.trim(),
          reply_to: replyTo.trim() || null,
        })
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
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
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

// ─── Step 4: Inbound Mode ───────────────────────────────

function StepInboundMode({ settings, setupState, queryClient }: { settings: EmailSettings | null; setupState: SetupState | null; queryClient: any }) {
  const [mode, setMode] = useState(settings?.inbound_mode || "none");
  const [saving, setSaving] = useState(false);

  // IMAP fields
  const [imapHost, setImapHost] = useState("imap.hostinger.com");
  const [imapUser, setImapUser] = useState("info@andromeda.legal");
  const [imapPass, setImapPass] = useState("");
  const [imapTesting, setImapTesting] = useState(false);
  const [imapResult, setImapResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleSaveMode = async () => {
    setSaving(true);
    try {
      if (!settings?.id) throw new Error("No settings row");
      await (supabase.from("system_email_settings") as any)
        .update({ inbound_mode: mode })
        .eq("id", settings.id);

      await (supabase.from("system_email_setup_state") as any)
        .update({ step_inbound_selected: true })
        .eq("id", SETUP_STATE_ID);

      queryClient.invalidateQueries({ queryKey: ["email-setup-state"] });
      queryClient.invalidateQueries({ queryKey: ["system-email-settings-wizard"] });
      toast.success("Modo inbound guardado");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestImap = async () => {
    setImapTesting(true);
    setImapResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No autenticado");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/system-email-imap-connect`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            imap_host: imapHost,
            imap_port: 993,
            imap_tls: true,
            username: imapUser,
            password: imapPass,
          }),
        }
      );
      const data = await res.json();

      if (res.ok && data.ok) {
        setImapResult({ ok: true, message: data.message || "Conexión IMAP exitosa" });
      } else {
        setImapResult({ ok: false, message: data.error || data.message || "Error de conexión IMAP" });
      }
    } catch (err: any) {
      setImapResult({ ok: false, message: err.message });
    } finally {
      setImapTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Modo de Recepción (Inbound)</h3>
        <p className="text-sm text-muted-foreground">
          Elige cómo la plataforma recibirá emails entrantes.
        </p>
      </div>

      <RadioGroup value={mode} onValueChange={setMode} className="space-y-3">
        <label className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${mode === "none" ? "border-primary bg-primary/5" : ""}`}>
          <RadioGroupItem value="none" className="mt-1" />
          <div>
            <p className="font-medium">Sin Inbound</p>
            <p className="text-sm text-muted-foreground">Solo envío de emails (alertas y compose). No se reciben emails.</p>
          </div>
        </label>

        <label className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${mode === "resend_inbound" ? "border-primary bg-primary/5" : ""}`}>
          <RadioGroupItem value="resend_inbound" className="mt-1" />
          <div>
            <p className="font-medium">Resend Inbound <Badge variant="outline" className="ml-2 text-xs">Recomendado</Badge></p>
            <p className="text-sm text-muted-foreground">Configura un forwarding desde Hostinger a Resend Inbound webhook.</p>
          </div>
        </label>

        <label className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${mode === "hostinger_imap" ? "border-primary bg-primary/5" : ""}`}>
          <RadioGroupItem value="hostinger_imap" className="mt-1" />
          <div>
            <p className="font-medium">Hostinger IMAP <Badge variant="outline" className="ml-2 text-xs">Avanzado</Badge></p>
            <p className="text-sm text-muted-foreground">Conexión directa IMAP al buzón de Hostinger. Requiere credenciales.</p>
          </div>
        </label>
      </RadioGroup>

      {/* Resend Inbound instructions */}
      {mode === "resend_inbound" && (
        <div className="p-4 rounded-lg bg-muted/50 text-sm space-y-2">
          <p className="font-medium">Configuración de Resend Inbound:</p>
          <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
            <li>En Resend Dashboard → Inbound, agrega un endpoint</li>
            <li>Usa un subdominio (ej: <code className="bg-background px-1 rounded text-xs">inbound.andromeda.legal</code>) para no afectar MX existentes</li>
            <li>Configura el webhook URL: <code className="bg-background px-1 rounded text-xs break-all">{import.meta.env.VITE_SUPABASE_URL}/functions/v1/system-email-inbound-webhook</code></li>
            <li>Configura una regla de forwarding en Hostinger para reenviar a la dirección del subdominio</li>
          </ol>
        </div>
      )}

      {/* IMAP fields */}
      {mode === "hostinger_imap" && (
        <div className="space-y-4 p-4 rounded-lg border">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Host IMAP</Label>
              <Input value={imapHost} onChange={e => setImapHost(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Usuario</Label>
              <Input value={imapUser} onChange={e => setImapUser(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Contraseña</Label>
            <Input type="password" value={imapPass} onChange={e => setImapPass(e.target.value)} placeholder="••••••••" />
            <p className="text-xs text-muted-foreground">Se almacenará de forma segura en Vault. No se guarda en frontend.</p>
          </div>
          <Button onClick={handleTestImap} disabled={imapTesting || !imapPass}>
            {imapTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Inbox className="h-4 w-4 mr-2" />}
            Probar Conexión IMAP
          </Button>

          {imapResult && (
            <div className={`p-3 rounded-lg ${imapResult.ok ? "bg-green-500/10" : "bg-destructive/10"}`}>
              <p className="text-sm">{imapResult.message}</p>
            </div>
          )}
        </div>
      )}

      <Button onClick={handleSaveMode} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
        Guardar Modo Inbound
      </Button>
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
          { done: setupState?.step_inbound_selected, label: "Modo inbound seleccionado" },
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
