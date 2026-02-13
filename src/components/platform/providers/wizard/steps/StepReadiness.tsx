/**
 * Step 8 — Readiness Gate (mandatory pre-activation check).
 * Blocks progression to Success/Activation until all checks pass.
 * Produces an exportable evidence bundle (Markdown + JSON).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowRight, ShieldCheck, CheckCircle2, XCircle, AlertTriangle,
  Loader2, Copy, Download, RefreshCw, KeyRound, Route, Database,
  Shield, Globe, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useWizardSessionContext } from "../WizardSessionContext";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardConnector, WizardInstance } from "../WizardTypes";

interface CheckResult {
  check: string;
  status: "PASS" | "FAIL" | "WARN";
  detail: string;
  remediation?: string;
}

interface ReadinessResult {
  ok: boolean;
  has_warnings: boolean;
  checks: CheckResult[];
  evidence_bundle: {
    generated_at: string;
    connector?: { id: string; key: string; name: string };
    instance?: { id: string; name: string; scope: string; auth_type: string };
    secret?: { ok: boolean; key_version?: number; scope?: string; platform_key_mode?: string; failure_reason?: string; detail?: string };
    routes?: Array<{ workflow: string; scope: string; route_kind: string; priority: number; subchains: string[] }>;
    checks_summary: { total: number; pass: number; warn: number; fail: number };
    checks: CheckResult[];
    remediation_hints: string[];
  };
  remediation_hints: string[];
}

interface StepReadinessProps {
  connector: WizardConnector;
  instance: WizardInstance;
  organizationId: string | null;
  readinessResult: ReadinessResult | null;
  onReadinessComplete: (result: ReadinessResult, passed: boolean) => void;
  onNext: () => void;
}

const CHECK_ICONS: Record<string, React.ElementType> = {
  CONNECTOR_EXISTS: Shield,
  INSTANCE_EXISTS: Database,
  INSTANCE_UNIQUE: Database,
  INSTANCE_ENABLED: Database,
  SECRET_ACTIVE: KeyRound,
  SECRET_DECRYPT: KeyRound,
  ROUTE_EXISTS: Route,
  COMPATIBILITY_GATE: Zap,
  SUBCHAIN_MAPPING: Route,
  COVERAGE_POSITION: Globe,
  RLS_ACT_PROVENANCE: Shield,
  PLATFORM_KEY: KeyRound,
};

const CHECK_LABELS: Record<string, string> = {
  CONNECTOR_EXISTS: "Conector existe",
  INSTANCE_EXISTS: "Instancia existe",
  INSTANCE_UNIQUE: "Instancia única",
  INSTANCE_ENABLED: "Instancia habilitada",
  SECRET_ACTIVE: "Secreto activo",
  SECRET_DECRYPT: "Descifrado OK",
  ROUTE_EXISTS: "Rutas configuradas",
  COMPATIBILITY_GATE: "Compatibilidad",
  SUBCHAIN_MAPPING: "Mapeo subcadena",
  COVERAGE_POSITION: "Posición en coverage",
  RLS_ACT_PROVENANCE: "RLS provenance",
  PLATFORM_KEY: "Clave plataforma",
};

function statusBadge(status: string) {
  switch (status) {
    case "PASS":
      return <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />PASS</Badge>;
    case "FAIL":
      return <Badge variant="destructive" className="text-[10px]"><XCircle className="h-3 w-3 mr-1" />FAIL</Badge>;
    case "WARN":
      return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px]"><AlertTriangle className="h-3 w-3 mr-1" />WARN</Badge>;
    default:
      return null;
  }
}

function generateMarkdownBundle(result: ReadinessResult): string {
  const b = result.evidence_bundle;
  const lines: string[] = [
    `# Provider Readiness Evidence Bundle`,
    `**Generated:** ${b.generated_at}`,
    `**Status:** ${result.ok ? "✅ READY" : "❌ NOT READY"}${result.has_warnings ? " (with warnings)" : ""}`,
    ``,
  ];

  if (b.connector) {
    lines.push(`## Connector`, `- **Name:** ${b.connector.name}`, `- **Key:** ${b.connector.key}`, ``);
  }
  if (b.instance) {
    lines.push(`## Instance`, `- **Name:** ${b.instance.name}`, `- **Scope:** ${b.instance.scope}`, `- **Auth:** ${b.instance.auth_type}`, ``);
  }
  if (b.secret) {
    lines.push(`## Secret`, b.secret.ok
      ? `- ✅ Active (v${b.secret.key_version}, scope=${b.secret.scope}, key_mode=${b.secret.platform_key_mode})`
      : `- ❌ ${b.secret.failure_reason}: ${b.secret.detail}`, ``);
  }
  if (b.routes && b.routes.length > 0) {
    lines.push(`## Routes`);
    for (const r of b.routes) {
      lines.push(`- ${r.workflow}/${r.scope} — ${r.route_kind} (priority ${r.priority}) → subchains: ${r.subchains.join(", ")}`);
    }
    lines.push(``);
  }

  lines.push(`## Checks Summary`, `| Total | Pass | Warn | Fail |`, `|-------|------|------|------|`,
    `| ${b.checks_summary.total} | ${b.checks_summary.pass} | ${b.checks_summary.warn} | ${b.checks_summary.fail} |`, ``);

  lines.push(`## Check Details`);
  for (const c of b.checks) {
    const icon = c.status === "PASS" ? "✅" : c.status === "FAIL" ? "❌" : "⚠️";
    lines.push(`- ${icon} **${c.check}**: ${c.detail}`);
    if (c.remediation) lines.push(`  - 💡 ${c.remediation}`);
  }

  if (b.remediation_hints.length > 0) {
    lines.push(``, `## Remediation Hints`);
    for (const h of b.remediation_hints) lines.push(`- ${h}`);
  }

  return lines.join("\n");
}

export function StepReadiness({ connector, instance, organizationId, readinessResult, onReadinessComplete, onNext }: StepReadinessProps) {
  const { invokeWithSession } = useWizardSessionContext();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runReadiness = async () => {
    setRunning(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await invokeWithSession("provider-wizard-readiness", {
        body: {
          connector_id: connector.id,
          instance_id: instance.id,
          organization_id: organizationId,
        },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      const result = data as ReadinessResult;
      onReadinessComplete(result, result.ok);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const copyJSON = () => {
    if (!readinessResult) return;
    navigator.clipboard.writeText(JSON.stringify(readinessResult.evidence_bundle, null, 2));
    toast.success("Evidence bundle JSON copiado");
  };

  const downloadMarkdown = () => {
    if (!readinessResult) return;
    const md = generateMarkdownBundle(readinessResult);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `readiness-${connector.key}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Evidence bundle descargado");
  };

  const passed = readinessResult?.ok === true;
  const summary = readinessResult?.evidence_bundle.checks_summary;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-5">
        <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Readiness Gate
        </h2>

        <div className="flex items-start gap-2 text-xs bg-primary/5 border border-primary/20 rounded-lg p-3">
          <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
          <span className="text-foreground/80">
            Este paso verifica <strong>todas</strong> las condiciones necesarias antes de activar el proveedor:
            secreto, routing, compatibilidad, RLS, y posición en la cadena. No se puede omitir.
          </span>
        </div>

        {/* Run button */}
        <Button onClick={runReadiness} disabled={running} className="w-full gap-2" size="lg">
          {running ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Verificando…</>
          ) : readinessResult ? (
            <><RefreshCw className="h-4 w-4" /> Re-verificar</>
          ) : (
            <><ShieldCheck className="h-4 w-4" /> Ejecutar Readiness Gate</>
          )}
        </Button>

        {error && (
          <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4">
            <p className="text-sm text-destructive font-medium flex items-center gap-2">
              <XCircle className="h-4 w-4" /> Error
            </p>
            <p className="text-xs text-destructive/80 font-mono mt-1">{error}</p>
          </div>
        )}

        {/* Results */}
        {readinessResult && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className={`rounded-lg p-4 border-2 ${
              passed ? "bg-primary/5 border-primary/30" : "bg-destructive/5 border-destructive/30"
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {passed ? (
                    <CheckCircle2 className="h-6 w-6 text-primary" />
                  ) : (
                    <XCircle className="h-6 w-6 text-destructive" />
                  )}
                  <div>
                    <p className="font-semibold text-foreground">
                      {passed ? "✅ READY — Todas las verificaciones pasaron" : "❌ NOT READY — Hay verificaciones fallidas"}
                    </p>
                    {summary && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {summary.pass} pass · {summary.warn} warn · {summary.fail} fail — {summary.total} total
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={copyJSON} title="Copiar JSON">
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={downloadMarkdown} title="Descargar Markdown">
                    <Download className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Check details */}
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-2">
                {readinessResult.checks.map((check, i) => {
                  const Icon = CHECK_ICONS[check.check] || Shield;
                  return (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 ${
                        check.status === "FAIL" ? "bg-destructive/5 border-destructive/20" :
                        check.status === "WARN" ? "bg-amber-500/5 border-amber-500/20" :
                        "bg-card border-border/50"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-medium text-foreground">
                              {CHECK_LABELS[check.check] || check.check}
                            </span>
                            {statusBadge(check.status)}
                          </div>
                          <p className="text-[11px] text-muted-foreground break-all">{check.detail}</p>
                          {check.remediation && (
                            <p className="text-[11px] text-amber-600 mt-1 flex items-start gap-1">
                              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                              {check.remediation}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Remediation hints */}
            {readinessResult.remediation_hints.length > 0 && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 space-y-1">
                <p className="text-xs font-medium text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Acciones requeridas
                </p>
                {readinessResult.remediation_hints.map((h, i) => (
                  <p key={i} className="text-[11px] text-muted-foreground">• {h}</p>
                ))}
              </div>
            )}

            {/* Routes visualization */}
            {readinessResult.evidence_bundle.routes && readinessResult.evidence_bundle.routes.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <Route className="h-3.5 w-3.5 text-primary" /> Rutas configuradas
                </h4>
                <div className="grid gap-2">
                  {readinessResult.evidence_bundle.routes.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-muted/30 rounded-lg p-2 border border-border/50">
                      <Badge variant="outline" className="text-[10px]">{r.workflow}</Badge>
                      <Badge variant="outline" className="text-[10px]">{r.scope}</Badge>
                      <Badge className={`text-[10px] ${r.route_kind === "PRIMARY" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                        {r.route_kind}
                      </Badge>
                      <span className="text-muted-foreground">→</span>
                      {r.subchains.map(sc => (
                        <Badge key={sc} variant="secondary" className="text-[10px]">{sc}</Badge>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={onNext} disabled={!passed} className="gap-2">
            {!passed && <span className="text-xs text-muted-foreground">(debe pasar)</span>}
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Readiness Gate"
          whatItDoes="Verifica todas las condiciones para activar el proveedor: secreto descifrable, rutas configuradas, compatibilidad con workflows, permisos RLS, y posición en la cadena de enriquecimiento."
          whyItMatters="Sin esta verificación, el proveedor podría activarse con secretos corruptos, rutas mal configuradas, o permisos insuficientes — causando fallos silenciosos en producción."
          commonMistakes={[
            "SECRET_DECRYPT FAIL → usar SET_EXACT para re-cifrar (no rota la key del proveedor)",
            "ROUTE_EXISTS FAIL → volver al paso Routing y configurar al menos una ruta",
            "COMPATIBILITY_GATE FAIL → el scope declarado no es compatible con el workflow",
            "RLS FAIL → los usuarios no verán las insignias de provenance en la UI",
          ]}
        />
      </div>
    </div>
  );
}
