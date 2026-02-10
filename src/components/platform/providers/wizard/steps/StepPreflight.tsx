/**
 * Step 4 — Preflight Connection Test (/health + /capabilities)
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Activity, CheckCircle2, XCircle, AlertTriangle, Loader2, Copy, Terminal } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardInstance, WizardConnector, PreflightResult } from "../WizardTypes";

interface StepPreflightProps {
  instance: WizardInstance;
  connector: WizardConnector;
  preflightResult: PreflightResult | null;
  onPreflightComplete: (result: PreflightResult, passed: boolean) => void;
  onNext: () => void;
}

export function StepPreflight({ instance, connector, preflightResult, onPreflightComplete, onNext }: StepPreflightProps) {
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setTesting(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("provider-test-connection", {
        body: { provider_instance_id: instance.id },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      const result = data as PreflightResult;
      const healthOk = result.results?.health?.ok;
      onPreflightComplete(result, !!healthOk);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  };

  const healthOk = preflightResult?.results?.health?.ok;
  const capOk = preflightResult?.results?.capabilities?.ok;
  const warnings = preflightResult?.warnings || [];
  const passed = !!healthOk;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-5">
        <h2 className="text-xl font-display font-semibold text-foreground">Preflight Test</h2>

        {/* Auth Summary */}
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
            <span className="text-xs text-muted-foreground">Auth Mode</span>
            <p className="text-foreground font-mono text-sm">{instance.auth_type}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
            <span className="text-xs text-muted-foreground">Timeout</span>
            <p className="text-foreground font-mono text-sm">{instance.timeout_ms}ms</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
            <span className="text-xs text-muted-foreground">Rate Limit</span>
            <p className="text-foreground font-mono text-sm">{instance.rpm_limit} rpm</p>
          </div>
        </div>

        <Button onClick={runTest} disabled={testing} className="w-full gap-2" size="lg">
          {testing ? <><Loader2 className="h-4 w-4 animate-spin" /> Probando...</> : <><Activity className="h-4 w-4" /> Test Connection</>}
        </Button>

        {error && (
          <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4">
            <p className="text-sm text-destructive font-medium flex items-center gap-2">
              <XCircle className="h-4 w-4" /> Error de conexión
            </p>
            <p className="text-xs text-destructive/80 font-mono mt-1">{error}</p>
          </div>
        )}

        {preflightResult && (
          <div className="space-y-3">
            <div className={`rounded-lg p-4 border ${healthOk ? "bg-primary/5 border-primary/20" : "bg-destructive/5 border-destructive/20"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 font-medium text-sm">
                  {healthOk ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  /health
                </span>
                {preflightResult.results.health?.latency_ms && (
                  <Badge variant="outline" className="text-xs">{preflightResult.results.health.latency_ms}ms</Badge>
                )}
              </div>
              <pre className="text-xs text-muted-foreground bg-muted/30 rounded p-2 overflow-auto max-h-24">
                {preflightResult.results.health?.error || preflightResult.results.health?.body}
              </pre>
            </div>

            <div className={`rounded-lg p-4 border ${capOk ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-border/50"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 font-medium text-sm">
                  {capOk ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-primary" />}
                  /capabilities
                </span>
              </div>
              <pre className="text-xs text-muted-foreground bg-muted/30 rounded p-2 overflow-auto max-h-24">
                {preflightResult.results.capabilities?.error || preflightResult.results.capabilities?.body}
              </pre>
            </div>

            {warnings.length > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                <p className="text-xs font-medium text-primary flex items-center gap-1 mb-1">
                  <AlertTriangle className="h-3 w-3" /> Advertencias
                </p>
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{w.code}: {w.message}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={onNext} disabled={!passed} className="gap-2">
            {!passed && <span className="text-xs text-muted-foreground">(health debe pasar)</span>}
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Preflight Connection Test"
          whatItDoes="Llama a /health y /capabilities del proveedor para verificar que la API responde correctamente y que las credenciales son válidas."
          whyItMatters="Si /health falla, ninguna sincronización funcionará. Este test detecta problemas de red, autenticación, o configuración antes de configurar el routing."
          commonMistakes={[
            "/health 404 → la ruta no existe en el proveedor (verificar base_url)",
            "401/403 → API key incorrecta o expirada",
            "Timeout → aumentar timeout_ms o verificar estabilidad del proveedor",
          ]}
        />
      </div>
    </div>
  );
}
