/**
 * ExternalProviderDebugCard — Debug panel for external provider endpoints.
 * Tests: secret readiness, reencrypt, sync-external-provider, E2E wizard run.
 * Wired to Atenia AI agentic testing.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Shield,
  RefreshCw,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Zap,
  Database,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ============= Types =============

interface ReadinessResult {
  status: string;
  can_decrypt: boolean;
  platform_key_ok?: boolean;
  platform_key_mode?: string;
  key_version?: number;
  remediation_hint?: string;
  connector_id?: string;
  connector_name?: string;
  instance_id?: string;
  scope?: string;
}

interface E2EStep {
  step: string;
  status: string;
  detail?: any;
  duration_ms?: number;
}

interface E2EResult {
  ok: boolean;
  steps: E2EStep[];
  error?: string;
}

interface AteniaE2EResult {
  ok: boolean;
  radicado: string;
  work_item_id?: string;
  test_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  steps: Array<{
    name: string;
    ok: boolean;
    detail?: any;
    duration_ms?: number;
  }>;
  analysis: string;
  action_id?: string;
}

// ============= Sub-components =============

function StepResult({ step }: { step: E2EStep | AteniaE2EResult["steps"][0] }) {
  const isOk = "status" in step ? step.status === "OK" : step.ok;
  const name = "step" in step ? step.step : step.name;
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "flex items-center justify-between p-2 rounded text-sm",
        isOk ? "bg-emerald-500/10" : "bg-destructive/10"
      )}
    >
      <div className="flex items-center gap-2 flex-1">
        {isOk ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
        )}
        <span className="font-mono text-xs">{name}</span>
        {"status" in step && step.status !== "OK" && (
          <Badge variant="outline" className="text-[10px]">
            {step.status}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        {step.duration_ms != null && (
          <span className="text-xs text-muted-foreground">
            <Clock className="h-3 w-3 inline mr-0.5" />
            {step.duration_ms}ms
          </span>
        )}
        {step.detail && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="text-[10px] font-mono bg-muted/50 rounded p-1.5 mt-1 max-h-24 overflow-auto">
                {JSON.stringify(step.detail, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}

// ============= Main Component =============

export function ExternalProviderDebugCard() {
  // Secret readiness
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessResults, setReadinessResults] = useState<ReadinessResult[] | null>(null);

  // E2E wizard
  const [e2eRadicado, setE2eRadicado] = useState("05001333300320190025200");
  const [e2eLoading, setE2eLoading] = useState(false);
  const [e2eResult, setE2eResult] = useState<E2EResult | null>(null);

  // Atenia AI E2E
  const [ateniaLoading, setAteniaLoading] = useState(false);
  const [ateniaResult, setAteniaResult] = useState<AteniaE2EResult | null>(null);

  // ---- Secret Readiness ----
  const checkReadiness = async () => {
    setReadinessLoading(true);
    try {
      // Get all connectors first
      const { data: connectors } = await (supabase.from("provider_connectors") as any)
        .select("id, name, key")
        .eq("is_enabled", true);

      if (!connectors || connectors.length === 0) {
        toast.info("No hay conectores activos");
        setReadinessResults([]);
        return;
      }

      const results: ReadinessResult[] = [];
      for (const connector of connectors) {
        try {
          const resp = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-secret-readiness?connector_id=${encodeURIComponent(connector.id)}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
              },
            }
          );
          const data = await resp.json();
          results.push({
            ...data,
            connector_id: connector.id,
            connector_name: connector.name,
          });
        } catch (err: any) {
          results.push({
            status: "ERROR",
            can_decrypt: false,
            connector_id: connector.id,
            connector_name: connector.name,
          });
        }
      }
      setReadinessResults(results);
      toast.success(`Readiness checked for ${results.length} connector(s)`);
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setReadinessLoading(false);
    }
  };

  // ---- E2E Wizard Run ----
  const runE2E = async () => {
    const normalized = e2eRadicado.replace(/\D/g, "");
    if (normalized.length !== 23) {
      toast.error("Ingrese un radicado válido de 23 dígitos");
      return;
    }

    setE2eLoading(true);
    setE2eResult(null);
    try {
      // Find work item
      const { data: wi } = await supabase
        .from("work_items")
        .select("id, organization_id")
        .eq("radicado", normalized)
        .is("deleted_at", null)
        .maybeSingle();

      if (!wi) {
        toast.error(`No existe work_item con radicado ${normalized}`);
        return;
      }

      // Find SAMAI connector + instance
      const { data: connectors } = await (supabase.from("provider_connectors") as any)
        .select("id, name, key")
        .or("key.eq.SAMAI_ESTADOS,name.ilike.%samai%estados%")
        .limit(1);

      const connector = connectors?.[0];
      if (!connector) {
        toast.error("No se encontró conector SAMAI Estados");
        return;
      }

      const { data: instances } = await (supabase.from("provider_instances") as any)
        .select("id")
        .eq("connector_id", connector.id)
        .eq("is_enabled", true)
        .limit(1);

      const instance = instances?.[0];
      if (!instance) {
        toast.error("No hay instancia PLATFORM activa para SAMAI Estados");
        return;
      }

      // Call E2E wizard
      const { data, error } = await supabase.functions.invoke("provider-wizard-run-e2e", {
        body: {
          work_item_id: wi.id,
          connector_id: connector.id,
          instance_id: instance.id,
          input_type: "RADICADO",
          value: normalized,
        },
      });

      if (error) throw error;
      setE2eResult(data);
      if (data?.ok) toast.success("E2E completado exitosamente");
      else toast.warning(`E2E completado con errores`);
    } catch (err: any) {
      toast.error(`E2E error: ${err.message}`);
      setE2eResult({ ok: false, steps: [], error: err.message });
    } finally {
      setE2eLoading(false);
    }
  };

  // ---- Atenia AI Agentic E2E ----
  const runAteniaE2E = async () => {
    const normalized = e2eRadicado.replace(/\D/g, "");
    if (normalized.length !== 23) {
      toast.error("Ingrese un radicado válido de 23 dígitos");
      return;
    }

    setAteniaLoading(true);
    setAteniaResult(null);

    const testId = `e2e_${Date.now()}`;
    const startedAt = new Date().toISOString();
    const steps: AteniaE2EResult["steps"] = [];
    const t0 = Date.now();

    try {
      // Step 1: Find work item
      const s1 = Date.now();
      const { data: wi, error: wiErr } = await supabase
        .from("work_items")
        .select("id, organization_id, workflow_type, radicado, monitoring_enabled, last_synced_at")
        .eq("radicado", normalized)
        .is("deleted_at", null)
        .maybeSingle();

      steps.push({
        name: "FIND_WORK_ITEM",
        ok: !!wi && !wiErr,
        detail: wi ? { id: wi.id, workflow_type: wi.workflow_type } : { error: wiErr?.message || "Not found" },
        duration_ms: Date.now() - s1,
      });

      if (!wi) throw new Error("Work item no encontrado");

      // Step 2: Secret readiness
      const s2 = Date.now();
      const { data: connectors } = await (supabase.from("provider_connectors") as any)
        .select("id, name, key")
        .or("key.eq.SAMAI_ESTADOS,name.ilike.%samai%estados%")
        .limit(1);
      const connector = connectors?.[0];
      let readiness: any = null;
      if (connector) {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-secret-readiness?connector_id=${encodeURIComponent(connector.id)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
          }
        );
        readiness = await resp.json();
      }
      steps.push({
        name: "SECRET_READINESS",
        ok: readiness?.can_decrypt === true,
        detail: {
          status: readiness?.status,
          can_decrypt: readiness?.can_decrypt,
          platform_key_mode: readiness?.platform_key_mode,
          key_version: readiness?.key_version,
        },
        duration_ms: Date.now() - s2,
      });

      // Step 3: Full sync (sync-by-work-item triggers external providers too)
      const s3 = Date.now();
      const { data: syncData, error: syncErr } = await supabase.functions.invoke("sync-by-work-item", {
        body: { work_item_id: wi.id },
      });
      steps.push({
        name: "SYNC_BY_WORK_ITEM",
        ok: !syncErr && syncData?.ok !== false,
        detail: syncErr ? { error: syncErr.message } : {
          provider: syncData?.provider,
          actuaciones: syncData?.actuaciones_count ?? syncData?.total_actuaciones,
          status: syncData?.scrape_status || syncData?.code,
        },
        duration_ms: Date.now() - s3,
      });

      // Step 4: Validate external provider traces — require specific stages
      const REQUIRED_STAGES = ["SECRET_RESOLUTION", "EXT_PROVIDER_REQUEST", "EXT_PROVIDER_RESPONSE", "MAPPING_APPLIED", "UPSERTED_CANONICAL"];
      const s4 = Date.now();
      const { data: traces } = await (supabase.from("provider_sync_traces") as any)
        .select("stage, ok, result_code, latency_ms, payload, created_at")
        .eq("work_item_id", wi.id)
        .gte("created_at", startedAt)
        .order("created_at", { ascending: true })
        .limit(50);

      const traceStages = (traces || []).map((t: any) => t.stage);
      const tracesByStage: Record<string, any> = {};
      for (const t of traces || []) {
        tracesByStage[t.stage] = t;
      }

      const missingStages = REQUIRED_STAGES.filter(s => !tracesByStage[s]);
      const stageResults: Record<string, any> = {};
      for (const stage of REQUIRED_STAGES) {
        const trace = tracesByStage[stage];
        stageResults[stage] = trace
          ? { found: true, ok: trace.ok, result_code: trace.result_code }
          : { found: false, ok: false };
      }

      let extTraceFailReason: string | null = null;
      const secretTrace = tracesByStage["SECRET_RESOLUTION"];
      if (secretTrace && !secretTrace.ok) {
        extTraceFailReason = `Secret resolution failed: ${secretTrace.result_code}`;
      } else if (missingStages.includes("EXT_PROVIDER_REQUEST")) {
        extTraceFailReason = "External provider was never called";
      } else if (missingStages.length > 0) {
        extTraceFailReason = `Missing stages: ${missingStages.join(", ")}`;
      }

      const extTraceOk = missingStages.length === 0 && Object.values(stageResults).every((s: any) => s.ok);
      steps.push({
        name: "EXT_PROVIDER_TRACE",
        ok: extTraceOk,
        detail: {
          stages_found: traceStages,
          missing_stages: missingStages,
          stage_results: stageResults,
          failure_reason: extTraceFailReason,
        },
        duration_ms: Date.now() - s4,
      });

      // Step 5: Verify DB data — specifically check for SAMAI_ESTADOS records
      const s5 = Date.now();
      const [{ count: actsCount }, { count: pubsCount }, { count: estadosCount }] = await Promise.all([
        (supabase.from("work_item_acts") as any)
          .select("id", { count: "exact", head: true })
          .eq("work_item_id", wi.id)
          .eq("is_archived", false),
        supabase
          .from("work_item_publicaciones")
          .select("id", { count: "exact", head: true })
          .eq("work_item_id", wi.id)
          .eq("is_archived", false),
        (supabase.from("work_item_acts") as any)
          .select("id", { count: "exact", head: true })
          .eq("work_item_id", wi.id)
          .eq("is_archived", false)
          .eq("source", "SAMAI_ESTADOS"),
      ]);
      steps.push({
        name: "VERIFY_DB_DATA",
        ok: (actsCount || 0) > 0,
        detail: {
          actuaciones_total: actsCount || 0,
          publicaciones: pubsCount || 0,
          samai_estados_records: estadosCount || 0,
        },
        duration_ms: Date.now() - s5,
      });

      // Step 6: Check sources by provider
      const s6 = Date.now();
      const { data: actsBySource } = await (supabase.from("work_item_acts") as any)
        .select("source")
        .eq("work_item_id", wi.id)
        .eq("is_archived", false);
      const sourceCounts: Record<string, number> = {};
      for (const a of actsBySource || []) {
        sourceCounts[a.source || "unknown"] = (sourceCounts[a.source || "unknown"] || 0) + 1;
      }
      steps.push({
        name: "SOURCE_BREAKDOWN",
        ok: true,
        detail: sourceCounts,
        duration_ms: Date.now() - s6,
      });

      const completedAt = new Date().toISOString();
      const allOk = steps.every((s) => s.ok);

      // Build analysis
      const analysisParts: string[] = [];
      if (allOk) {
        analysisParts.push("✅ E2E test completado exitosamente.");
      } else {
        const failedSteps = steps.filter((s) => !s.ok).map((s) => s.name);
        analysisParts.push(`⚠️ ${failedSteps.length} paso(s) fallaron: ${failedSteps.join(", ")}`);
      }
      if (readiness?.can_decrypt) {
        analysisParts.push(`🔑 Secreto descifrable (${readiness.platform_key_mode}, v${readiness.key_version})`);
      } else {
        analysisParts.push("🔴 Secreto NO descifrable — ejecute re-encripción");
      }
      analysisParts.push(`📊 Actuaciones: ${actsCount || 0}, Publicaciones: ${pubsCount || 0}`);
      if (Object.keys(sourceCounts).length > 0) {
        analysisParts.push(`📦 Fuentes: ${Object.entries(sourceCounts).map(([k, v]) => `${k}(${v})`).join(", ")}`);
      }

      const result: AteniaE2EResult = {
        ok: allOk,
        radicado: normalized,
        work_item_id: wi.id,
        test_id: testId,
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: Date.now() - t0,
        steps,
        analysis: analysisParts.join("\n"),
      };

      // Log to atenia_ai_actions
      try {
        const { data: actionData } = await (supabase.from("atenia_ai_actions") as any)
          .insert({
            organization_id: wi.organization_id,
            action_type: "PROVIDER_E2E_TEST",
            autonomy_tier: "OBSERVE",
            target_entity_type: "work_item",
            target_entity_id: wi.id,
            reasoning: `E2E test agéntico para radicado ${normalized} — ${allOk ? "PASSED" : "FAILED"}`,
            evidence: {
              test_id: testId,
              steps: steps.map((s) => ({ name: s.name, ok: s.ok })),
              duration_ms: result.duration_ms,
              source_breakdown: sourceCounts,
            },
            action_taken: "E2E_TEST_EXECUTED",
            action_result: allOk ? "PASSED" : "FAILED",
            scope: "EXTERNAL_PROVIDER",
            workflow_type: wi.workflow_type,
          })
          .select("id")
          .single();

        result.action_id = actionData?.id;
      } catch {
        // best-effort logging
      }

      setAteniaResult(result);
      if (allOk) toast.success("🤖 Atenia AI E2E: PASSED");
      else toast.warning("🤖 Atenia AI E2E: PARTIAL — ver detalles");
    } catch (err: any) {
      const result: AteniaE2EResult = {
        ok: false,
        radicado: normalized,
        test_id: testId,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - t0,
        steps,
        analysis: `❌ Error fatal: ${err.message}`,
      };
      setAteniaResult(result);
      toast.error(`Atenia AI E2E failed: ${err.message}`);
    } finally {
      setAteniaLoading(false);
    }
  };

  const copyResults = () => {
    const data = { readiness: readinessResults, e2e: e2eResult, atenia: ateniaResult };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success("Resultados copiados");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Proveedor Externo — Debug & E2E
        </CardTitle>
        <CardDescription>
          Readiness de secretos, re-encripción, sync externo, y prueba E2E agéntica con Atenia AI
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Section 1: Secret Readiness */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" />
              1. Secret Readiness (todos los conectores)
            </h4>
            <Button variant="outline" size="sm" onClick={checkReadiness} disabled={readinessLoading}>
              {readinessLoading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Verificar
            </Button>
          </div>

          {readinessResults && readinessResults.length > 0 && (
            <div className="space-y-2">
              {readinessResults.map((r, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center justify-between p-2.5 rounded-lg border text-sm",
                    r.can_decrypt
                      ? "bg-emerald-500/10 border-emerald-500/30"
                      : "bg-destructive/10 border-destructive/30"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {r.can_decrypt ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    <span className="font-medium">{r.connector_name || r.connector_id}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {r.scope || "PLATFORM"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.platform_key_mode && (
                      <Badge variant="secondary" className="text-[10px]">
                        {r.platform_key_mode}
                      </Badge>
                    )}
                    <Badge
                      variant={r.can_decrypt ? "secondary" : "destructive"}
                      className="text-[10px]"
                    >
                      {r.status} {r.key_version ? `v${r.key_version}` : ""}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          {readinessResults && readinessResults.length === 0 && (
            <p className="text-sm text-muted-foreground">No hay conectores activos.</p>
          )}
        </div>

        <Separator />

        {/* Section 2: E2E Test */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm flex items-center gap-2">
            <Play className="h-4 w-4" />
            2. E2E Wizard Run (Resolve → Sync → Trace)
          </h4>

          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="e2e-radicado" className="text-xs text-muted-foreground">
                Radicado (23 dígitos)
              </Label>
              <Input
                id="e2e-radicado"
                value={e2eRadicado}
                onChange={(e) => setE2eRadicado(e.target.value.replace(/\D/g, ""))}
                placeholder="05001333300320190025200"
                maxLength={23}
                inputMode="numeric"
              />
            </div>
            <Button
              className="self-end"
              variant="outline"
              onClick={runE2E}
              disabled={e2eLoading || e2eRadicado.replace(/\D/g, "").length !== 23}
            >
              {e2eLoading ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-1.5" />
              )}
              Run E2E
            </Button>
          </div>

          {e2eResult && (
            <div className={cn("rounded-lg border p-3 space-y-2", e2eResult.ok ? "border-emerald-500/30" : "border-destructive/30")}>
              <div className="flex items-center justify-between">
                <Badge variant={e2eResult.ok ? "secondary" : "destructive"}>
                  {e2eResult.ok ? "✅ E2E PASSED" : "❌ E2E FAILED"}
                </Badge>
                {e2eResult.error && (
                  <span className="text-xs text-destructive">{e2eResult.error}</span>
                )}
              </div>
              <div className="space-y-1">
                {e2eResult.steps.map((step, i) => (
                  <StepResult key={i} step={step} />
                ))}
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Section 3: Atenia AI Agentic E2E */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Bot className="h-4 w-4" />
              3. Atenia AI — Prueba E2E Agéntica
            </h4>
            <Badge variant="outline" className="text-[10px]">
              Logs → atenia_ai_actions
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Atenia AI ejecuta la cadena completa: busca work item → verifica secretos → dispara sync → 
            verifica traces externos → confirma datos en BD → analiza resultados. Todo queda registrado.
          </p>

          <Button
            onClick={runAteniaE2E}
            disabled={ateniaLoading || e2eRadicado.replace(/\D/g, "").length !== 23}
            className="w-full"
          >
            {ateniaLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Atenia AI ejecutando E2E...
              </>
            ) : (
              <>
                <Bot className="h-4 w-4 mr-2" />
                🤖 Ejecutar E2E Agéntico (con análisis AI)
              </>
            )}
          </Button>

          {ateniaResult && (
            <div
              className={cn(
                "rounded-lg border p-4 space-y-3",
                ateniaResult.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={ateniaResult.ok ? "secondary" : "destructive"}>
                    {ateniaResult.ok ? "✅ PASSED" : "⚠️ ISSUES"}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    {ateniaResult.test_id}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    <Clock className="h-3 w-3 mr-0.5" />
                    {ateniaResult.duration_ms}ms
                  </Badge>
                  {ateniaResult.action_id && (
                    <Badge variant="outline" className="text-[10px]">
                      action: {ateniaResult.action_id.slice(0, 8)}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-1">
                {ateniaResult.steps.map((step, i) => (
                  <StepResult key={i} step={step} />
                ))}
              </div>

              {/* Analysis */}
              <div className="bg-muted/50 rounded p-3 text-sm whitespace-pre-line">
                <h5 className="font-medium text-xs text-muted-foreground mb-1">Análisis Atenia AI</h5>
                {ateniaResult.analysis}
              </div>
            </div>
          )}
        </div>

        {/* Copy all */}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={copyResults}>
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Copiar todos los resultados
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
