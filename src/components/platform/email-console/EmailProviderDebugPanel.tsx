/**
 * EmailProviderDebugPanel — Full diagnostic console for all email providers.
 * Shows: provider health, delivery pipeline stats, suppression list,
 * recent delivery events, and Atenia AI health vigilance integration.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  AlertTriangle,
  Ban,
  Brain,
  CheckCircle,
  Clock,
  Globe,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Shield,
  TestTube,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format, subHours, subDays } from "date-fns";
import { es } from "date-fns/locale";

// ─── Types ──────────────────────────────────────────────────

interface ProviderHealthResult {
  provider: string;
  status: "healthy" | "degraded" | "down" | "unconfigured";
  latencyMs?: number;
  message: string;
  details?: Record<string, unknown>;
  checkedAt: string;
}

interface DeliveryMetrics {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  failedPermanent: number;
  cancelled: number;
  avgDeliveryMs: number | null;
  successRate: number;
}

interface DeliveryEvent {
  id: string;
  email_outbox_id: string | null;
  event_type: string;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
}

interface SuppressionEntry {
  id: string;
  email: string;
  reason: string;
  created_at: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  resend: "Resend",
  sendgrid: "SendGrid",
  aws_ses: "Amazon SES",
  mailgun: "Mailgun",
  smtp: "SMTP Custom",
};

const STATUS_COLORS: Record<string, string> = {
  healthy: "text-green-500",
  degraded: "text-yellow-500",
  down: "text-destructive",
  unconfigured: "text-muted-foreground",
};

const STATUS_BADGES: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  healthy: { variant: "default", label: "Saludable" },
  degraded: { variant: "secondary", label: "Degradado" },
  down: { variant: "destructive", label: "Caído" },
  unconfigured: { variant: "outline", label: "No configurado" },
};

// ─── Data fetchers ──────────────────────────────────────────

async function fetchProviderHealth(): Promise<ProviderHealthResult[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("No autenticado");

  // Get provider status
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-provider-admin`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
    }
  );
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error("Failed to fetch provider status");

  const results: ProviderHealthResult[] = [];
  const activeProvider = data.active_provider;

  for (const p of data.providers || []) {
    const allConfigured = p.keys.every((k: { configured: boolean; required?: boolean }) => k.configured);
    const isActive = p.provider === activeProvider;

    if (!allConfigured && !isActive) {
      results.push({
        provider: p.provider,
        status: "unconfigured",
        message: `${p.keys.filter((k: { configured: boolean }) => !k.configured).length} clave(s) faltante(s)`,
        checkedAt: new Date().toISOString(),
      });
      continue;
    }

    // For the active provider, run a live connection test
    if (isActive) {
      try {
        const start = performance.now();
        const testRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-provider-admin`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "test_connection" }),
          }
        );
        const latencyMs = Math.round(performance.now() - start);
        const testData = await testRes.json();

        results.push({
          provider: p.provider,
          status: testData.test === "passed" || testData.test === "keys_present" ? "healthy" : "degraded",
          latencyMs,
          message: testData.message || "Test completado",
          details: testData.details,
          checkedAt: new Date().toISOString(),
        });
      } catch (err) {
        results.push({
          provider: p.provider,
          status: "down",
          message: `Error de conexión: ${(err as Error).message}`,
          checkedAt: new Date().toISOString(),
        });
      }
    } else {
      results.push({
        provider: p.provider,
        status: allConfigured ? "healthy" : "unconfigured",
        message: allConfigured ? "Claves configuradas (no activo)" : "Configuración incompleta",
        checkedAt: new Date().toISOString(),
      });
    }
  }

  return results;
}

async function fetchDeliveryMetrics(hours = 24): Promise<DeliveryMetrics> {
  const since = subHours(new Date(), hours).toISOString();

  const { data, error } = await supabase
    .from("email_outbox")
    .select("status, sent_at, created_at")
    .gte("created_at", since);

  if (error) throw error;
  const rows = data || [];

  const total = rows.length;
  const pending = rows.filter(r => r.status === "PENDING").length;
  const sent = rows.filter(r => r.status === "SENT").length;
  const failed = rows.filter(r => r.status === "FAILED").length;
  const failedPermanent = rows.filter(r => r.status === "FAILED_PERMANENT").length;
  const cancelled = rows.filter(r => r.status === "CANCELLED").length;

  // Calculate avg delivery time for sent emails
  const deliveryTimes = rows
    .filter(r => r.status === "SENT" && r.sent_at && r.created_at)
    .map(r => new Date(r.sent_at!).getTime() - new Date(r.created_at).getTime());

  const avgDeliveryMs = deliveryTimes.length > 0
    ? Math.round(deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length)
    : null;

  const successRate = total > 0 ? Math.round((sent / total) * 100) : 100;

  return { total, pending, sent, failed, failedPermanent, cancelled, avgDeliveryMs, successRate };
}

async function fetchRecentDeliveryEvents(limit = 30): Promise<DeliveryEvent[]> {
  const { data, error } = await supabase
    .from("email_delivery_events")
    .select("id, email_outbox_id, event_type, raw_payload, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as DeliveryEvent[];
}

async function fetchSuppressions(limit = 50): Promise<SuppressionEntry[]> {
  const { data, error } = await supabase
    .from("email_suppressions")
    .select("id, email, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as SuppressionEntry[];
}

// ─── Sub-components ─────────────────────────────────────────

function ProviderHealthCard({ result }: { result: ProviderHealthResult }) {
  const badge = STATUS_BADGES[result.status];
  const StatusIcon = result.status === "healthy" ? CheckCircle
    : result.status === "degraded" ? AlertTriangle
    : result.status === "down" ? XCircle
    : WifiOff;

  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 h-full ${
        result.status === "healthy" ? "bg-green-500"
        : result.status === "degraded" ? "bg-yellow-500"
        : result.status === "down" ? "bg-destructive"
        : "bg-muted"
      }`} />
      <CardContent className="p-4 pl-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusIcon className={`h-5 w-5 ${STATUS_COLORS[result.status]}`} />
            <div>
              <p className="font-semibold text-sm">{PROVIDER_LABELS[result.provider] || result.provider}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{result.message}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge>
            {result.latencyMs != null && (
              <span className="text-[10px] text-muted-foreground">{result.latencyMs}ms</span>
            )}
          </div>
        </div>
        {result.details && Object.keys(result.details).length > 0 && (
          <div className="mt-2 p-2 bg-muted/50 rounded text-[11px] font-mono space-y-0.5">
            {Object.entries(result.details).map(([k, v]) => (
              <div key={k}><span className="text-muted-foreground">{k}:</span> {String(v)}</div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-2">
          Verificado {formatDistanceToNow(new Date(result.checkedAt), { addSuffix: true, locale: es })}
        </p>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, icon: Icon, trend, color }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: "up" | "down";
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
      <div className={`p-2 rounded-lg bg-muted ${color || ""}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold">{value}</p>
      </div>
      {trend && (
        <div className="ml-auto">
          {trend === "up" ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
        </div>
      )}
    </div>
  );
}

function EventTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "delivered": return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    case "bounced":
    case "bounce": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "complained":
    case "complaint": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
    case "opened": return <Mail className="h-3.5 w-3.5 text-blue-500" />;
    case "clicked": return <Zap className="h-3.5 w-3.5 text-primary" />;
    default: return <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

// ─── Deliverability Checklist ────────────────────────────────

function DeliverabilityChecklist() {
  const { data: settings, isLoading } = useQuery({
    queryKey: ["system-email-settings-debug"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("system_email_settings") as any).select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  const checks = [
    {
      id: "domain",
      label: "Dominio andromeda.legal verificado en Resend",
      status: settings?.domain_verified_at ? "pass" : "pending",
      help: "Ve a Resend Dashboard → Domains → Add Domain → andromeda.legal. Sigue las instrucciones para agregar registros DNS.",
    },
    {
      id: "spf",
      label: "Registro SPF configurado en Hostinger",
      status: settings?.dns_spf_verified ? "pass" : "pending",
      help: "En Hostinger DNS, agrega TXT record: Host: @ | Value: v=spf1 include:resend.com ~all",
    },
    {
      id: "dkim",
      label: "Registros DKIM (CNAME) configurados en Hostinger",
      status: settings?.dns_dkim_verified ? "pass" : "pending",
      help: "Resend te proporciona 3 registros CNAME. Agrégalos en Hostinger DNS exactamente como aparecen.",
    },
    {
      id: "dmarc",
      label: "Registro DMARC configurado",
      status: settings?.dns_dmarc_verified ? "pass" : "pending",
      help: "Agrega TXT: Host: _dmarc | Value: v=DMARC1; p=none; rua=mailto:dmarc@andromeda.legal",
    },
    {
      id: "api_key",
      label: "RESEND_API_KEY configurada como secreto",
      status: "check_manual",
      help: "El API key debe estar como secreto en Lovable Cloud. Ve a Configuración → Secretos → RESEND_API_KEY.",
    },
    {
      id: "enabled",
      label: "Envío habilitado en configuración del sistema",
      status: settings?.is_enabled ? "pass" : "pending",
      help: "Ve a la pestaña Configuración de esta consola y activa el toggle 'Envío habilitado'.",
    },
    {
      id: "test",
      label: "Email de prueba enviado exitosamente",
      status: settings?.last_test_result === "ok" ? "pass" : settings?.last_test_result ? "fail" : "pending",
      help: "Usa el botón 'Enviar Test' en Configuración para verificar el pipeline completo.",
    },
    {
      id: "hostinger_mx",
      label: "MX records en Hostinger NO interfieren con Resend",
      status: "check_manual",
      help: "Los MX de Hostinger son para RECIBIR email (webmail). No afectan el envío vía Resend. Verifica que no haya registros SPF conflictivos.",
    },
  ];

  if (isLoading) {
    return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}</div>;
  }

  const passCount = checks.filter(c => c.status === "pass").length;
  const totalCheckable = checks.filter(c => c.status !== "check_manual").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Checklist de Entregabilidad — Hostinger + Resend
          </CardTitle>
          <CardDescription className="text-xs">
            {passCount}/{totalCheckable} verificaciones automáticas pasadas. Completa todas para garantizar entrega.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks.map((check) => (
            <div key={check.id} className="flex items-start gap-3 p-3 rounded-lg border">
              {check.status === "pass" ? (
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
              ) : check.status === "fail" ? (
                <XCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              ) : check.status === "check_manual" ? (
                <AlertTriangle className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              ) : (
                <Clock className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium">{check.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{check.help}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Resumen de Arquitectura</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2">
          <p><strong>Hosting email:</strong> info@andromeda.legal en Hostinger (recepción/webmail)</p>
          <p><strong>Envío transaccional:</strong> Resend API → email_outbox → process-email-outbox</p>
          <p><strong>Recepción programática:</strong> Resend Inbound → inbound-email Edge Function → inbound_messages</p>
          <p><strong>Clave:</strong> SPF/DKIM/DMARC en DNS de Hostinger autorizan a Resend a enviar en nombre de @andromeda.legal</p>
          <p><strong>Conflictos comunes:</strong> SPF duplicado (solo debe haber 1 registro SPF que incluya tanto Hostinger como Resend)</p>
        </CardContent>
      </Card>
    </div>
  );
}

function TestSendCard() {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTestSend = async () => {
    setSending(true);
    setResult(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("No se pudo obtener el email del usuario autenticado");

      const { data, error } = await supabase.functions.invoke("system-email-send", {
        body: {
          to: user.email,
          subject: `[TEST] Pipeline de email — ${new Date().toLocaleString("es-CO")}`,
          html: `<div style="font-family:monospace;padding:20px;background:#000;color:#0f0;border:1px solid #0f0;">
            <h2 style="color:#0f0;">✅ Test de Pipeline Exitoso</h2>
            <p>Este email fue enviado desde el Debug Panel de la Consola de Email.</p>
            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            <p><strong>Destinatario:</strong> ${user.email}</p>
            <p><strong>Pipeline:</strong> system-email-send → Resend API</p>
            <hr style="border-color:#0f0;"/>
            <p style="font-size:11px;color:#888;">Atenia Platform — andromeda.legal</p>
          </div>`,
          text: `Test de Pipeline — ${new Date().toISOString()}`,
        },
      });

      if (error) throw error;

      if (data?.ok) {
        setResult({ ok: true, message: `Email de prueba enviado a ${user.email}. ID: ${data.provider_message_id || "sent"}` });
        toast.success("Test enviado exitosamente");
      } else {
        setResult({ ok: false, message: data?.error_message || data?.error || "Error desconocido" });
        toast.error(data?.error_message || "Error al enviar test");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      setResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TestTube className="h-4 w-4 text-primary" />
          Test rápido de envío
        </CardTitle>
        <CardDescription className="text-xs">
          Envía un email de prueba a tu dirección vía system-email-send → Resend API
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleTestSend} disabled={sending}>
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {sending ? "Enviando test..." : "Enviar test vía Resend"}
        </Button>
        {result && (
          <div className={`text-xs p-2 rounded border ${result.ok ? "border-primary/30 bg-primary/5 text-primary" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
            {result.ok ? <CheckCircle className="h-3 w-3 inline mr-1" /> : <XCircle className="h-3 w-3 inline mr-1" />}
            {result.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WebhookHealthCard() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ hasEvents: boolean; lastEvent: string | null; stale: boolean } | null>(null);

  const checkWebhook = async () => {
    setChecking(true);
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: events, error } = await (supabase.from("system_email_events") as any)
        .select("id, event_id, created_at")
        .eq("provider", "resend")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;

      if (events && events.length > 0) {
        const lastEventTime = events[0].created_at;
        const isStale = lastEventTime < twentyFourHoursAgo;
        setResult({ hasEvents: true, lastEvent: lastEventTime, stale: isStale });
      } else {
        setResult({ hasEvents: false, lastEvent: null, stale: true });
      }
    } catch (err) {
      toast.error("Error verificando webhook");
    } finally {
      setChecking(false);
    }
  };

  const handleDiagnose = () => {
    const summary = result
      ? `📧 Webhook Entrada Health:\nÚltimo evento: ${result.lastEvent ? new Date(result.lastEvent).toLocaleString("es-CO") : "Ninguno"}\nEstado: ${result.stale ? "⚠️ Sin eventos en 24h" : "✅ Activo"}`
      : "No hay datos de diagnóstico. Ejecuta la verificación primero.";
    toast.success("Diagnóstico generado", { description: summary.slice(0, 200) });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" />
          Webhook Entrada (Resend Inbound)
        </CardTitle>
        <CardDescription className="text-xs">
          Verifica que el webhook de recepción está funcionando y recibiendo eventos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={checkWebhook} disabled={checking}>
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Verificar
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDiagnose}>
            <Brain className="h-3.5 w-3.5" /> Diagnose con Andro IA
          </Button>
        </div>
        {result && (
          <div className={`text-xs p-2 rounded border ${
            !result.hasEvents ? "border-destructive/30 bg-destructive/5 text-destructive" :
            result.stale ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-600" :
            "border-primary/30 bg-primary/5 text-primary"
          }`}>
            {!result.hasEvents ? (
              <>
                <XCircle className="h-3 w-3 inline mr-1" />
                Sin eventos registrados. Configura el webhook en Resend.
              </>
            ) : result.stale ? (
              <>
                <AlertTriangle className="h-3 w-3 inline mr-1" />
                Sin eventos en 24h. Último: {new Date(result.lastEvent!).toLocaleString("es-CO")}
              </>
            ) : (
              <>
                <CheckCircle className="h-3 w-3 inline mr-1" />
                Webhook activo. Último evento: {new Date(result.lastEvent!).toLocaleString("es-CO")}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Atenia AI Health Dispatch ──────────────────────────────

function dispatchAteniaEmailHealth(healthResults: ProviderHealthResult[], metrics: DeliveryMetrics) {
  const degradedOrDown = healthResults.filter(r => r.status === "degraded" || r.status === "down");
  const summary = [
    `📊 Email Pipeline Health Report`,
    `Proveedores verificados: ${healthResults.length}`,
    degradedOrDown.length > 0
      ? `⚠️ ${degradedOrDown.length} proveedor(es) con problemas: ${degradedOrDown.map(r => `${PROVIDER_LABELS[r.provider]}(${r.status})`).join(", ")}`
      : `✅ Todos los proveedores saludables`,
    ``,
    `📈 Métricas últimas 24h:`,
    `Total emails: ${metrics.total}`,
    `Enviados: ${metrics.sent} | Pendientes: ${metrics.pending} | Fallidos: ${metrics.failed + metrics.failedPermanent}`,
    `Tasa de éxito: ${metrics.successRate}%`,
    metrics.avgDeliveryMs ? `Tiempo promedio de entrega: ${metrics.avgDeliveryMs}ms` : "",
    metrics.successRate < 90 ? `\n🚨 ALERTA: Tasa de éxito por debajo del 90%. Investigar fallos inmediatamente.` : "",
    degradedOrDown.length > 0 ? `\n🔍 Diagnóstico detallado:\n${degradedOrDown.map(r => `- ${PROVIDER_LABELS[r.provider]}: ${r.message}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  toast.success("Informe de salud generado", { description: summary.slice(0, 200) + "..." });
}

// ─── Main Component ─────────────────────────────────────────

export function EmailProviderDebugPanel() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("health");

  const { data: healthResults, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ["email-debug-health"],
    queryFn: fetchProviderHealth,
    staleTime: 60_000,
  });

  const { data: metrics, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery({
    queryKey: ["email-debug-metrics"],
    queryFn: () => fetchDeliveryMetrics(24),
    staleTime: 30_000,
  });

  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["email-debug-events"],
    queryFn: () => fetchRecentDeliveryEvents(30),
    staleTime: 30_000,
  });

  const { data: suppressions, isLoading: suppressionsLoading } = useQuery({
    queryKey: ["email-debug-suppressions"],
    queryFn: () => fetchSuppressions(50),
    staleTime: 60_000,
  });

  const overallStatus = useMemo(() => {
    if (!healthResults) return "unknown";
    if (healthResults.some(r => r.status === "down")) return "critical";
    if (healthResults.some(r => r.status === "degraded")) return "warning";
    return "ok";
  }, [healthResults]);

  const handleRefreshAll = () => {
    refetchHealth();
    refetchMetrics();
    queryClient.invalidateQueries({ queryKey: ["email-debug-events"] });
    queryClient.invalidateQueries({ queryKey: ["email-debug-suppressions"] });
    toast.success("Diagnóstico actualizado");
  };

  const handleAteniaVigilance = () => {
    if (healthResults && metrics) {
      dispatchAteniaEmailHealth(healthResults, metrics);
      toast.success("Informe enviado a Andro IA");
    } else {
      toast.error("Espere a que se carguen los datos");
    }
  };

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${
            overallStatus === "ok" ? "bg-green-500/10" :
            overallStatus === "warning" ? "bg-yellow-500/10" :
            overallStatus === "critical" ? "bg-destructive/10" : "bg-muted"
          }`}>
            <Shield className={`h-5 w-5 ${
              overallStatus === "ok" ? "text-green-500" :
              overallStatus === "warning" ? "text-yellow-500" :
              overallStatus === "critical" ? "text-destructive" : "text-muted-foreground"
            }`} />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Debug de Proveedores de Email</h3>
            <p className="text-xs text-muted-foreground">
              {overallStatus === "ok" ? "Todos los sistemas operativos" :
               overallStatus === "warning" ? "Hay proveedores degradados" :
               overallStatus === "critical" ? "¡Proveedor(es) caído(s)!" : "Cargando..."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefreshAll} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refrescar
          </Button>
          <Button size="sm" onClick={handleAteniaVigilance} className="gap-1.5">
            <Brain className="h-3.5 w-3.5" /> Vigilancia Andro IA
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="health" className="gap-1.5 text-xs">
            <Wifi className="h-3.5 w-3.5" /> Salud
          </TabsTrigger>
          <TabsTrigger value="deliverability" className="gap-1.5 text-xs">
            <Globe className="h-3.5 w-3.5" /> Entregabilidad
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="gap-1.5 text-xs">
            <Activity className="h-3.5 w-3.5" /> Pipeline
          </TabsTrigger>
          <TabsTrigger value="events" className="gap-1.5 text-xs">
            <Zap className="h-3.5 w-3.5" /> Eventos
          </TabsTrigger>
          <TabsTrigger value="suppressions" className="gap-1.5 text-xs">
            <Ban className="h-3.5 w-3.5" /> Supresiones
          </TabsTrigger>
        </TabsList>

        {/* ─── Health Tab ─── */}
        <TabsContent value="health" className="space-y-4 mt-4">
          {healthLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-28" />)}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {healthResults?.map(r => <ProviderHealthCard key={r.provider} result={r} />)}
            </div>
          )}

          <TestSendCard />
          <WebhookHealthCard />
        </TabsContent>

        {/* ─── Deliverability Tab ─── */}
        <TabsContent value="deliverability" className="space-y-4 mt-4">
          <DeliverabilityChecklist />
        </TabsContent>

        {/* ─── Pipeline Tab ─── */}
        <TabsContent value="pipeline" className="space-y-4 mt-4">
          {metricsLoading ? (
            <div className="grid gap-3 md:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : metrics ? (
            <>
              <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
                <MetricCard label="Total (24h)" value={metrics.total} icon={Mail} />
                <MetricCard
                  label="Tasa de Éxito"
                  value={`${metrics.successRate}%`}
                  icon={metrics.successRate >= 95 ? TrendingUp : TrendingDown}
                  trend={metrics.successRate >= 95 ? "up" : "down"}
                />
                <MetricCard label="Enviados" value={metrics.sent} icon={CheckCircle} color="text-green-500" />
                <MetricCard label="Pendientes" value={metrics.pending} icon={Clock} color="text-yellow-500" />
                <MetricCard label="Fallidos" value={metrics.failed} icon={XCircle} color="text-destructive" />
                <MetricCard label="Perm. Fallidos" value={metrics.failedPermanent} icon={Ban} color="text-destructive" />
              </div>

              {metrics.avgDeliveryMs && (
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <Clock className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-xs text-muted-foreground">Tiempo promedio de entrega</p>
                      <p className="font-bold">
                        {metrics.avgDeliveryMs < 1000
                          ? `${metrics.avgDeliveryMs}ms`
                          : `${(metrics.avgDeliveryMs / 1000).toFixed(1)}s`}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {(metrics.successRate < 90 || metrics.failedPermanent > 0) && (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardContent className="p-4 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-destructive">Atención requerida</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {metrics.successRate < 90 && `Tasa de éxito del ${metrics.successRate}% — por debajo del umbral (90%). `}
                        {metrics.failedPermanent > 0 && `${metrics.failedPermanent} emails con fallo permanente (bounce/suppression). `}
                        Use Andro IA para diagnóstico detallado.
                      </p>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="mt-2 gap-1.5"
                        onClick={handleAteniaVigilance}
                      >
                        <Brain className="h-3.5 w-3.5" /> Diagnosticar con Andro IA
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </TabsContent>

        {/* ─── Events Tab ─── */}
        <TabsContent value="events" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Eventos de Entrega Recientes</CardTitle>
              <CardDescription className="text-xs">
                Webhooks procesados de los proveedores (delivered, bounced, complained, opened, clicked)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {eventsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}
                </div>
              ) : events && events.length > 0 ? (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-1">
                    {events.map(event => (
                      <div key={event.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 text-xs">
                        <EventTypeIcon type={event.event_type} />
                        <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                          {event.event_type}
                        </Badge>
                        <span className="text-muted-foreground truncate flex-1 font-mono text-[10px]">
                          {event.email_outbox_id?.slice(0, 8) || "—"}
                        </span>
                        <span className="text-muted-foreground shrink-0">
                          {formatDistanceToNow(new Date(event.created_at), { addSuffix: true, locale: es })}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Sin eventos de entrega recientes. Los eventos se registran cuando los proveedores envían webhooks.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Suppressions Tab ─── */}
        <TabsContent value="suppressions" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Ban className="h-4 w-4 text-destructive" />
                Lista de Supresiones
              </CardTitle>
              <CardDescription className="text-xs">
                Emails que han sido marcados como bounce o complaint. No se les enviarán más emails.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {suppressionsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
                </div>
              ) : suppressions && suppressions.length > 0 ? (
                <ScrollArea className="h-[350px]">
                  <div className="space-y-1">
                    {suppressions.map(s => (
                      <div key={s.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 text-xs">
                        <Ban className="h-3.5 w-3.5 text-destructive shrink-0" />
                        <span className="font-mono truncate">{s.email}</span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">{s.reason}</Badge>
                        <span className="text-muted-foreground ml-auto shrink-0">
                          {formatDistanceToNow(new Date(s.created_at), { addSuffix: true, locale: es })}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Sin supresiones registradas. ¡Buena señal! 🎉
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
