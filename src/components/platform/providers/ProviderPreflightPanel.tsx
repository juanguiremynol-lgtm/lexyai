/**
 * ProviderPreflightPanel — Test connection + security checks preflight.
 * Shows /health, /capabilities, SSRF warnings, auth summary.
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Activity, Terminal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Instance {
  id: string;
  organization_id: string;
  name: string;
  base_url: string;
  auth_type: string;
  timeout_ms: number;
  rpm_limit: number;
  is_enabled: boolean;
}

interface PreflightResult {
  ok: boolean;
  results: {
    health?: { status: number; ok: boolean; latency_ms: number; body: string; error?: string };
    capabilities?: { status: number; ok: boolean; latency_ms: number; body: string; error?: string };
  };
  warnings?: Array<{ code: string; message: string; allowlist?: string[] }>;
  duration_ms: number;
}

type PreflightStatus = "NOT_CONFIGURED" | "NEEDS_REVIEW" | "READY" | "ERROR";

interface Connector {
  id: string;
  allowed_domains: string[];
  is_enabled: boolean;
}

interface ProviderPreflightPanelProps {
  instance: Instance | null;
  connector: Connector | null;
}

export function ProviderPreflightPanel({ instance, connector }: ProviderPreflightPanelProps) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    if (!instance) return;
    setTesting(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("provider-test-connection", {
        body: { provider_instance_id: instance.id },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      setResult(data as PreflightResult);
    } catch (err: any) {
      setError(err.message || "Test connection failed");
    } finally {
      setTesting(false);
    }
  };

  const getStatus = (): PreflightStatus => {
    if (!instance || !connector) return "NOT_CONFIGURED";
    // Structural gates: these must pass regardless of test results
    const allowlist = connector.allowed_domains || [];
    if (allowlist.length === 0) return "ERROR";
    let baseHost: string | null = null;
    try { baseHost = new URL(instance.base_url).hostname.toLowerCase(); } catch { /* */ }
    if (!baseHost) return "ERROR";
    const hostOk = allowlist.some((p) => {
      const pat = p.toLowerCase().trim();
      if (pat.startsWith("*.")) {
        const suffix = pat.slice(1);
        return baseHost === pat.slice(2) || baseHost!.endsWith(suffix);
      }
      return baseHost === pat;
    });
    if (!hostOk) return "ERROR";
    if (!connector.is_enabled || !instance.is_enabled) return "NEEDS_REVIEW";
    // Test result gates
    if (!result) return "NOT_CONFIGURED";
    if (error) return "ERROR";
    const warnings = result.warnings || [];
    const healthOk = result.results?.health?.ok;
    const capOk = result.results?.capabilities?.ok;
    if (!healthOk) return "ERROR";
    if (warnings.length > 0 || !capOk) return "NEEDS_REVIEW";
    return "READY";
  };

  const status = getStatus();
  const statusMap = {
    NOT_CONFIGURED: { label: "Sin probar", className: "text-slate-400 border-slate-600" },
    NEEDS_REVIEW: { label: "Advertencias", className: "text-amber-400 border-amber-500/50 bg-amber-500/10" },
    READY: { label: "✓ Listo", className: "text-emerald-400 border-emerald-500/50 bg-emerald-500/10" },
    ERROR: { label: "Error", className: "text-red-400 border-red-500/50 bg-red-500/10" },
  };

  const copyResult = () => {
    if (result) {
      navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      toast.success("Resultado copiado");
    }
  };

  if (!instance) {
    return (
      <Card className="border-slate-700 bg-slate-900/50 opacity-60">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-400" />
            C) Preflight Tests + Security Checks
          </CardTitle>
          <CardDescription>Cree una instancia primero en el panel B</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-400" />
            C) Preflight Tests + Security Checks
          </CardTitle>
          <CardDescription>Validar conectividad, auth y seguridad para: {instance.name}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={statusMap[status].className}>{statusMap[status].label}</Badge>
          {result && <Button size="sm" variant="ghost" onClick={copyResult}><Copy className="h-4 w-4" /></Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Auth summary */}
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="bg-slate-800/50 rounded p-3 border border-slate-700">
            <span className="text-slate-400">Auth Mode</span>
            <p className="text-slate-200 font-mono">{instance.auth_type}</p>
          </div>
          <div className="bg-slate-800/50 rounded p-3 border border-slate-700">
            <span className="text-slate-400">Timeout</span>
            <p className="text-slate-200 font-mono">{instance.timeout_ms}ms</p>
          </div>
          <div className="bg-slate-800/50 rounded p-3 border border-slate-700">
            <span className="text-slate-400">Rate Limit</span>
            <p className="text-slate-200 font-mono">{instance.rpm_limit} rpm</p>
          </div>
        </div>

        <Button onClick={runTest} disabled={testing} className="bg-amber-600 hover:bg-amber-700 w-full">
          {testing ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Probando conexión...</>
          ) : (
            <><Activity className="h-4 w-4 mr-2" /> Test Connection</>
          )}
        </Button>

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-400 font-medium mb-1">
              <XCircle className="h-4 w-4" /> Error de conexión
            </div>
            <p className="text-red-300 text-sm font-mono">{error}</p>
            <p className="text-red-400/70 text-xs mt-2">
              Posibles causas: allowed_domains vacío, host no en allowlist, esquema no-HTTPS, IP/localhost bloqueado, secreto inválido.
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            {/* Health */}
            <div className={`rounded-lg p-4 border ${result.results.health?.ok ? "bg-emerald-900/10 border-emerald-800/50" : "bg-red-900/10 border-red-800/50"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 font-medium">
                  {result.results.health?.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400" />
                  )}
                  /health
                </span>
                {result.results.health?.latency_ms && (
                  <Badge variant="outline" className="text-slate-400 border-slate-600 text-xs">
                    {result.results.health.latency_ms}ms
                  </Badge>
                )}
              </div>
              {result.results.health?.error ? (
                <p className="text-sm text-red-300 font-mono">{result.results.health.error}</p>
              ) : (
                <pre className="text-xs text-slate-300 bg-slate-800/50 rounded p-2 overflow-auto max-h-32">
                  {result.results.health?.body}
                </pre>
              )}
            </div>

            {/* Capabilities */}
            <div className={`rounded-lg p-4 border ${result.results.capabilities?.ok ? "bg-emerald-900/10 border-emerald-800/50" : "bg-amber-900/10 border-amber-800/50"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 font-medium">
                  {result.results.capabilities?.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                  )}
                  /capabilities
                </span>
                {result.results.capabilities?.latency_ms && (
                  <Badge variant="outline" className="text-slate-400 border-slate-600 text-xs">
                    {result.results.capabilities.latency_ms}ms
                  </Badge>
                )}
              </div>
              {result.results.capabilities?.error ? (
                <p className="text-sm text-amber-300 font-mono">{result.results.capabilities.error}</p>
              ) : (
                <pre className="text-xs text-slate-300 bg-slate-800/50 rounded p-2 overflow-auto max-h-32">
                  {result.results.capabilities?.body}
                </pre>
              )}
            </div>

            {/* Security Warnings */}
            {(result.warnings || []).length > 0 && (
              <div className="bg-amber-900/10 border border-amber-800/50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-amber-400 font-medium mb-2">
                  <AlertTriangle className="h-4 w-4" /> Advertencias de Seguridad
                </div>
                {result.warnings!.map((w, i) => (
                  <div key={i} className="mb-2 last:mb-0">
                    <Badge variant="outline" className="text-amber-400 border-amber-500/50 bg-amber-500/10 text-xs mb-1">
                      {w.code}
                    </Badge>
                    <p className="text-sm text-amber-300">{w.message}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Copy cURL block */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Terminal className="h-3 w-3" /> cURL equivalente (sin secretos)
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  onClick={() => {
                    const healthUrl = `${instance.base_url.replace(/\/$/, "")}/health`;
                    let resolvedHost = "unknown";
                    try { resolvedHost = new URL(healthUrl).hostname; } catch { /* */ }
                    const curl = [
                      `curl -X GET "${healthUrl}"`,
                      `  -H "Content-Type: application/json"`,
                      `  -H "x-atenia-org-id: ${instance.organization_id}"`,
                      instance.auth_type === "API_KEY"
                        ? `  -H "x-api-key: <REDACTED>"`
                        : `  -H "x-atenia-signature: <HMAC_REDACTED>"`,
                      ``,
                      `# Resolved host: ${resolvedHost}`,
                      `# Allowlist: [${(connector?.allowed_domains || []).join(", ")}]`,
                      `# Auth: ${instance.auth_type} | Timeout: ${instance.timeout_ms}ms`,
                    ].join(" \\\n");
                    navigator.clipboard.writeText(curl);
                    toast.success("cURL copiado al portapapeles");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <pre className="text-xs text-slate-400 font-mono overflow-auto max-h-24 whitespace-pre-wrap">
{`curl -X GET "${instance.base_url.replace(/\/$/, "")}/health" \\
  -H "Content-Type: application/json" \\
  -H "x-atenia-org-id: ${instance.organization_id}" \\
  -H "${instance.auth_type === "API_KEY" ? "x-api-key: <REDACTED>" : "x-atenia-signature: <HMAC_REDACTED>"}"
# Host: ${(() => { try { return new URL(instance.base_url).hostname; } catch { return "invalid"; } })()}
# Allowlist: [${(connector?.allowed_domains || []).join(", ")}]`}
              </pre>
            </div>

            <div className="text-xs text-slate-500 text-right">Duración total: {result.duration_ms}ms</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
