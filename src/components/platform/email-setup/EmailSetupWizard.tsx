/**
 * EmailSetupWizard — 7-step Windows-3.1-style installer for Super Admin email configuration.
 * Steps:
 *   1) Outbound Provider (RESEND_API_KEY)
 *   2) Sender Identity (from_email, from_name)
 *   3) DNS & Deliverability (SPF, DKIM, DMARC checklist)
 *   4) Test Send (outbound pipeline verification)
 *   5) Webhook Secret (RESEND_INBOUND_WEBHOOK_SECRET)
 *   6) Inbound Domain (Resend receiving domain + webhook URL)
 *   7) Hostinger Forwarding & Verification (end-to-end inbound test)
 *   8) Activate (master switch)
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  CheckCircle, Circle, Loader2, Mail, Send, Shield, Inbox,
  Power, AlertTriangle, ChevronRight, ChevronLeft, Webhook, Copy,
  ExternalLink, MailCheck, RefreshCw, ShieldCheck, Globe, Key,
  ArrowDownToLine, MonitorCheck, FileCheck, Server,
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
  dns_spf_verified: boolean;
  dns_dkim_verified: boolean;
  dns_dmarc_verified: boolean;
}

const STEPS = [
  { key: "provider",   label: "API Key",           icon: Key,             shortLabel: "1. API" },
  { key: "identity",   label: "Identidad",         icon: Mail,            shortLabel: "2. From" },
  { key: "dns",        label: "DNS",               icon: Globe,           shortLabel: "3. DNS" },
  { key: "test",       label: "Test Envío",        icon: Send,            shortLabel: "4. Test" },
  { key: "secret",     label: "Webhook Secret",    icon: ShieldCheck,     shortLabel: "5. Secret" },
  { key: "inbound",    label: "Dominio Inbound",   icon: ArrowDownToLine, shortLabel: "6. Inbound" },
  { key: "forwarding", label: "Forwarding",        icon: RefreshCw,       shortLabel: "7. Forward" },
  { key: "activate",   label: "Activar",           icon: Power,           shortLabel: "8. ON" },
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
    .select("id, from_email, from_name, reply_to, outbound_provider, inbound_mode, is_enabled, dns_spf_verified, dns_dkim_verified, dns_dmarc_verified")
    .maybeSingle();
  if (error) throw error;
  return data;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  toast.success("Copiado al portapapeles");
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

  // Derive step completion from state
  const getCompletedSteps = useCallback((): boolean[] => {
    if (!setupState) return Array(8).fill(false);
    return [
      setupState.step_resend_key_ok,                         // 1: API Key
      setupState.step_from_identity_ok,                      // 2: Identity
      !!(settings?.dns_spf_verified || settings?.dns_dkim_verified), // 3: DNS (at least one)
      setupState.step_test_send_ok,                          // 4: Test Send
      setupState.step_inbound_selected,                      // 5: Webhook Secret set
      setupState.step_inbound_selected,                      // 6: Inbound domain (same flag)
      setupState.step_inbound_ok,                            // 7: Forwarding verified
      settings?.is_enabled ?? false,                         // 8: Activated
    ];
  }, [setupState, settings]);

  const completedSteps = getCompletedSteps();
  const completedCount = completedSteps.filter(Boolean).length;
  const progressPct = Math.round((completedCount / STEPS.length) * 100);

  // Auto-restore to first incomplete step
  useEffect(() => {
    if (setupState) {
      const cs = getCompletedSteps();
      const firstIncomplete = cs.findIndex((done) => !done);
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
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Server className="h-6 w-6 text-primary" />
          Email Setup Wizard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configura el sistema de email paso a paso — como instalar un programa en Windows 3.1.
        </p>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Progreso de instalación</span>
          <span>{completedCount}/{STEPS.length} pasos completados — {progressPct}%</span>
        </div>
        <Progress value={progressPct} className="h-2" />
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

      {/* Stepper — vertical list on mobile, horizontal on desktop */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const done = completedSteps[i];
          const active = i === activeStep;
          return (
            <button
              key={step.key}
              onClick={() => setActiveStep(i)}
              className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-xs transition-colors
                ${active ? "bg-primary text-primary-foreground ring-2 ring-primary/50" : done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              {done ? <CheckCircle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              <span className="hidden sm:inline text-[10px] leading-tight text-center">{step.label}</span>
              <span className="sm:hidden text-[10px]">{i + 1}</span>
            </button>
          );
        })}
      </div>

      {/* Step Content */}
      <Card className="border-2">
        <CardContent className="pt-6">
          <div className="mb-4 pb-3 border-b flex items-center gap-2">
            {(() => { const Icon = STEPS[activeStep].icon; return <Icon className="h-5 w-5 text-primary" />; })()}
            <h3 className="text-lg font-semibold">
              Paso {activeStep + 1}: {STEPS[activeStep].label}
            </h3>
            {completedSteps[activeStep] && (
              <Badge variant="default" className="ml-auto text-xs">✓ Completado</Badge>
            )}
          </div>

          {activeStep === 0 && <StepOutboundProvider setupState={setupState} queryClient={queryClient} />}
          {activeStep === 1 && <StepSenderIdentity settings={settings} queryClient={queryClient} />}
          {activeStep === 2 && <StepDNS settings={settings} queryClient={queryClient} />}
          {activeStep === 3 && <StepTestSend setupState={setupState} queryClient={queryClient} />}
          {activeStep === 4 && <StepWebhookSecret queryClient={queryClient} setupState={setupState} />}
          {activeStep === 5 && <StepInboundDomain />}
          {activeStep === 6 && <StepForwarding settings={settings} setupState={setupState} queryClient={queryClient} />}
          {activeStep === 7 && <StepActivate settings={settings} setupState={setupState} queryClient={queryClient} />}
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

