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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  CheckCircle, Circle, Loader2, Mail, Send, Shield, Inbox,
  Power, AlertTriangle, ChevronRight, ChevronLeft, Webhook, Copy,
  ExternalLink, MailCheck, RefreshCw, ShieldCheck,
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
  { key: "inbound", label: "Forwarding Inbound", icon: Inbox },
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
  const [sendingTest, setSendingTest] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    hint: string;
    lastInboundAt?: string;
    matchedMessageId?: string;
    matchedSubject?: string;
  } | null>(null);
  const [secretStatus, setSecretStatus] = useState<{ hasSecret: boolean } | null>(null);
  const [manualOverride, setManualOverride] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/system-email-inbound-webhook`;
  const SOURCE_EMAIL = "info@andromeda.legal";
  const FORWARD_TO = "info@inbound.andromeda.legal";

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  // ── Check secret status on mount ───────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("system-email-inbound-status", { method: "GET" });
        if (data?.ok) setSecretStatus({ hasSecret: data.hasSecret });
      } catch { /* silent */ }
    })();
  }, []);

  // ── Send test email to trigger forwarding ──────────
  const handleSendTest = async () => {
    setSendingTest(true);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const { data, error } = await supabase.functions.invoke("system-email-send", {
        body: {
          to: [SOURCE_EMAIL],
          subject: `ATENIA Forwarding Test — ${timestamp}`,
          text: `Este es un email de prueba para verificar el forwarding de Hostinger.\n\nTimestamp: ${timestamp}\n\nSi recibes este email en la bandeja de ATENIA, el forwarding funciona correctamente.`,
          html: `<p>Este es un email de prueba para verificar el forwarding de Hostinger.</p><p><strong>Timestamp:</strong> ${timestamp}</p><p>Si recibes este email en la bandeja de ATENIA, el forwarding funciona correctamente.</p>`,
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error_message || "Error al enviar");

      setTestSent(true);
      toast.success(`Test enviado a ${SOURCE_EMAIL}. Espera 1-5 min y haz clic en "Verificar Forwarding".`);
    } catch (err: any) {
      toast.error(err.message || "Error al enviar test");
    } finally {
      setSendingTest(false);
    }
  };

  // ── Verify forwarding via edge function ────────────
  const handleVerifyForwarding = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("system-email-forwarding-status", {
        method: "GET",
        body: null,
        headers: {},
      });

      // The function is GET but invoke sends POST by default; use query params approach
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No autenticado");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/system-email-forwarding-status?since_minutes=30&subject_contains=ATENIA%20Forwarding%20Test`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );
      const result = await res.json();

      setVerifyResult(result);

      if (result.ok) {
        await (supabase.from("system_email_setup_state") as any)
          .update({ step_inbound_ok: true, step_inbound_selected: true, last_error_code: null, last_error_message: null })
          .eq("id", SETUP_STATE_ID);

        await (supabase.from("system_email_settings") as any)
          .update({ inbound_mode: "resend_inbound" })
          .eq("id", settings?.id);

        queryClient.invalidateQueries({ queryKey: ["email-setup-state"] });
        queryClient.invalidateQueries({ queryKey: ["system-email-settings-wizard"] });
        toast.success("¡Forwarding verificado! El inbound funciona correctamente.");
      }
    } catch (err: any) {
      setVerifyResult({ ok: false, hint: err.message || "Error de verificación" });
    } finally {
      setVerifying(false);
    }
  };

  // ── Manual override ────────────────────────────────
  const handleManualOverride = async () => {
    if (confirmText !== "FORWARDED") return;
    setSaving(true);
    try {
      await (supabase.from("system_email_setup_state") as any)
        .update({ step_inbound_ok: true, step_inbound_selected: true })
        .eq("id", SETUP_STATE_ID);

      await (supabase.from("system_email_settings") as any)
        .update({ inbound_mode: "resend_inbound" })
        .eq("id", settings?.id);

      queryClient.invalidateQueries({ queryKey: ["email-setup-state"] });
      queryClient.invalidateQueries({ queryKey: ["system-email-settings-wizard"] });
      toast.success("Paso marcado como completado (sin verificación)");
      setManualOverride(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold">Reenvío de Hostinger → Resend Inbound</h3>
        <p className="text-sm text-muted-foreground">
          Hostinger aloja el buzón real de <strong>{SOURCE_EMAIL}</strong>. Para que los emails 
          aparezcan en la bandeja de ATENIA, necesitas que Hostinger reenvíe una copia al subdominio 
          de Resend Inbound. Esto no modifica los registros MX de tu dominio.
        </p>
      </div>

      {/* ── Why this step ── */}
      <div className="p-4 rounded-lg border bg-muted/30 text-sm space-y-1">
        <p className="font-medium flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" /> ¿Por qué es necesario?
        </p>
        <ul className="list-disc pl-5 text-muted-foreground space-y-1">
          <li>Hostinger es el servidor de correo real — no lo cambiamos.</li>
          <li>Resend Inbound solo puede recibir email en el subdominio <code className="text-xs bg-background px-1 rounded border">inbound.andromeda.legal</code>.</li>
          <li>El forwarding permite que ATENIA muestre emails recibidos sin migrar hosting de correo.</li>
        </ul>
      </div>

      {/* ── Copy Card: Exact values ── */}
      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
        <p className="text-sm font-medium">Valores de configuración:</p>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2 p-2 rounded bg-background border">
            <div>
              <span className="text-xs text-muted-foreground block">Buzón origen</span>
              <code className="text-sm font-mono">{SOURCE_EMAIL}</code>
            </div>
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(SOURCE_EMAIL)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 p-2 rounded bg-background border">
            <div>
              <span className="text-xs text-muted-foreground block">Reenviar a (Forward-To)</span>
              <code className="text-sm font-mono font-semibold text-primary">{FORWARD_TO}</code>
            </div>
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(FORWARD_TO)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Reenviar una <strong>copia</strong> — no eliminar el original.
        </p>
      </div>

      {/* ── Step-by-step Hostinger instructions ── */}
      <div className="p-4 rounded-lg bg-muted/50 text-sm space-y-3">
        <p className="font-medium">Instrucciones paso a paso en Hostinger:</p>
        <ol className="list-decimal pl-4 space-y-2 text-muted-foreground">
          <li className="flex items-start gap-1">
            <span>Ingresa a <a href="https://hpanel.hostinger.com" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">hpanel.hostinger.com <ExternalLink className="h-3 w-3" /></a></span>
          </li>
          <li>Ve a <strong>Emails → Administrar</strong> para el dominio <code className="text-xs bg-background px-1 rounded border">andromeda.legal</code></li>
          <li>Busca la sección <strong>"Reenviadores"</strong> o <strong>"Email Forwarding"</strong> (el nombre puede variar)</li>
          <li>
            Crea un nuevo reenviador:
            <div className="mt-1 pl-2 border-l-2 border-primary/30 space-y-1">
              <p><strong>Desde:</strong> <code className="text-xs bg-background px-1 rounded border">{SOURCE_EMAIL}</code></p>
              <p><strong>Hacia:</strong> <code className="text-xs bg-background px-1 rounded border">{FORWARD_TO}</code></p>
            </div>
          </li>
          <li>Guarda la configuración y confirma que el reenviador queda <strong>activo</strong></li>
        </ol>
      </div>

      {/* ── Resend Webhook Config (collapsed) ── */}
      <Accordion type="single" collapsible>
        <AccordionItem value="resend-config">
          <AccordionTrigger className="text-sm">
            <span className="flex items-center gap-2">
              <Webhook className="h-4 w-4" /> Configuración de Resend Inbound Webhook
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 text-sm text-muted-foreground pt-2">
              <ol className="list-decimal pl-4 space-y-2">
                <li>
                  Ve a <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="text-primary underline">resend.com → Domains</a> → tu dominio → <strong>Inbound</strong>
                </li>
                <li>
                  Webhook URL:
                  <div className="flex items-center gap-2 mt-1">
                    <code className="bg-background px-2 py-1 rounded text-xs break-all flex-1 border">{webhookUrl}</code>
                    <Button variant="ghost" size="sm" onClick={() => copyToClipboard(webhookUrl)} className="shrink-0"><Copy className="h-3.5 w-3.5" /></Button>
                  </div>
                </li>
                <li>Evento: <code className="text-xs bg-background px-1 rounded border">email.received</code></li>
                <li>
                  Webhook Signing Secret → guárdalo como:
                  <div className="flex items-center gap-2 mt-1">
                    <code className="bg-background px-2 py-1 rounded text-xs border">RESEND_INBOUND_WEBHOOK_SECRET</code>
                    <Button variant="ghost" size="sm" onClick={() => copyToClipboard("RESEND_INBOUND_WEBHOOK_SECRET")} className="shrink-0"><Copy className="h-3.5 w-3.5" /></Button>
                  </div>
                </li>
              </ol>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Troubleshooting ── */}
        <AccordionItem value="troubleshooting">
          <AccordionTrigger className="text-sm">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Solución de problemas
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <ul className="space-y-2 text-sm text-muted-foreground pt-2">
              <li className="flex items-start gap-2">
                <Circle className="h-3 w-3 mt-1 shrink-0" />
                <span><strong>Hostinger pide verificar destino:</strong> Confirma que <code className="text-xs">{FORWARD_TO}</code> puede recibir email (Resend Inbound configurado con los MX del subdominio).</span>
              </li>
              <li className="flex items-start gap-2">
                <Circle className="h-3 w-3 mt-1 shrink-0" />
                <span><strong>Reenvío demora:</strong> Algunos forwarders tienen retraso de 2-5 minutos. Espera y vuelve a verificar.</span>
              </li>
              <li className="flex items-start gap-2">
                <Circle className="h-3 w-3 mt-1 shrink-0" />
                <span><strong>Emails en loop:</strong> Asegúrate de que el subdominio inbound NO reenvíe de vuelta al buzón principal.</span>
              </li>
              <li className="flex items-start gap-2">
                <Circle className="h-3 w-3 mt-1 shrink-0" />
                <span><strong>Webhook rechaza (401):</strong> El secret <code className="text-xs">RESEND_INBOUND_WEBHOOK_SECRET</code> no coincide. Re-copia el valor desde Resend.</span>
              </li>
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* ── Secret check banner ── */}
      {secretStatus && !secretStatus.hasSecret && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <ShieldCheck className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">Secret de webhook faltante</p>
            <p className="text-sm text-muted-foreground">
              <code className="text-xs">RESEND_INBOUND_WEBHOOK_SECRET</code> no está configurado. 
              El webhook rechazará todos los eventos hasta que lo agregues.
            </p>
          </div>
        </div>
      )}

      {/* ── Verification Buttons ── */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Verificación:</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSendTest} disabled={sendingTest} variant="outline">
            {sendingTest ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            {testSent ? "Re-enviar test" : "Enviar Test Email"}
          </Button>
          <Button onClick={handleVerifyForwarding} disabled={verifying}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Verificar Forwarding
          </Button>
        </div>

        {testSent && !verifyResult && (
          <div className="p-3 rounded-lg border bg-muted/30 text-sm">
            <p className="flex items-center gap-2">
              <MailCheck className="h-4 w-4 text-primary" />
              Test enviado a <strong>{SOURCE_EMAIL}</strong>. Espera 1-5 minutos para que Hostinger reenvíe, luego haz clic en <strong>"Verificar Forwarding"</strong>.
            </p>
          </div>
        )}
      </div>

      {/* ── Verify result ── */}
      {verifyResult && (
        <div className={`p-4 rounded-lg border ${verifyResult.ok ? "bg-primary/10 border-primary/30" : "bg-destructive/5 border-destructive/30"}`}>
          <div className="flex items-center gap-2">
            {verifyResult.ok ? <CheckCircle className="h-5 w-5 text-primary" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}
            <span className="text-sm font-medium">{verifyResult.ok ? "¡Forwarding verificado!" : "No detectado aún"}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{verifyResult.hint}</p>
          {verifyResult.matchedSubject && (
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              Asunto: {verifyResult.matchedSubject} — Recibido: {new Date(verifyResult.lastInboundAt!).toLocaleString("es-CO")}
            </p>
          )}
        </div>
      )}

      {/* ── Manual override ── */}
      {!setupState?.step_inbound_ok && (
        <div className="pt-2 border-t">
          {!manualOverride ? (
            <button
              onClick={() => setManualOverride(true)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Ya lo configuré manualmente — marcar como hecho
            </button>
          ) : (
            <div className="space-y-2">
              <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm">
                <p className="text-destructive font-medium text-xs">⚠️ Bypass de verificación</p>
                <p className="text-muted-foreground text-xs mt-1">
                  Esto salta la verificación automática. Tu bandeja de entrada puede permanecer vacía si el forwarding no está funcionando.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value.toUpperCase())}
                  placeholder='Escribe "FORWARDED" para confirmar'
                  className="max-w-xs text-sm"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={confirmText !== "FORWARDED" || saving}
                  onClick={handleManualOverride}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Confirmar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setManualOverride(false); setConfirmText(""); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step completed badge */}
      {setupState?.step_inbound_ok && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/10">
          <CheckCircle className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Forwarding inbound configurado y verificado</span>
        </div>
      )}
    </div>
  );
}

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
