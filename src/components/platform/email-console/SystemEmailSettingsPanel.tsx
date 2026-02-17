/**
 * SystemEmailSettingsPanel — Super admin panel for email identity,
 * template customization, and deliverability status.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Save, Loader2, Mail, Palette, Send, CheckCircle, XCircle,
  AlertTriangle, Globe, Shield, Eye,
} from "lucide-react";
import { toast } from "sonner";

interface EmailSettings {
  id: string;
  from_email: string;
  from_name: string;
  reply_to: string | null;
  provider: string;
  is_enabled: boolean;
  alert_subject_template: string;
  alert_html_header: string | null;
  alert_html_footer: string | null;
  alert_logo_url: string | null;
  alert_accent_color: string;
  alert_cta_text: string;
  alert_cta_url: string;
  dns_spf_verified: boolean;
  dns_dkim_verified: boolean;
  dns_dmarc_verified: boolean;
  domain_verified_at: string | null;
  last_test_sent_at: string | null;
  last_test_result: string | null;
}

async function fetchSettings(): Promise<EmailSettings | null> {
  const { data, error } = await (supabase
    .from("system_email_settings") as any)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function SystemEmailSettingsPanel() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["system-email-settings"],
    queryFn: fetchSettings,
  });

  const [form, setForm] = useState<Partial<EmailSettings>>({});
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<EmailSettings>) => {
      if (!settings?.id) throw new Error("No settings found");
      const { error } = await (supabase
        .from("system_email_settings") as any)
        .update(updates)
        .eq("id", settings.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-email-settings"] });
      toast.success("Configuración guardada");
    },
    onError: (err: any) => toast.error(err.message || "Error al guardar"),
  });

  const handleSave = () => {
    const { id, created_at, updated_at, last_test_sent_at, last_test_result, domain_verified_at, ...updates } = form as any;
    saveMutation.mutate(updates);
  };

  const handleTestSend = async () => {
    setTestSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("No se pudo obtener tu email");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No autenticado");

      // Use the existing email-provider-admin test endpoint
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-provider-admin`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "send_test_email",
            to_email: user.email,
          }),
        },
      );
      const result = await res.json();

      // Update test result
      await (supabase.from("system_email_settings") as any)
        .update({
          last_test_sent_at: new Date().toISOString(),
          last_test_result: result.ok ? "ok" : `error: ${result.error || "Unknown"}`,
        })
        .eq("id", settings?.id);

      queryClient.invalidateQueries({ queryKey: ["system-email-settings"] });

      if (result.ok) {
        toast.success(`Email de prueba enviado a ${user.email}`);
      } else {
        toast.error(`Fallo: ${result.error || "Error desconocido"}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Error al enviar test");
    } finally {
      setTestSending(false);
    }
  };

  const update = (key: keyof EmailSettings, value: any) => setForm(prev => ({ ...prev, [key]: value }));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const dnsChecks = [
    { key: "dns_spf_verified", label: "SPF", desc: "Agrega registro TXT: v=spf1 include:resend.com ~all" },
    { key: "dns_dkim_verified", label: "DKIM", desc: "Agrega los registros CNAME de Resend para andromeda.legal" },
    { key: "dns_dmarc_verified", label: "DMARC", desc: "Agrega registro TXT: v=DMARC1; p=none; rua=mailto:dmarc@andromeda.legal" },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Identity & Provider */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> Identidad del Sistema
          </CardTitle>
          <CardDescription>
            Configuración del remitente para todos los emails de la plataforma.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email del remitente</Label>
              <Input value={form.from_email || ""} onChange={(e) => update("from_email", e.target.value)} />
              <p className="text-xs text-muted-foreground">Dominio en Hostinger. DNS debe apuntar a Resend.</p>
            </div>
            <div className="space-y-2">
              <Label>Nombre del remitente</Label>
              <Input value={form.from_name || ""} onChange={(e) => update("from_name", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Reply-To (opcional)</Label>
              <Input value={form.reply_to || ""} onChange={(e) => update("reply_to", e.target.value || null)} placeholder="soporte@andromeda.legal" />
            </div>
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <Input value={form.provider || "resend"} disabled className="bg-muted" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-3">
              <Switch checked={form.is_enabled ?? false} onCheckedChange={(v) => update("is_enabled", v)} />
              <Label>Envío habilitado</Label>
              <Badge variant={form.is_enabled ? "default" : "secondary"}>
                {form.is_enabled ? "Activo" : "Desactivado"}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleTestSend} disabled={testSending}>
                {testSending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                Enviar Test
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Guardar
              </Button>
            </div>
          </div>

          {settings?.last_test_result && (
            <div className={`flex items-center gap-2 text-sm p-2 rounded ${settings.last_test_result === "ok" ? "bg-green-500/10 text-green-600" : "bg-destructive/10 text-destructive"}`}>
              {settings.last_test_result === "ok" ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              Último test: {settings.last_test_result} {settings.last_test_sent_at && `(${new Date(settings.last_test_sent_at).toLocaleString()})`}
            </div>
          )}
        </CardContent>
      </Card>

      {/* DNS / Deliverability Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" /> Verificación DNS — Hostinger + Resend
          </CardTitle>
          <CardDescription>
            Para que emails de info@andromeda.legal no lleguen a spam, configura estos registros DNS en Hostinger.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {dnsChecks.map((check) => (
            <div key={check.key} className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                {(form as any)[check.key] ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                )}
                <div>
                  <p className="text-sm font-medium">{check.label}</p>
                  <p className="text-xs text-muted-foreground">{check.desc}</p>
                </div>
              </div>
              <Switch
                checked={(form as any)[check.key] ?? false}
                onCheckedChange={(v) => update(check.key, v)}
              />
            </div>
          ))}

          <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground space-y-1">
            <p><strong>Pasos en Hostinger:</strong></p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>Panel Hostinger → Dominios → andromeda.legal → DNS/Nameservers</li>
              <li>Agrega registros TXT para SPF y DMARC</li>
              <li>Agrega registros CNAME de DKIM proporcionados por Resend</li>
              <li>En Resend Dashboard → Domains → Verificar andromeda.legal</li>
              <li>Espera propagación DNS (hasta 48h) y marca las casillas arriba</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Alert Email Template Customization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-4 w-4" /> Personalización de Alertas
          </CardTitle>
          <CardDescription>
            Personaliza la apariencia de los emails de alerta enviados a usuarios. Sin código.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Plantilla de asunto</Label>
            <Input
              value={form.alert_subject_template || ""}
              onChange={(e) => update("alert_subject_template", e.target.value)}
              placeholder="{{alert_type}} — {{entity_name}}"
            />
            <p className="text-xs text-muted-foreground">
              Variables: {"{{alert_type}}"}, {"{{entity_name}}"}, {"{{severity}}"}, {"{{date}}"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Color de acento</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.alert_accent_color || "#6366f1"}
                  onChange={(e) => update("alert_accent_color", e.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={form.alert_accent_color || "#6366f1"}
                  onChange={(e) => update("alert_accent_color", e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>URL del logo</Label>
              <Input
                value={form.alert_logo_url || ""}
                onChange={(e) => update("alert_logo_url", e.target.value || null)}
                placeholder="https://... (PNG/SVG recomendado)"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Texto del botón CTA</Label>
              <Input
                value={form.alert_cta_text || ""}
                onChange={(e) => update("alert_cta_text", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>URL del botón CTA</Label>
              <Input
                value={form.alert_cta_url || ""}
                onChange={(e) => update("alert_cta_url", e.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>HTML Header personalizado (opcional)</Label>
            <Textarea
              value={form.alert_html_header || ""}
              onChange={(e) => update("alert_html_header", e.target.value || null)}
              placeholder='<div style="text-align:center;"><img src="..." alt="Logo" height="40"/></div>'
              rows={3}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label>HTML Footer personalizado (opcional)</Label>
            <Textarea
              value={form.alert_html_footer || ""}
              onChange={(e) => update("alert_html_footer", e.target.value || null)}
              placeholder='<p style="color:#888;font-size:12px;">© 2026 Andromeda Legal. Todos los derechos reservados.</p>'
              rows={3}
              className="font-mono text-xs"
            />
          </div>

          {/* Live Preview */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <Label>Vista previa</Label>
            </div>
            <div
              className="border rounded-lg p-4 bg-white text-black text-sm max-h-64 overflow-y-auto"
              dangerouslySetInnerHTML={{
                __html: buildPreviewHtml(form),
              }}
            />
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Guardar Plantilla
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function buildPreviewHtml(form: Partial<EmailSettings>): string {
  const accent = form.alert_accent_color || "#6366f1";
  const logoUrl = form.alert_logo_url;
  const ctaText = form.alert_cta_text || "Ver en Andromeda";
  const ctaUrl = form.alert_cta_url || "#";
  const header = form.alert_html_header || "";
  const footer = form.alert_html_footer || "";

  return `
    <div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;">
      ${header || (logoUrl ? `<div style="text-align:center;padding:16px 0;"><img src="${logoUrl}" alt="Logo" height="40" style="max-height:40px;"/></div>` : `<div style="text-align:center;padding:16px 0;font-weight:bold;font-size:20px;color:${accent};">ATENIA</div>`)}
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:24px;">
        <div style="border-left:4px solid ${accent};padding-left:12px;margin-bottom:16px;">
          <strong style="color:${accent};">⚠️ Alerta: Vencimiento de término</strong>
        </div>
        <p style="color:#374151;margin:0 0 8px;">Se acerca el vencimiento del término para el asunto <strong>Rad. 11001-33-35-024-2024-00123-00</strong>.</p>
        <p style="color:#6b7280;font-size:13px;">Fecha límite: 20 Feb 2026 · Prioridad: Alta</p>
        <div style="text-align:center;margin:20px 0;">
          <a href="${ctaUrl}" style="display:inline-block;background:${accent};color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;">${ctaText}</a>
        </div>
      </div>
      ${footer || `<p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:16px;">Este email fue enviado desde ${form.from_email || "info@andromeda.legal"} · ${form.from_name || "ATENIA"}</p>`}
    </div>
  `;
}
