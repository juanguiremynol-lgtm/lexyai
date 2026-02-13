/**
 * MasterDebugPanel — Unified debug console for all provider testing,
 * secret readiness, E2E flows, and Atenia AI agentic testing.
 *
 * Consolidates: ExternalProviderDebugCard, UnifiedDebugConsole,
 * EstadosDebugPanel, PublicacionesDebugCard into a single tabbed panel.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Globe,
  Server,
  FileText,
  Newspaper,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { runAteniaE2ETest, type AteniaE2ETestResult } from "@/lib/services/atenia-ai-e2e-test";

// ============= Types =============

interface StepData {
  name: string;
  ok: boolean;
  status?: string;
  detail?: any;
  duration_ms?: number;
  message?: string;
}

type WorkflowType = "CGP" | "LABORAL" | "CPACA" | "TUTELA" | "PENAL_906";

// ============= Shared StepResult Component =============

function StepResult({ step }: { step: StepData }) {
  const isOk = step.ok;
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
        <span className="font-mono text-xs">{step.name}</span>
        {step.message && (
          <span className="text-xs text-muted-foreground truncate max-w-[300px]">{step.message}</span>
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
              <pre className="text-[10px] font-mono bg-muted/50 rounded p-1.5 mt-1 max-h-32 overflow-auto">
                {JSON.stringify(step.detail, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}

// ============= Secret Readiness Tab =============

function SecretReadinessTab() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const check = async () => {
    setLoading(true);
    try {
      const { data: connectors } = await (supabase.from("provider_connectors") as any)
        .select("id, name, key")
        .eq("is_enabled", true);

      if (!connectors?.length) {
        toast.info("No hay conectores activos");
        setResults([]);
        return;
      }

      const out: any[] = [];
      for (const c of connectors) {
        try {
          const resp = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-secret-readiness?connector_id=${encodeURIComponent(c.id)}`,
            {
              headers: {
                Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
              },
            }
          );
          const data = await resp.json();
          out.push({ ...data, connector_id: c.id, connector_name: c.name });
        } catch (err: any) {
          out.push({ status: "ERROR", can_decrypt: false, connector_id: c.id, connector_name: c.name });
        }
      }
      setResults(out);
      toast.success(`Readiness checked for ${out.length} connector(s)`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Verifica el estado de secretos de todos los conectores activos</p>
        <Button variant="outline" size="sm" onClick={check} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          Verificar
        </Button>
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center justify-between p-2.5 rounded-lg border text-sm",
                r.can_decrypt ? "bg-emerald-500/10 border-emerald-500/30" : "bg-destructive/10 border-destructive/30"
              )}
            >
              <div className="flex items-center gap-2">
                {r.can_decrypt ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-destructive" />}
                <span className="font-medium">{r.connector_name || r.connector_id}</span>
                <Badge variant="outline" className="text-[10px]">{r.instance_scope || "PLATFORM"}</Badge>
              </div>
              <div className="flex items-center gap-2">
                {r.platform_key_mode && <Badge variant="secondary" className="text-[10px]">{r.platform_key_mode}</Badge>}
                <Badge variant={r.can_decrypt ? "secondary" : "destructive"} className="text-[10px]">
                  {r.can_decrypt ? "OK" : r.failure_reason || "FAIL"} {r.key_version ? `v${r.key_version}` : ""}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============= E2E Wizard Tab =============

function E2EWizardTab({ radicado }: { radicado: string }) {
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<StepData[]>([]);

  const run = async () => {
    const normalized = radicado.replace(/\D/g, "");
    if (normalized.length !== 23) { toast.error("Radicado debe ser 23 dígitos"); return; }

    setLoading(true);
    setSteps([]);
    try {
      // Find work item
      const { data: wi } = await supabase
        .from("work_items")
        .select("id, organization_id")
        .eq("radicado", normalized)
        .is("deleted_at", null)
        .maybeSingle();

      if (!wi) { toast.error(`No existe work_item con radicado ${normalized}`); return; }

      // Find connector
      const { data: connectors } = await (supabase.from("provider_connectors") as any)
        .select("id, name, key")
        .or("key.eq.SAMAI_ESTADOS,name.ilike.%samai%estados%")
        .limit(1);

      const connector = connectors?.[0];
      if (!connector) { toast.error("No se encontró conector SAMAI Estados"); return; }

      // Find instance
      const { data: instances } = await (supabase.from("provider_instances") as any)
        .select("id")
        .eq("connector_id", connector.id)
        .eq("is_enabled", true)
        .limit(1);

      const instance = instances?.[0];
      if (!instance) { toast.error("No hay instancia PLATFORM activa"); return; }

      const { data, error } = await supabase.functions.invoke("provider-wizard-run-e2e", {
        body: { work_item_id: wi.id, connector_id: connector.id, instance_id: instance.id, input_type: "RADICADO", value: normalized },
      });

      if (error) throw error;

      const wizardSteps = (data?.steps || []).map((s: any) => ({
        name: s.step || s.name,
        ok: s.status === "OK" || s.ok === true,
        status: s.status,
        detail: s.detail,
        duration_ms: s.duration_ms,
      }));
      setSteps(wizardSteps);

      if (data?.ok) toast.success("E2E Wizard completado");
      else toast.warning("E2E Wizard completado con errores");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Resolve → Sync → Trace para el radicado indicado</p>
        <Button variant="outline" size="sm" onClick={run} disabled={loading || radicado.replace(/\D/g, "").length !== 23}>
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
          Run E2E Wizard
        </Button>
      </div>
      {steps.length > 0 && (
        <div className="space-y-1">
          {steps.map((s, i) => <StepResult key={i} step={s} />)}
        </div>
      )}
    </div>
  );
}

// ============= Pipeline Debug Tab (replaces UnifiedDebugConsole) =============

function PipelineDebugTab({ radicado, workflowType }: { radicado: string; workflowType: WorkflowType }) {
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<StepData[]>([]);

  const PROVIDERS: Record<WorkflowType, { primary: string; publicaciones: boolean }> = {
    CGP: { primary: "cpnu", publicaciones: true },
    LABORAL: { primary: "cpnu", publicaciones: true },
    CPACA: { primary: "samai", publicaciones: true },
    TUTELA: { primary: "cpnu", publicaciones: false },
    PENAL_906: { primary: "cpnu", publicaciones: true },
  };

  const run = async () => {
    const normalized = radicado.replace(/\D/g, "");
    if (normalized.length !== 23) { toast.error("Radicado 23 dígitos"); return; }

    setLoading(true);
    setSteps([]);
    const config = PROVIDERS[workflowType];

    try {
      // Health
      const t1 = Date.now();
      const { data: hd, error: he } = await supabase.functions.invoke("debug-external-provider", {
        body: { provider: config.primary, action: "health" },
      });
      setSteps(s => [...s, { name: `${config.primary.toUpperCase()}_HEALTH`, ok: !he, detail: hd, duration_ms: Date.now() - t1 }]);

      // Snapshot
      const t2 = Date.now();
      const { data: sd, error: se } = await supabase.functions.invoke("debug-external-provider", {
        body: { provider: config.primary, action: "snapshot", identifier: normalized },
      });
      setSteps(s => [...s, { name: `${config.primary.toUpperCase()}_SNAPSHOT`, ok: !se && (sd?.status === 200 || sd?.status === 404), detail: sd, duration_ms: Date.now() - t2 }]);

      // DB check
      const t3 = Date.now();
      const { data: wi } = await supabase
        .from("work_items")
        .select("id, radicado, workflow_type")
        .eq("radicado", normalized)
        .limit(1);
      setSteps(s => [...s, { name: "DB_WORK_ITEM", ok: (wi?.length || 0) > 0, detail: wi?.[0], duration_ms: Date.now() - t3 }]);

      if (wi?.[0]) {
        // Actuaciones count
        const { count: actCount } = await (supabase.from("work_item_acts") as any)
          .select("id", { count: "exact", head: true })
          .eq("work_item_id", wi[0].id)
          .eq("is_archived", false);
        setSteps(s => [...s, { name: "DB_ACTUACIONES", ok: (actCount || 0) > 0, detail: { count: actCount } }]);

        // Publicaciones count
        const { count: pubCount } = await supabase
          .from("work_item_publicaciones")
          .select("id", { count: "exact", head: true })
          .eq("work_item_id", wi[0].id)
          .eq("is_archived", false);
        setSteps(s => [...s, { name: "DB_PUBLICACIONES", ok: (pubCount || 0) > 0, detail: { count: pubCount } }]);

        // Source breakdown
        const { data: srcData } = await (supabase.from("work_item_acts") as any)
          .select("source")
          .eq("work_item_id", wi[0].id)
          .eq("is_archived", false);
        const counts: Record<string, number> = {};
        for (const a of srcData || []) counts[a.source || "unknown"] = (counts[a.source || "unknown"] || 0) + 1;
        setSteps(s => [...s, { name: "SOURCE_BREAKDOWN", ok: true, detail: counts }]);
      }

      toast.success("Pipeline debug completado");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Badge variant="outline">{PROVIDERS[workflowType].primary.toUpperCase()}</Badge>
          {PROVIDERS[workflowType].publicaciones && <Badge variant="secondary">+ Publicaciones</Badge>}
        </div>
        <Button variant="outline" size="sm" onClick={run} disabled={loading || radicado.replace(/\D/g, "").length !== 23}>
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
          Ejecutar Diagnóstico
        </Button>
      </div>
      {steps.length > 0 && (
        <div className="space-y-1">
          {steps.map((s, i) => <StepResult key={i} step={s} />)}
        </div>
      )}
    </div>
  );
}

// ============= Sync Test Tab (replaces PublicacionesDebugCard + EstadosDebugPanel) =============

function SyncTestTab({ radicado }: { radicado: string }) {
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<StepData[]>([]);

  const run = async () => {
    const normalized = radicado.replace(/\D/g, "");
    if (normalized.length !== 23) { toast.error("Radicado 23 dígitos"); return; }

    setLoading(true);
    setSteps([]);

    try {
      // Find work item
      const t1 = Date.now();
      const { data: wi } = await supabase
        .from("work_items")
        .select("id, workflow_type, organization_id")
        .eq("radicado", normalized)
        .is("deleted_at", null)
        .maybeSingle();

      setSteps(s => [...s, { name: "FIND_WORK_ITEM", ok: !!wi, detail: wi || { error: "Not found" }, duration_ms: Date.now() - t1 }]);
      if (!wi) { toast.error("Work item no encontrado"); return; }

      // Sync actuaciones
      const t2 = Date.now();
      const { data: syncData, error: syncErr } = await supabase.functions.invoke("sync-by-work-item", {
        body: { work_item_id: wi.id },
      });
      setSteps(s => [...s, {
        name: "SYNC_ACTUACIONES",
        ok: !syncErr && syncData?.ok !== false,
        detail: syncErr ? { error: syncErr.message } : { provider: syncData?.provider, actuaciones: syncData?.actuaciones_count },
        duration_ms: Date.now() - t2,
      }]);

      // Sync publicaciones
      const t3 = Date.now();
      const { data: pubSync, error: pubErr } = await supabase.functions.invoke("sync-publicaciones-by-work-item", {
        body: { work_item_id: wi.id },
      });
      setSteps(s => [...s, {
        name: "SYNC_PUBLICACIONES",
        ok: !pubErr && pubSync?.ok !== false,
        detail: pubErr ? { error: pubErr.message } : { inserted: pubSync?.inserted_count, skipped: pubSync?.skipped_count },
        duration_ms: Date.now() - t3,
      }]);

      // DB verification
      const t4 = Date.now();
      const [{ count: actCount }, { count: pubCount }, { count: estadosCount }] = await Promise.all([
        (supabase.from("work_item_acts") as any).select("id", { count: "exact", head: true }).eq("work_item_id", wi.id).eq("is_archived", false),
        supabase.from("work_item_publicaciones").select("id", { count: "exact", head: true }).eq("work_item_id", wi.id).eq("is_archived", false),
        (supabase.from("work_item_acts") as any).select("id", { count: "exact", head: true }).eq("work_item_id", wi.id).eq("is_archived", false).eq("source", "SAMAI_ESTADOS"),
      ]);
      setSteps(s => [...s, {
        name: "DB_VERIFY",
        ok: (actCount || 0) > 0,
        detail: { actuaciones: actCount, publicaciones: pubCount, samai_estados: estadosCount },
        duration_ms: Date.now() - t4,
      }]);

      // Provider traces
      const t5 = Date.now();
      const { data: traces } = await (supabase.from("provider_sync_traces") as any)
        .select("stage, ok, result_code")
        .eq("work_item_id", wi.id)
        .order("created_at", { ascending: false })
        .limit(20);

      setSteps(s => [...s, {
        name: "PROVIDER_TRACES",
        ok: (traces?.length || 0) > 0,
        detail: { count: traces?.length, stages: traces?.map((t: any) => `${t.stage}:${t.ok ? "OK" : t.result_code}`) },
        duration_ms: Date.now() - t5,
      }]);

      toast.success("Sync test completado");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Ejecuta sync completo (actuaciones + publicaciones + external providers) y verifica BD
        </p>
        <Button variant="outline" size="sm" onClick={run} disabled={loading || radicado.replace(/\D/g, "").length !== 23}>
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Database className="h-4 w-4 mr-1.5" />}
          Ejecutar Sync Test
        </Button>
      </div>
      {steps.length > 0 && (
        <div className="space-y-1">
          {steps.map((s, i) => <StepResult key={i} step={s} />)}
        </div>
      )}
    </div>
  );
}

// ============= Atenia AI E2E Tab =============

function AteniaE2ETab({ radicado }: { radicado: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AteniaE2ETestResult | null>(null);

  const run = async () => {
    const normalized = radicado.replace(/\D/g, "");
    if (normalized.length !== 23) { toast.error("Radicado 23 dígitos"); return; }

    setLoading(true);
    setResult(null);
    try {
      const r = await runAteniaE2ETest({ radicado: normalized, triggered_by: "manual" });
      setResult(r);
      if (r.ok) toast.success("🤖 Atenia AI E2E: PASSED");
      else toast.warning("🤖 Atenia AI E2E: PARTIAL — ver detalles");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Atenia AI ejecuta la cadena completa: busca work item → verifica secretos → dispara sync →
        verifica traces externos → confirma datos en BD → analiza resultados. Todo queda registrado en atenia_ai_actions.
      </p>

      <Button onClick={run} disabled={loading || radicado.replace(/\D/g, "").length !== 23} className="w-full">
        {loading ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Atenia AI ejecutando E2E...</>
        ) : (
          <><Bot className="h-4 w-4 mr-2" /> 🤖 Ejecutar E2E Agéntico</>
        )}
      </Button>

      {result && (
        <div className={cn("rounded-lg border p-4 space-y-3", result.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5")}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={result.ok ? "secondary" : "destructive"}>
                {result.ok ? "✅ PASSED" : "⚠️ ISSUES"}
              </Badge>
              <span className="text-xs text-muted-foreground font-mono">{result.test_id}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                <Clock className="h-3 w-3 mr-0.5" />{result.duration_ms}ms
              </Badge>
              {result.action_id && (
                <Badge variant="outline" className="text-[10px]">action: {result.action_id.slice(0, 8)}</Badge>
              )}
            </div>
          </div>

          <div className="space-y-1">
            {result.steps.map((step, i) => (
              <StepResult key={i} step={step} />
            ))}
          </div>

          <div className="bg-muted/50 rounded p-3 text-sm whitespace-pre-line">
            <h5 className="font-medium text-xs text-muted-foreground mb-1">Análisis Atenia AI</h5>
            {result.analysis}
          </div>
        </div>
      )}
    </div>
  );
}

// ============= Main Component =============

export function MasterDebugPanel() {
  const [radicado, setRadicado] = useState("05001333300320190025200");
  const [workflowType, setWorkflowType] = useState<WorkflowType>("CPACA");

  const copyAll = () => {
    navigator.clipboard.writeText(JSON.stringify({ radicado, workflowType, timestamp: new Date().toISOString() }, null, 2));
    toast.success("Datos copiados");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Consola de Debug Unificada — Atenia AI
        </CardTitle>
        <CardDescription>
          Secret readiness, pipeline testing, sync E2E, y pruebas agénticas con Atenia AI
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Shared Inputs */}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <Label htmlFor="master-radicado" className="text-xs text-muted-foreground">
              Radicado (23 dígitos)
            </Label>
            <Input
              id="master-radicado"
              value={radicado}
              onChange={(e) => setRadicado(e.target.value.replace(/\D/g, ""))}
              placeholder="05001333300320190025200"
              maxLength={23}
              inputMode="numeric"
              className="font-mono"
            />
            {radicado.length > 0 && radicado.length !== 23 && (
              <p className="text-xs text-muted-foreground mt-1">{radicado.length}/23 dígitos</p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Tipo de Flujo</Label>
            <Select value={workflowType} onValueChange={(v) => setWorkflowType(v as WorkflowType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CGP">CGP (Civil)</SelectItem>
                <SelectItem value="LABORAL">LABORAL</SelectItem>
                <SelectItem value="CPACA">CPACA (Admin)</SelectItem>
                <SelectItem value="TUTELA">TUTELA</SelectItem>
                <SelectItem value="PENAL_906">PENAL 906</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        {/* Tabs */}
        <Tabs defaultValue="secrets" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="secrets" className="text-xs">
              <Shield className="h-3.5 w-3.5 mr-1" />
              Secretos
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="text-xs">
              <Globe className="h-3.5 w-3.5 mr-1" />
              Pipeline
            </TabsTrigger>
            <TabsTrigger value="sync" className="text-xs">
              <Database className="h-3.5 w-3.5 mr-1" />
              Sync Test
            </TabsTrigger>
            <TabsTrigger value="wizard" className="text-xs">
              <Play className="h-3.5 w-3.5 mr-1" />
              E2E Wizard
            </TabsTrigger>
            <TabsTrigger value="atenia" className="text-xs">
              <Bot className="h-3.5 w-3.5 mr-1" />
              Atenia AI
            </TabsTrigger>
          </TabsList>

          <TabsContent value="secrets" className="mt-4">
            <SecretReadinessTab />
          </TabsContent>

          <TabsContent value="pipeline" className="mt-4">
            <PipelineDebugTab radicado={radicado} workflowType={workflowType} />
          </TabsContent>

          <TabsContent value="sync" className="mt-4">
            <SyncTestTab radicado={radicado} />
          </TabsContent>

          <TabsContent value="wizard" className="mt-4">
            <E2EWizardTab radicado={radicado} />
          </TabsContent>

          <TabsContent value="atenia" className="mt-4">
            <AteniaE2ETab radicado={radicado} />
          </TabsContent>
        </Tabs>

        {/* Copy */}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={copyAll}>
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Copiar configuración
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