// ═══════════════════════════════════════════════════════════
// Step 1: Outbound Provider (RESEND_API_KEY)
// ═══════════════════════════════════════════════════════════

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
      <p className="text-sm text-muted-foreground">
        Atenia usa <strong>Resend</strong> como proveedor de email. Necesitas una API Key para enviar correos.
      </p>

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
        <p className="font-medium">📋 Instrucciones:</p>
        <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
          <li>Crea una cuenta en <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">resend.com</a></li>
          <li>Genera una API Key en <strong>Dashboard → API Keys</strong></li>
          <li>Agrega <code className="text-xs bg-background px-1 rounded border">RESEND_API_KEY</code> a los secrets del backend</li>
          <li>Haz clic en <strong>"Verificar"</strong> abajo</li>
        </ol>
      </div>

      <Button onClick={checkResendKey} disabled={checking}>
        {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
        Verificar RESEND_API_KEY
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 2: Sender Identity
// ═══════════════════════════════════════════════════════════

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
      toast.success("Identidad guardada ✓");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configura el "From" que aparecerá en todos los emails enviados por la plataforma.
        El dominio debe estar verificado en Resend.
      </p>
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

      <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <span className="text-muted-foreground">
          Asegúrate de que <strong>{fromEmail}</strong> esté verificado como sender en Resend → Domains.
        </span>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
        Guardar Identidad
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 3: DNS & Deliverability
// ═══════════════════════════════════════════════════════════

function StepDNS({ settings, queryClient }: { settings: EmailSettings | null; queryClient: any }) {
  const [saving, setSaving] = useState(false);

  const dnsItems = [
    { key: "spf", label: "SPF", verified: settings?.dns_spf_verified ?? false, hint: "Registro TXT que autoriza a Resend a enviar desde tu dominio." },
    { key: "dkim", label: "DKIM", verified: settings?.dns_dkim_verified ?? false, hint: "Firma criptográfica que valida la autenticidad del email." },
    { key: "dmarc", label: "DMARC", verified: settings?.dns_dmarc_verified ?? false, hint: "Política que indica qué hacer con emails no autenticados." },
  ];

  const toggleDns = async (key: string, value: boolean) => {
    setSaving(true);
    try {
      if (!settings?.id) throw new Error("No settings");
      const updateField: Record<string, boolean> = {};
      updateField[`dns_${key}_verified`] = value;
      await (supabase.from("system_email_settings") as any)
        .update(updateField)
        .eq("id", settings.id);
      queryClient.invalidateQueries({ queryKey: ["system-email-settings-wizard"] });
      toast.success(`${key.toUpperCase()} ${value ? "marcado ✓" : "desmarcado"}`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Para que tus emails no caigan en spam, verifica que los registros DNS estén configurados en tu proveedor de dominio (Hostinger).
        Resend te muestra los registros exactos en <strong>Domains → tu dominio</strong>.
      </p>

      <div className="space-y-3">
        {dnsItems.map((item) => (
          <div key={item.key} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3">
              {item.verified
                ? <CheckCircle className="h-5 w-5 text-primary" />
                : <Circle className="h-5 w-5 text-muted-foreground" />}
              <div>
                <p className="font-medium text-sm">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.hint}</p>
              </div>
            </div>
            <Switch
              checked={item.verified}
              onCheckedChange={(v) => toggleDns(item.key, v)}
              disabled={saving}
            />
          </div>
        ))}
      </div>

      <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
        <p className="font-medium">📋 Cómo verificar:</p>
        <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
          <li>Ve a <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">Resend → Domains <ExternalLink className="h-3 w-3" /></a></li>
          <li>Selecciona <strong>andromeda.legal</strong></li>
          <li>Copia cada registro DNS y agrégalo en <a href="https://hpanel.hostinger.com" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">Hostinger DNS <ExternalLink className="h-3 w-3" /></a></li>
          <li>Espera la propagación (hasta 48h, usualmente minutos) y marca cada uno aquí</li>
        </ol>
      </div>

      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <FileCheck className="h-3 w-3" />
        Puedes avanzar sin completar todos, pero SPF + DKIM son muy recomendados para deliverability.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 4: Test Send
// ═══════════════════════════════════════════════════════════

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
      <p className="text-sm text-muted-foreground">
        Envía un email de prueba real a tu cuenta de Super Admin. Esto verifica que la API Key y la identidad funcionan.
      </p>

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

      {setupState?.step_test_send_ok && (
        <div className="p-3 rounded-lg border border-primary/30 bg-primary/10 flex items-center gap-2 text-sm">
          <CheckCircle className="h-4 w-4 text-primary" />
          Pipeline outbound verificado. El siguiente paso configura la recepción de emails.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 5: Webhook Secret (RESEND_INBOUND_WEBHOOK_SECRET)
// ═══════════════════════════════════════════════════════════

function StepWebhookSecret({ queryClient, setupState }: { queryClient: any; setupState: SetupState | null }) {
  const [checking, setChecking] = useState(false);
  const [secretStatus, setSecretStatus] = useState<{ hasSecret: boolean; hasRecentEvent: boolean } | null>(null);

  const checkSecret = async () => {
    setChecking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No autenticado");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/system-email-inbound-status`,
        { method: "GET", headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const data = await res.json();

      if (data?.ok) {
        setSecretStatus({ hasSecret: data.hasSecret, hasRecentEvent: data.hasRecentEvent });

        if (data.hasSecret) {
          await (supabase.from("system_email_setup_state") as any)
            .update({ step_inbound_selected: true, last_error_code: null, last_error_message: null })
            .eq("id", SETUP_STATE_ID);
          queryClient.invalidateQueries({ queryKey: ["email-setup-state"] });
          toast.success("RESEND_INBOUND_WEBHOOK_SECRET detectado ✓");
        } else {
          toast.error("Secret no encontrado — agrégalo a los secrets del backend");
        }
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setChecking(false);
    }
  };

  // Auto-check on mount
  useEffect(() => {
    checkSecret();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        El webhook de inbound necesita un <strong>Signing Secret</strong> para verificar que las solicitudes vienen de Resend
        y no de un atacante. Sin este secret, <strong>todos los emails inbound serán rechazados</strong>.
      </p>

      {/* Status Banner */}
      {secretStatus && (
        <div className={`p-4 rounded-lg border ${secretStatus.hasSecret
          ? "bg-primary/10 border-primary/30"
          : "bg-destructive/5 border-destructive/30"
        }`}>
          <div className="flex items-center gap-2">
            {secretStatus.hasSecret
              ? <CheckCircle className="h-5 w-5 text-primary" />
              : <AlertTriangle className="h-5 w-5 text-destructive" />}
            <span className="text-sm font-medium">
              {secretStatus.hasSecret ? "Secret configurado ✓" : "⚠️ Secret no configurado"}
            </span>
          </div>
          {!secretStatus.hasSecret && (
            <p className="text-sm text-muted-foreground mt-1">
              El webhook rechazará con <code className="text-xs bg-background px-1 rounded border">WEBHOOK_SECRET_MISSING</code> (500) o error de firma (401).
            </p>
          )}
        </div>
      )}

      {/* Instructions */}
      <div className="p-4 rounded-lg bg-muted/50 text-sm space-y-2">
        <p className="font-medium">📋 Instrucciones:</p>
        <ol className="list-decimal pl-4 space-y-2 text-muted-foreground">
          <li>
            Ve a <a href="https://resend.com/webhooks" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">Resend → Webhooks <ExternalLink className="h-3 w-3" /></a>
          </li>
          <li>Abre el webhook que creaste → copia el <strong>"Signing Secret"</strong></li>
          <li>
            Agrega este secret al backend con el nombre:
            <div className="flex items-center gap-2 mt-1">
              <code className="bg-background px-2 py-1 rounded text-xs border font-mono">RESEND_INBOUND_WEBHOOK_SECRET</code>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard("RESEND_INBOUND_WEBHOOK_SECRET")} className="shrink-0 h-7 w-7 p-0">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
          <li>Haz clic en <strong>"Verificar Secret"</strong> abajo</li>
        </ol>
      </div>

      {/* Diagnostics */}
      <Accordion type="single" collapsible>
        <AccordionItem value="diagnostics">
          <AccordionTrigger className="text-sm">
            <span className="flex items-center gap-2">
              <MonitorCheck className="h-4 w-4" /> Diagnóstico rápido
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2 text-sm text-muted-foreground pt-2">
              <div className="grid gap-2">
                <div className="flex items-start gap-2 p-2 rounded border bg-muted/30">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Error 500: WEBHOOK_SECRET_MISSING</p>
                    <p className="text-xs">El secret no existe en los secrets del backend. Agrégalo y redespliega.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded border bg-muted/30">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Error 401: Invalid signature</p>
                    <p className="text-xs">El secret existe pero el valor no coincide con Resend. Re-copia el valor exacto.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 rounded border bg-muted/30">
                  <CheckCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">200 OK pero inbox vacío</p>
                    <p className="text-xs">La firma es válida pero hay un error al insertar en la BD. Revisa los logs del backend.</p>
                  </div>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Button onClick={checkSecret} disabled={checking}>
        {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
        Verificar Secret
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 6: Inbound Domain (Resend Receiving + Webhook URL)
// ═══════════════════════════════════════════════════════════

function StepInboundDomain() {
  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/system-email-inbound-webhook`;
  const INBOUND_SUBDOMAIN = "inbound.andromeda.legal";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Resend solo puede recibir emails en un dominio/subdominio que tú configures en su panel.
        <strong> El webhook por sí solo no basta</strong> — Resend necesita registros MX para saber que debe aceptar correo.
      </p>

      {/* Key values */}
      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
        <p className="text-sm font-medium">Valores de configuración:</p>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2 p-2 rounded bg-background border">
            <div>
              <span className="text-xs text-muted-foreground block">Subdominio Inbound</span>
              <code className="text-sm font-mono font-semibold text-primary">{INBOUND_SUBDOMAIN}</code>
            </div>
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(INBOUND_SUBDOMAIN)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 p-2 rounded bg-background border">
            <div>
              <span className="text-xs text-muted-foreground block">Webhook URL</span>
              <code className="text-xs font-mono break-all">{webhookUrl}</code>
            </div>
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(webhookUrl)} className="shrink-0">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Step-by-step */}
      <div className="p-4 rounded-lg bg-muted/50 text-sm space-y-2">
        <p className="font-medium">📋 Instrucciones:</p>
        <ol className="list-decimal pl-4 space-y-2 text-muted-foreground">
          <li>
            Ve a <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">Resend → Domains <ExternalLink className="h-3 w-3" /></a>
          </li>
          <li>
            Agrega el subdominio <code className="text-xs bg-background px-1 rounded border">{INBOUND_SUBDOMAIN}</code> como dominio de <strong>Receiving/Inbound</strong>
          </li>
          <li>
            Resend mostrará registros DNS (MX + posiblemente TXT). Agrégalos en{" "}
            <a href="https://hpanel.hostinger.com" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">Hostinger DNS <ExternalLink className="h-3 w-3" /></a>
          </li>
          <li>Espera que Resend verifique el subdominio (usualmente minutos, máx 48h)</li>
          <li>
            Configura el webhook en <strong>Resend → Webhooks</strong>:
            <ul className="list-disc pl-4 mt-1 space-y-1">
              <li>URL: la de arriba</li>
              <li>Evento: <code className="text-xs bg-background px-1 rounded border">email.received</code></li>
            </ul>
          </li>
        </ol>
      </div>

      <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <span className="text-muted-foreground">
          <strong>¿No hay intentos de webhook?</strong> Resend no está recibiendo mail → los DNS de inbound no están configurados
          o aún no han propagado.
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 7: Hostinger Forwarding & Verification
// ═══════════════════════════════════════════════════════════

function StepForwarding({ settings, setupState, queryClient }: { settings: EmailSettings | null; setupState: SetupState | null; queryClient: any }) {
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
  const [saving, setSaving] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const SOURCE_EMAIL = "info@andromeda.legal";
  const FORWARD_TO = "info@inbound.andromeda.legal";

  // ── Send test email ────────────────────────────────
  const handleSendTest = async () => {
    setSendingTest(true);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const { data, error } = await supabase.functions.invoke("system-email-send", {
        body: {
          to: [SOURCE_EMAIL],
          subject: `ATENIA Forwarding Test — ${timestamp}`,
          text: `Test de forwarding Hostinger.\nTimestamp: ${timestamp}\nSi este email aparece en ATENIA, el forwarding funciona.`,
          html: `<p>Test de forwarding Hostinger.</p><p><strong>Timestamp:</strong> ${timestamp}</p><p>Si este email aparece en ATENIA, el forwarding funciona.</p>`,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error_message || "Error al enviar");
      setTestSent(true);
      toast.success(`Test enviado a ${SOURCE_EMAIL}. Espera 1-5 min y verifica.`);
    } catch (err: any) {
      toast.error(err.message || "Error al enviar test");
    } finally {
      setSendingTest(false);
    }
  };

  // ── Verify forwarding ─────────────────────────────
  const handleVerifyForwarding = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No autenticado");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/system-email-forwarding-status?since_minutes=30&subject_contains=ATENIA%20Forwarding%20Test`,
        { method: "GET", headers: { Authorization: `Bearer ${session.access_token}` } }
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
        toast.success("¡Forwarding verificado! El inbound funciona.");
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
      <p className="text-sm text-muted-foreground">
        El buzón real vive en Hostinger (<strong>{SOURCE_EMAIL}</strong>). Para que ATENIA muestre esos emails,
        configura un reenvío (copy) hacia el subdominio de Resend Inbound.
      </p>

      {/* Copy values */}
      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
        <p className="text-sm font-medium">Configuración del reenviador:</p>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2 p-2 rounded bg-background border">
            <div>
              <span className="text-xs text-muted-foreground block">Desde (Forward FROM)</span>
              <code className="text-sm font-mono">{SOURCE_EMAIL}</code>
            </div>
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(SOURCE_EMAIL)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 p-2 rounded bg-background border">
            <div>
              <span className="text-xs text-muted-foreground block">Hacia (Forward TO)</span>
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

      {/* Hostinger instructions */}
      <div className="p-4 rounded-lg bg-muted/50 text-sm space-y-2">
        <p className="font-medium">📋 Instrucciones en Hostinger:</p>
        <ol className="list-decimal pl-4 space-y-2 text-muted-foreground">
          <li>
            Ingresa a <a href="https://hpanel.hostinger.com" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">hpanel.hostinger.com <ExternalLink className="h-3 w-3" /></a>
          </li>
          <li>Ve a <strong>Emails → Administrar</strong> → <code className="text-xs bg-background px-1 rounded border">andromeda.legal</code></li>
          <li>Busca <strong>"Reenviadores"</strong> o <strong>"Email Forwarding"</strong></li>
          <li>Crea un nuevo reenviador con los valores de arriba</li>
          <li>Guarda y confirma que quede <strong>activo</strong></li>
        </ol>
      </div>

      {/* Verification flow */}
      <div className="space-y-3 pt-2 border-t">
        <p className="text-sm font-medium">🧪 Verificación end-to-end:</p>
        <div className="p-3 rounded-lg bg-muted/30 border text-sm space-y-2">
          <p className="text-muted-foreground">
            <strong>A)</strong> Clic en "Enviar Test" → envía email a <code className="text-xs">{SOURCE_EMAIL}</code><br />
            <strong>B)</strong> Hostinger lo reenvía a <code className="text-xs">{FORWARD_TO}</code><br />
            <strong>C)</strong> Resend lo recibe → dispara webhook → ATENIA lo almacena<br />
            <strong>D)</strong> Clic en "Verificar Forwarding" → busca el email en la BD
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSendTest} disabled={sendingTest} variant="outline">
            {sendingTest ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            {testSent ? "Re-enviar test" : "A) Enviar Test Email"}
          </Button>
          <Button onClick={handleVerifyForwarding} disabled={verifying}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            D) Verificar Forwarding
          </Button>
        </div>

        {testSent && !verifyResult && (
          <div className="p-3 rounded-lg border bg-muted/30 text-sm flex items-center gap-2">
            <MailCheck className="h-4 w-4 text-primary" />
            Test enviado. Espera 1-5 minutos y haz clic en <strong>"Verificar Forwarding"</strong>.
          </div>
        )}
      </div>

      {/* Verify result */}
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

      {/* Troubleshooting */}
      {verifyResult && !verifyResult.ok && (
        <Accordion type="single" collapsible defaultValue="troubleshoot">
          <AccordionItem value="troubleshoot">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Solución de problemas
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-2 text-sm text-muted-foreground pt-2">
                <li className="flex items-start gap-2">
                  <Circle className="h-3 w-3 mt-1 shrink-0" />
                  <span><strong>Sin intentos de webhook en Resend:</strong> Resend no está recibiendo mail → verifica DNS del subdominio inbound (Paso 6).</span>
                </li>
                <li className="flex items-start gap-2">
                  <Circle className="h-3 w-3 mt-1 shrink-0" />
                  <span><strong>Webhook responde WEBHOOK_SECRET_MISSING:</strong> El secret no está en los secrets del backend (Paso 5).</span>
                </li>
                <li className="flex items-start gap-2">
                  <Circle className="h-3 w-3 mt-1 shrink-0" />
                  <span><strong>Webhook responde 401:</strong> El secret no coincide. Re-copia el valor exacto desde Resend.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Circle className="h-3 w-3 mt-1 shrink-0" />
                  <span><strong>200 OK pero inbox vacío:</strong> El webhook funciona pero el insert falla. Revisa logs del backend.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Circle className="h-3 w-3 mt-1 shrink-0" />
                  <span><strong>Reenvío demora:</strong> Hostinger puede tardar 2-5 min. Espera y reintenta.</span>
                </li>
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Manual override */}
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
                  Tu bandeja puede permanecer vacía si el forwarding no está funcionando.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value.toUpperCase())}
                  placeholder='Escribe "FORWARDED" para confirmar'
                  className="max-w-xs text-sm"
                />
                <Button size="sm" variant="destructive" disabled={confirmText !== "FORWARDED" || saving} onClick={handleManualOverride}>
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

      {/* Completed */}
      {setupState?.step_inbound_ok && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/10">
          <CheckCircle className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Forwarding inbound configurado y verificado ✓</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 8: Activate
// ═══════════════════════════════════════════════════════════

function StepActivate({ settings, setupState, queryClient }: { settings: EmailSettings | null; setupState: SetupState | null; queryClient: any }) {
  const [enabling, setEnabling] = useState(false);

  const coreStepsDone = setupState?.step_resend_key_ok && setupState?.step_from_identity_ok && setupState?.step_test_send_ok;

  const checklist = [
    { done: setupState?.step_resend_key_ok, label: "RESEND_API_KEY configurada", step: 1 },
    { done: setupState?.step_from_identity_ok, label: "Identidad del remitente guardada", step: 2 },
    { done: !!(settings?.dns_spf_verified || settings?.dns_dkim_verified), label: "DNS verificado (SPF/DKIM)", step: 3 },
    { done: setupState?.step_test_send_ok, label: "Test de envío exitoso", step: 4 },
    { done: setupState?.step_inbound_selected, label: "Webhook secret configurado", step: 5 },
    { done: setupState?.step_inbound_ok, label: "Forwarding inbound verificado", step: 7 },
  ];

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
      <p className="text-sm text-muted-foreground">
        Habilita el sistema de email. Compose, alertas y notificaciones usarán esta configuración.
      </p>

      {/* Checklist Summary */}
      <div className="space-y-2">
        {checklist.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            {item.done
              ? <CheckCircle className="h-4 w-4 text-primary" />
              : <Circle className="h-4 w-4 text-muted-foreground" />}
            <span className={item.done ? "text-foreground" : "text-muted-foreground"}>
              {item.label}
            </span>
            {!item.done && (
              <span className="text-xs text-muted-foreground ml-auto">Paso {item.step}</span>
            )}
          </div>
        ))}
      </div>

      {/* Master switch */}
      <div className="flex items-center gap-4 p-4 rounded-lg border">
        <Switch
          checked={settings?.is_enabled ?? false}
          onCheckedChange={toggleEnabled}
          disabled={enabling || !coreStepsDone}
        />
        <div>
          <p className="font-medium">{settings?.is_enabled ? "✅ Email Activo" : "Email Desactivado"}</p>
          {!coreStepsDone && (
            <p className="text-xs text-muted-foreground">Completa los pasos 1-4 como mínimo para poder activar.</p>
          )}
        </div>
        {enabling && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>

      {settings?.is_enabled && (
        <div className="p-3 rounded-lg border border-primary/30 bg-primary/10 flex items-center gap-2 text-sm">
          <CheckCircle className="h-5 w-5 text-primary" />
          <span>
            🎉 <strong>¡Instalación completa!</strong> El sistema de email está operativo.
            {setupState?.step_inbound_ok
              ? " Envío y recepción funcionando."
              : " Envío activo. La recepción (inbound) requiere completar los pasos 5-7."}
          </span>
        </div>
      )}
    </div>
  );
}
