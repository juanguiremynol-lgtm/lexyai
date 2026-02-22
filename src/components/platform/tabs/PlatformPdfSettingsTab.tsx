/**
 * Platform PDF Settings Tab
 * Super Admin UI for managing Gotenberg PDF provider configuration
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  FileText,
  Globe,
  Shield,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PdfSettings {
  id: string;
  provider: string;
  gotenberg_url: string | null;
  mode: "DEMO" | "DIRECT";
  enabled: boolean;
  timeout_seconds: number;
  max_html_bytes: number;
  allow_html_fallback: boolean;
  last_health_check_at: string | null;
  last_health_status: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  updated_at: string;
}

export function PlatformPdfSettingsTab() {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [editUrl, setEditUrl] = useState("");
  const [editTimeout, setEditTimeout] = useState(30);
  const [editMaxBytes, setEditMaxBytes] = useState(4000000);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["platform-pdf-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_pdf_settings")
        .select("*")
        .limit(1)
        .single();
      if (error) throw error;
      return data as unknown as PdfSettings;
    },
  });

  // Sync form state when settings load
  useEffect(() => {
    if (settings) {
      setEditUrl(settings.gotenberg_url || "");
      setEditTimeout(settings.timeout_seconds);
      setEditMaxBytes(settings.max_html_bytes);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<PdfSettings>) => {
      if (!settings?.id) throw new Error("No settings found");
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("platform_pdf_settings")
        .update({
          ...updates,
          updated_by_user_id: user?.id,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", settings.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-pdf-settings"] });
      toast({ title: "Configuración guardada", description: "Los cambios se aplicarán inmediatamente a nuevos trabajos PDF." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleTestConnection = async (url?: string) => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const body: any = {};
      if (url) body.gotenberg_url = url;

      const { data, error } = await supabase.functions.invoke("test-gotenberg-connection", { body });
      if (error) throw error;
      setTestResult(data);
      if (data?.ok) {
        toast({ title: "Conexión exitosa", description: `Latencia: ${data.render?.latency_ms}ms` });
      } else {
        toast({ title: "Conexión fallida", description: data?.health?.error || data?.render?.error || "Error desconocido", variant: "destructive" });
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message });
      toast({ title: "Error de prueba", description: err.message, variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!settings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>No se encontró la configuración de PDF.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isDemo = settings.mode === "DEMO";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-serif font-bold">Generación de PDF</h2>
          <p className="text-muted-foreground text-sm">
            Configuración del proveedor Gotenberg para generación de documentos PDF firmados
          </p>
        </div>
      </div>

      {/* Admin Guide */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm space-y-1">
              <p className="font-medium">Guía de configuración</p>
              <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                <li><strong>Modo Demo</strong> usa <code>demo.gotenberg.dev</code> — ideal para pruebas, tiene límites de tasa (~2 req/s) y tamaño (5MB).</li>
                <li><strong>Modo Directo</strong> requiere un endpoint Gotenberg propio (ej. Cloud Run) — sin límites de tasa, mayor rendimiento.</li>
                <li>Cambiar de modo es <strong>inmediato</strong> y no requiere cambios de código ni redeploy.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Estado</span>
              {settings.enabled ? (
                <Badge variant="default">Activo</Badge>
              ) : (
                <Badge variant="destructive">Desactivado</Badge>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Modo</span>
              <Badge variant={isDemo ? "secondary" : "default"}>
                {isDemo ? "Demo" : "Directo"}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Último check</span>
              <span className="text-sm">
                {settings.last_health_check_at
                  ? new Date(settings.last_health_check_at).toLocaleString("es-CO")
                  : "Nunca"}
              </span>
            </div>
            {settings.last_health_status && (
              <div className="mt-1 flex items-center gap-1">
                {settings.last_health_status === "healthy" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                )}
                <span className="text-xs text-muted-foreground capitalize">{settings.last_health_status}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Proveedor de PDF
          </CardTitle>
          <CardDescription>
            Configura el endpoint de Gotenberg para la generación de PDFs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Generación de PDF habilitada</Label>
              <p className="text-sm text-muted-foreground">Desactivar bloquea toda generación de PDF</p>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(checked) => updateMutation.mutate({ enabled: checked })}
            />
          </div>

          {/* Demo Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Usar Gotenberg Demo</Label>
              <p className="text-sm text-muted-foreground">
                {isDemo
                  ? "Usando demo.gotenberg.dev (límites de tasa y tamaño)"
                  : "Usando endpoint directo configurado abajo"}
              </p>
            </div>
            <Switch
              checked={isDemo}
              onCheckedChange={(checked) => {
                const newMode = checked ? "DEMO" : "DIRECT";
                const newTimeout = checked ? 30 : 60;
                updateMutation.mutate({
                  mode: newMode,
                  timeout_seconds: newTimeout,
                } as any);
                setEditTimeout(newTimeout);
              }}
            />
          </div>

          {/* Direct URL */}
          <div className={isDemo ? "opacity-50 pointer-events-none" : ""}>
            <Label>Gotenberg URL (Directo)</Label>
            <p className="text-sm text-muted-foreground mb-2">
              URL del endpoint Gotenberg propio (ej. <code>https://gotenberg.midominio.com</code>)
            </p>
            <div className="flex gap-2">
              <Input
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                placeholder="https://gotenberg.example.com"
                disabled={isDemo}
              />
              <Button
                variant="outline"
                disabled={isDemo || !editUrl}
                onClick={() => {
                  try {
                    const url = new URL(editUrl);
                    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
                      toast({ title: "URL inválida", description: "No se permite localhost/127.0.0.1 en modo Directo", variant: "destructive" });
                      return;
                    }
                  } catch {
                    toast({ title: "URL inválida", description: "Ingrese una URL válida", variant: "destructive" });
                    return;
                  }
                  updateMutation.mutate({ gotenberg_url: editUrl } as any);
                }}
              >
                Guardar URL
              </Button>
            </div>
            {!isDemo && editUrl && !editUrl.startsWith("https://") && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Se recomienda HTTPS para endpoints de producción
              </p>
            )}
          </div>

          {/* Test Connection */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                variant="outline"
                onClick={() => handleTestConnection(isDemo ? "https://demo.gotenberg.dev" : editUrl || undefined)}
                disabled={isTesting || (!isDemo && !editUrl && !settings.gotenberg_url)}
              >
                {isTesting ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Probando…</>
                ) : (
                  <><Activity className="h-4 w-4 mr-2" /> Probar conexión</>
                )}
              </Button>
              {testResult && (
                <span className={`text-sm flex items-center gap-1 ${testResult.ok ? "text-primary" : "text-destructive"}`}>
                  {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {testResult.ok
                    ? `Éxito — Health: ${testResult.health?.latency_ms}ms, Render: ${testResult.render?.latency_ms}ms, PDF: ${testResult.render?.pdf_size_bytes} bytes`
                    : testResult.health?.error || testResult.render?.error || testResult.error || "Error"}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Configuración avanzada
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Timeout (segundos)</Label>
              <p className="text-sm text-muted-foreground mb-1">Tiempo máximo de espera por conversión</p>
              <Input
                type="number"
                value={editTimeout}
                onChange={(e) => setEditTimeout(Number(e.target.value))}
                min={10}
                max={120}
              />
            </div>
            <div>
              <Label>Tamaño máximo HTML (bytes)</Label>
              <p className="text-sm text-muted-foreground mb-1">Límite del payload HTML enviado</p>
              <Input
                type="number"
                value={editMaxBytes}
                onChange={(e) => setEditMaxBytes(Number(e.target.value))}
                min={100000}
                max={50000000}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Permitir fallback a HTML</Label>
              <p className="text-sm text-muted-foreground">Solo para debugging — en producción siempre desactivar</p>
            </div>
            <Switch
              checked={settings.allow_html_fallback}
              onCheckedChange={(checked) => updateMutation.mutate({ allow_html_fallback: checked } as any)}
            />
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() =>
                updateMutation.mutate({
                  timeout_seconds: editTimeout,
                  max_html_bytes: editMaxBytes,
                } as any)
              }
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Guardar configuración avanzada
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
