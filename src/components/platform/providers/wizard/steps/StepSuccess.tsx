/**
 * Step 9 — Success + Runbook + Evidence Bundle Export.
 * Includes blocking warning if PLATFORM instance has no active secret.
 * Evidence bundle from Readiness Gate is available for export.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Globe, Building2, RefreshCw, List, Settings, Key, Copy, AlertTriangle, Info, ShieldAlert, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WizardMode, WizardConnector, WizardInstance } from "../WizardTypes";

interface StepSuccessProps {
  mode: WizardMode;
  connector: WizardConnector | null;
  instance: WizardInstance | null;
  routingConfigured: boolean;
  e2eResult: any;
  instanceCoverageCount: number | null;
  readinessResult?: any;
}

export function StepSuccess({ mode, connector, instance, routingConfigured, e2eResult, instanceCoverageCount, readinessResult }: StepSuccessProps) {
  const navigate = useNavigate();
  const isPlatform = mode === "PLATFORM";

  const { data: secretStatus } = useQuery({
    queryKey: ["success-secret-status", instance?.id],
    queryFn: async () => {
      if (!instance?.id) return null;
      const { data } = await supabase
        .from("provider_instance_secrets")
        .select("id, is_active, key_version")
        .eq("provider_instance_id", instance.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!instance?.id,
  });

  const hasActiveSecret = !!secretStatus;
  const missingSecretWarning = isPlatform && instance && !hasActiveSecret;

  const summary = {
    connector: connector?.name || "—",
    visibility: isPlatform ? "GLOBAL" : "ORG_PRIVATE",
    instance: instance?.name || "—",
    routing: routingConfigured ? "Configurado" : "Pendiente",
    e2e: e2eResult?.sync?.ok ? "OK" : e2eResult ? "Con advertencias" : "No ejecutado",
    secret: hasActiveSecret ? `✅ activo (v${secretStatus?.key_version})` : "❌ FALTANTE",
    readiness: readinessResult?.ok ? "✅ READY" : readinessResult ? "❌ NOT READY" : "No ejecutado",
  };

  const copySummary = () => {
    const exportData = {
      ...summary,
      evidence_bundle: readinessResult?.evidence_bundle || null,
      e2e_result: e2eResult ? { ok: e2eResult.sync?.ok, code: e2eResult.sync?.code } : null,
    };
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    toast.success("Resumen + evidence bundle copiado");
  };

  const downloadFullBundle = () => {
    if (!readinessResult?.evidence_bundle) {
      toast.error("No hay evidence bundle disponible");
      return;
    }
    const bundle = {
      wizard_summary: summary,
      evidence_bundle: readinessResult.evidence_bundle,
      e2e_result: e2eResult || null,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `provider-bundle-${connector?.key || "unknown"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Full evidence bundle descargado");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {missingSecretWarning && (
        <div className="p-4 bg-destructive/10 border-2 border-destructive/40 rounded-lg space-y-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-destructive text-base">⚠️ Secreto No Configurado</h3>
              <p className="text-sm text-destructive/80 mt-1">
                La instancia de plataforma <strong>"{instance?.name}"</strong> no tiene un secreto activo.
                El proveedor <strong>NO funcionará</strong> hasta que se configure una API Key.
              </p>
              <p className="text-xs text-destructive/60 mt-2">
                Vuelva al paso "Instancia" para configurar el secreto, o use el endpoint de administración.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="text-center space-y-4">
        <div className={`inline-flex items-center justify-center h-20 w-20 rounded-full mx-auto ${
          missingSecretWarning ? "bg-destructive/10 border-2 border-destructive/30" : "bg-primary/10 border-2 border-primary/30"
        }`}>
          {missingSecretWarning ? (
            <AlertTriangle className="h-10 w-10 text-destructive" />
          ) : (
            <CheckCircle2 className="h-10 w-10 text-primary" />
          )}
        </div>
        <h2 className="text-2xl font-display font-bold text-foreground">
          {missingSecretWarning ? "Integración Incompleta" : "¡Integración Completada!"}
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          {missingSecretWarning
            ? "La instancia fue creada pero requiere una API Key para funcionar. Configure el secreto para completar la integración."
            : isPlatform
            ? "Activado a nivel de plataforma. Se benefician todas las organizaciones automáticamente."
            : "El proveedor PRIVADO está configurado para tu organización."
          }
        </p>
        <Badge variant="outline" className={`text-xs ${isPlatform ? "border-destructive/30 text-destructive" : "border-primary/30 text-primary"}`}>
          {isPlatform ? <><Globe className="h-3 w-3 mr-1" /> Plataforma</> : <><Building2 className="h-3 w-3 mr-1" /> Solo tu Org</>}
        </Badge>
      </div>

      <Card className={`border-2 ${missingSecretWarning ? "border-destructive/30" : "border-primary/20"}`}>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Resumen</h3>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={copySummary}><Copy className="h-3 w-3 mr-1" /> JSON</Button>
              {readinessResult?.evidence_bundle && (
                <Button size="sm" variant="ghost" onClick={downloadFullBundle}><Download className="h-3 w-3 mr-1" /> Bundle</Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <span className="text-xs text-muted-foreground">Conector</span>
              <p className="text-foreground font-medium">{summary.connector}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <span className="text-xs text-muted-foreground">Visibilidad</span>
              <p className="flex items-center gap-1 text-foreground font-medium">
                {isPlatform ? <Globe className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
                {summary.visibility}
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <span className="text-xs text-muted-foreground">Instancia</span>
              <p className="text-foreground font-medium">{summary.instance}</p>
            </div>
            <div className={`rounded-lg p-3 border ${hasActiveSecret ? "bg-muted/30 border-border/50" : "bg-destructive/10 border-destructive/30"}`}>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Key className="h-3 w-3" /> Secreto
              </span>
              <p className={`font-medium ${hasActiveSecret ? "text-primary" : "text-destructive"}`}>
                {summary.secret}
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <span className="text-xs text-muted-foreground">Routing</span>
              <Badge variant="outline" className={routingConfigured ? "text-primary border-primary/30" : "text-muted-foreground"}>
                {summary.routing}
              </Badge>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <span className="text-xs text-muted-foreground">E2E</span>
              <Badge variant="outline" className={e2eResult?.sync?.ok ? "text-primary border-primary/30" : "text-muted-foreground"}>
                {summary.e2e}
              </Badge>
            </div>
            <div className={`rounded-lg p-3 border ${readinessResult?.ok ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-border/50"}`}>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" /> Readiness
              </span>
              <Badge variant="outline" className={readinessResult?.ok ? "text-primary border-primary/30" : "text-muted-foreground"}>
                {summary.readiness}
              </Badge>
            </div>
            {isPlatform && (
              <div className="bg-primary/5 rounded-lg p-3 border border-primary/20 flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                <div>
                  <span className="text-xs text-muted-foreground">Cobertura</span>
                  <p className="text-foreground font-medium text-sm">100% organizaciones — activado automáticamente</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="font-semibold text-foreground text-sm">Siguientes Pasos</h3>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(isPlatform ? "/platform/external-providers" : "/app/settings")}>
            <Settings className="h-4 w-4" /> Panel Proveedores
          </Button>
          <Button variant="outline" className="justify-start gap-2" onClick={() => navigate("/app/dashboard")}>
            <List className="h-4 w-4" /> Ir al Dashboard
          </Button>
          <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(isPlatform ? "/platform/external-providers/wizard" : "/app/settings")}>
            <Key className="h-4 w-4" /> Configurar Otro
          </Button>
          <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(isPlatform ? "/platform/external-providers/wizard" : "/app/settings")}>
            <RefreshCw className="h-4 w-4" /> Volver al Wizard
          </Button>
        </div>
      </div>

      <div className="space-y-3 text-xs">
        <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" /> Troubleshooting
        </h3>
        <div className="space-y-2 bg-muted/30 border border-border/50 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3 w-3 mt-0.5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-foreground">MISSING_PROVIDER_SECRET</p>
              <p className="text-muted-foreground">
                La instancia no tiene secreto activo. Vuelva al paso "Instancia" y configure la API Key.
                Para PLATFORM: afecta a todas las organizaciones.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3 w-3 mt-0.5 text-primary shrink-0" />
            <div>
              <p className="font-medium text-foreground">404 vs EMPTY vs PENDING</p>
              <p className="text-muted-foreground">404 = no existe. EMPTY = sin datos. PENDING = encolado.</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3 w-3 mt-0.5 text-primary shrink-0" />
            <div>
              <p className="font-medium text-foreground">DECRYPT_FAILED</p>
              <p className="text-muted-foreground">Use SET_EXACT para re-cifrar con la misma API key del proveedor. No se rota la clave de plataforma.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}