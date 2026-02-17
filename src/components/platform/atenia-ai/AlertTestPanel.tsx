/**
 * AlertTestPanel — Debug tool for testing alerts & email delivery
 * across all 4 user roles: Super Admin, Org Admin, Org Member, Solo User.
 * Super Admin only (Platform Console).
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell, Mail, Shield, Users, User, Crown, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Send, TestTube,
} from "lucide-react";
import { toast } from "sonner";

const PLATFORM_ORG_ID = "a0000000-0000-0000-0000-000000000001";

type RoleTarget = "SUPER_ADMIN" | "ORG_ADMIN" | "ORG_MEMBER" | "SOLO_USER";
type TestSeverity = "INFO" | "WARNING" | "CRITICAL";

interface TestResult {
  role: RoleTarget;
  inAppOk: boolean | null;
  emailOk: boolean | null;
  inAppError?: string;
  emailError?: string;
  alertId?: string;
  emailMessageId?: string;
  timestamp: string;
}

const ROLE_META: Record<RoleTarget, { label: string; icon: React.ReactNode; description: string; audienceScope: string; category: string }> = {
  SUPER_ADMIN: {
    label: "Super Admin",
    icon: <Crown className="h-4 w-4" />,
    description: "Alerta de ops/plataforma — solo super admins",
    audienceScope: "SUPER_ADMIN",
    category: "OPS_SYNC",
  },
  ORG_ADMIN: {
    label: "Admin Organización",
    icon: <Shield className="h-4 w-4" />,
    description: "Alerta de actividad org — admins y owners",
    audienceScope: "ORG_ADMIN",
    category: "ORG_ACTIVITY",
  },
  ORG_MEMBER: {
    label: "Miembro Organización",
    icon: <Users className="h-4 w-4" />,
    description: "Alerta de work item — cualquier miembro",
    audienceScope: "USER",
    category: "WORK_ITEM_ALERTS",
  },
  SOLO_USER: {
    label: "Usuario Individual",
    icon: <User className="h-4 w-4" />,
    description: "Alerta de términos legales — usuario individual",
    audienceScope: "USER",
    category: "TERMS",
  },
};

const SEVERITY_OPTIONS: { value: TestSeverity; label: string; color: string }[] = [
  { value: "INFO", label: "Info", color: "text-blue-500" },
  { value: "WARNING", label: "Warning", color: "text-yellow-500" },
  { value: "CRITICAL", label: "Critical", color: "text-red-500" },
];

export function AlertTestPanel() {
  const [running, setRunning] = useState<RoleTarget | "ALL" | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [sendEmail, setSendEmail] = useState(true);
  const [testEmail, setTestEmail] = useState("");
  const [severity, setSeverity] = useState<TestSeverity>("INFO");

  const sendTestAlert = async (role: RoleTarget): Promise<TestResult> => {
    const meta = ROLE_META[role];
    const now = new Date();
    const timestamp = now.toISOString();
    const testId = `test-${role.toLowerCase()}-${now.getTime()}`;

    const result: TestResult = {
      role,
      inAppOk: null,
      emailOk: null,
      timestamp,
    };

    // 1. Create in-app notification
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data: notif, error: notifErr } = await supabase
        .from("notifications")
        .insert({
          audience_scope: meta.audienceScope as any,
          user_id: user.id,
          org_id: PLATFORM_ORG_ID,
          category: meta.category as any,
          type: "TEST_ALERT",
          title: `[TEST] Alerta ${meta.label} — ${severity}`,
          body: `Alerta de prueba para rol ${meta.label}. Severidad: ${severity}. ID: ${testId}. Generada desde Atenia AI Debug.`,
          severity: severity,
          metadata: {
            test: true,
            test_id: testId,
            role_target: role,
            generated_by: "atenia_alert_test_panel",
          },
          dedupe_key: testId,
          deep_link: "/platform/atenia-ai",
        } as any)
        .select("id")
        .single();

      if (notifErr) throw notifErr;
      result.inAppOk = true;
      result.alertId = notif?.id;
    } catch (err: any) {
      result.inAppOk = false;
      result.inAppError = err.message || "Error desconocido";
    }

    // 2. Send test email (if enabled)
    if (sendEmail && testEmail) {
      try {
        const { data: emailResult, error: emailErr } = await supabase.functions.invoke("system-email-send", {
          body: {
            to: [testEmail],
            subject: `[TEST] Alerta ${meta.label} — ${severity}`,
            html: `
              <h2 style="color:#0c1529;margin:0 0 16px;">🧪 Alerta de Prueba</h2>
              <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Rol objetivo</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${meta.label}</td></tr>
                <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Scope</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${meta.audienceScope}</td></tr>
                <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Categoría</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${meta.category}</td></tr>
                <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Severidad</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${severity}</td></tr>
                <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Test ID</td><td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;font-size:12px;">${testId}</td></tr>
                <tr><td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Timestamp</td><td style="padding:8px 12px;border:1px solid #e5e7eb;">${now.toLocaleString("es-CO")}</td></tr>
              </table>
              <p style="color:#6b7280;font-size:13px;">Este email fue generado por el panel de pruebas de Atenia AI. Si lo recibiste correctamente, el flujo de alertas por email para el rol <strong>${meta.label}</strong> está funcionando.</p>
            `,
          },
        });

        if (emailErr) throw emailErr;
        if (emailResult && !emailResult.ok) throw new Error(emailResult.error_message || "Email send failed");
        result.emailOk = true;
        result.emailMessageId = emailResult?.provider_message_id;
      } catch (err: any) {
        result.emailOk = false;
        result.emailError = err.message || "Error desconocido";
      }
    } else {
      result.emailOk = null; // skipped
    }

    return result;
  };

  const runSingleTest = async (role: RoleTarget) => {
    setRunning(role);
    try {
      const result = await sendTestAlert(role);
      setResults(prev => [result, ...prev]);
      if (result.inAppOk && (result.emailOk === null || result.emailOk)) {
        toast.success(`Test ${ROLE_META[role].label}: OK`);
      } else {
        toast.error(`Test ${ROLE_META[role].label}: falló`);
      }
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setRunning(null);
    }
  };

  const runAllTests = async () => {
    setRunning("ALL");
    const roles: RoleTarget[] = ["SUPER_ADMIN", "ORG_ADMIN", "ORG_MEMBER", "SOLO_USER"];
    const newResults: TestResult[] = [];

    for (const role of roles) {
      const result = await sendTestAlert(role);
      newResults.push(result);
      setResults(prev => [result, ...prev]);
      // Small delay between sends to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    const allOk = newResults.every(r => r.inAppOk && (r.emailOk === null || r.emailOk));
    if (allOk) toast.success("Todos los tests pasaron ✅");
    else toast.error("Algunos tests fallaron");

    setRunning(null);
  };

  const clearResults = () => setResults([]);

  return (
    <div className="space-y-4">
      {/* Config */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TestTube className="h-4 w-4" />
            Configuración de Pruebas
          </CardTitle>
          <CardDescription>
            Envía alertas de prueba (in-app + email) para cada tipo de usuario.
            Verifica que el sistema de notificaciones y el email gateway funcionan correctamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Severidad</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as TestSeverity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map(s => (
                    <SelectItem key={s.value} value={s.value}>
                      <span className={s.color}>{s.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="send-email"
                  checked={sendEmail}
                  onCheckedChange={setSendEmail}
                />
                <Label htmlFor="send-email" className="text-xs font-medium">
                  Enviar email de prueba
                </Label>
              </div>
              {sendEmail && (
                <Input
                  type="email"
                  placeholder="test@ejemplo.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="text-sm"
                />
              )}
            </div>

            <div className="flex items-end gap-2">
              <Button
                onClick={runAllTests}
                disabled={running !== null || (sendEmail && !testEmail)}
                className="gap-2"
              >
                {running === "ALL" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Test Completo (4 roles)
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Individual role tests */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(Object.entries(ROLE_META) as [RoleTarget, typeof ROLE_META[RoleTarget]][]).map(([role, meta]) => (
          <Card key={role} className="relative overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 mb-2">
                  {meta.icon}
                  <span className="text-sm font-semibold">{meta.label}</span>
                  <Badge variant="outline" className="text-[10px]">{meta.audienceScope}</Badge>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runSingleTest(role)}
                  disabled={running !== null || (sendEmail && !testEmail)}
                  className="gap-1.5 text-xs"
                >
                  {running === role ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
                  Test
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Bell className="h-3 w-3" /> In-App: <code>{meta.category}</code>
                </span>
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" /> Email: {sendEmail ? "Sí" : "No"}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Resultados ({results.length})
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={clearResults} className="text-xs">
                Limpiar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg border text-sm">
                    <div className="flex items-center gap-2 min-w-[140px]">
                      {ROLE_META[r.role].icon}
                      <span className="font-medium text-xs">{ROLE_META[r.role].label}</span>
                    </div>

                    {/* In-App result */}
                    <div className="flex items-center gap-1.5">
                      <Bell className="h-3 w-3 text-muted-foreground" />
                      {r.inAppOk === true && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                      {r.inAppOk === false && (
                        <span className="flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                          <span className="text-[10px] text-red-500 max-w-[120px] truncate">{r.inAppError}</span>
                        </span>
                      )}
                      {r.inAppOk === null && <span className="text-[10px] text-muted-foreground">—</span>}
                    </div>

                    {/* Email result */}
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3 w-3 text-muted-foreground" />
                      {r.emailOk === true && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                      {r.emailOk === false && (
                        <span className="flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                          <span className="text-[10px] text-red-500 max-w-[120px] truncate">{r.emailError}</span>
                        </span>
                      )}
                      {r.emailOk === null && <span className="text-[10px] text-muted-foreground">omitido</span>}
                    </div>

                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(r.timestamp).toLocaleTimeString("es-CO")}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
