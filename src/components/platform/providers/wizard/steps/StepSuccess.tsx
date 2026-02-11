/**
 * Step 8 — Success + Runbook
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Globe, Building2, RefreshCw, List, Settings, Key, Copy, AlertTriangle, Info, ArrowRight, Server } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import type { WizardMode, WizardConnector, WizardInstance } from "../WizardTypes";

interface StepSuccessProps {
  mode: WizardMode;
  connector: WizardConnector | null;
  instance: WizardInstance | null;
  routingConfigured: boolean;
  e2eResult: any;
  instanceCoverageCount: number | null;
}

export function StepSuccess({ mode, connector, instance, routingConfigured, e2eResult, instanceCoverageCount }: StepSuccessProps) {
  const navigate = useNavigate();
  const isPlatform = mode === "PLATFORM";

  const summary = {
    connector: connector?.name || "—",
    visibility: isPlatform ? "GLOBAL" : "ORG_PRIVATE",
    instance: instance?.name || "—",
    routing: routingConfigured ? "Configurado" : "Pendiente",
    e2e: e2eResult?.sync?.ok ? "OK" : e2eResult ? "Con advertencias" : "No ejecutado",
  };

  const copySummary = () => {
    navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
    toast.success("Resumen copiado");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-primary/10 border-2 border-primary/30 mx-auto">
          <CheckCircle2 className="h-10 w-10 text-primary" />
        </div>
        <h2 className="text-2xl font-display font-bold text-foreground">
          ¡Integración Completada!
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          {isPlatform
            ? "Activado a nivel de plataforma. No se requiere ninguna acción por parte de los administradores de organización ni los usuarios — se benefician de forma automática y transparente."
            : "El proveedor PRIVADO está configurado y enriquecerá los datos exclusivamente para tu organización."
          }
        </p>
        <Badge variant="outline" className={`text-xs ${isPlatform ? "border-destructive/30 text-destructive" : "border-primary/30 text-primary"}`}>
          {isPlatform ? <><Globe className="h-3 w-3 mr-1" /> Activado para toda la plataforma — sin acción de orgs</> : <><Building2 className="h-3 w-3 mr-1" /> Impacto: Solo tu Organización</>}
        </Badge>
      </div>

      {/* Summary */}
      <Card className="border-2 border-primary/20">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Resumen</h3>
            <Button size="sm" variant="ghost" onClick={copySummary}><Copy className="h-3 w-3 mr-1" /> JSON</Button>
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
            <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
              <span className="text-xs text-muted-foreground">Routing</span>
              <Badge variant="outline" className={routingConfigured ? "text-primary border-primary/30" : "text-muted-foreground"}>
                {summary.routing}
              </Badge>
            </div>
            <div className="col-span-2 bg-muted/30 rounded-lg p-3 border border-border/50">
              <span className="text-xs text-muted-foreground">E2E Validation</span>
              <Badge variant="outline" className={e2eResult?.sync?.ok ? "text-primary border-primary/30" : "text-muted-foreground"}>
                {summary.e2e}
              </Badge>
            </div>
            {isPlatform && (
              <div className="col-span-2 bg-primary/5 rounded-lg p-3 border border-primary/20 flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                <div>
                  <span className="text-xs text-muted-foreground">Cobertura</span>
                  <p className="text-foreground font-medium text-sm">
                    100% organizaciones — activado automáticamente (plataforma)
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    No se requiere acción de org admins ni usuarios.
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Next Actions */}
      <div className="space-y-3">
        <h3 className="font-semibold text-foreground text-sm">Siguientes Pasos</h3>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(isPlatform ? "/platform/external-providers/wizard" : "/app/settings")}>
            <Settings className="h-4 w-4" /> Nuevo Proveedor
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

      {/* Troubleshooting */}
      <div className="space-y-3 text-xs">
        <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" /> Troubleshooting
        </h3>
        <div className="space-y-2 bg-muted/30 border border-border/50 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3 w-3 mt-0.5 text-primary shrink-0" />
            <div>
              <p className="font-medium text-foreground">404 vs EMPTY vs PENDING</p>
              <p className="text-muted-foreground">
                404 = caso no existe en el proveedor. EMPTY = proveedor no tiene datos para ese caso. PENDING = encolado, reintente.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3 w-3 mt-0.5 text-primary shrink-0" />
            <div>
              <p className="font-medium text-foreground">SSRF / Allowlist</p>
              <p className="text-muted-foreground">
                Si cambia el dominio del proveedor, actualice la allowlist del conector. Solo HTTPS permitido.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3 w-3 mt-0.5 text-primary shrink-0" />
            <div>
              <p className="font-medium text-foreground">Signature Failures</p>
              <p className="text-muted-foreground">
                Rote el secreto si las firmas HMAC fallan consistentemente. Verifique que el proveedor usa el mismo algoritmo de hash.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
