/**
 * MasterDebugPanel — Unified debug console for all provider testing,
 * secret readiness, E2E flows, and Atenia AI agentic testing.
 *
 * Supports ALL workflow types and dynamically discovered external providers
 * (registered via the External Provider Integration Wizard).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Shield,
  RefreshCw,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Zap,
  Database,
  Bot,
  Globe,
  Server,
  Cable,
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

type WorkflowType = "CGP" | "LABORAL" | "CPACA" | "TUTELA" | "PENAL_906" | "PROCESO_ADMINISTRATIVO" | "PETICIONES";

interface ConnectorInfo {
  id: string;
  name: string;
  key: string;
  scope: string;
  capabilities: string[];
  is_enabled: boolean;
  is_builtin?: boolean;
}

// All workflow types supported by the platform
const ALL_WORKFLOW_OPTIONS: { value: WorkflowType; label: string; description: string }[] = [
  { value: "CGP", label: "CGP (Civil/Familia)", description: "CPNU primario, sin fallback SAMAI" },
  { value: "LABORAL", label: "Laboral", description: "CPNU primario" },
  { value: "CPACA", label: "CPACA (Administrativo)", description: "SAMAI primario + SAMAI Estados" },
  { value: "TUTELA", label: "Tutela", description: "CPNU + Tutelas API" },
  { value: "PENAL_906", label: "Penal 906", description: "CPNU + Publicaciones" },
  { value: "PROCESO_ADMINISTRATIVO", label: "Proceso Administrativo", description: "SAMAI primario" },
  { value: "PETICIONES", label: "Peticiones", description: "CPNU primario" },
];

// Built-in provider config per workflow
const BUILTIN_PROVIDERS: Record<WorkflowType, { primary: string; secondary?: string; publicaciones: boolean }> = {
  CGP: { primary: "cpnu", publicaciones: true },
  LABORAL: { primary: "cpnu", publicaciones: true },
  CPACA: { primary: "samai", publicaciones: true },
  TUTELA: { primary: "cpnu", secondary: "tutelas", publicaciones: false },
  PENAL_906: { primary: "cpnu", secondary: "samai", publicaciones: true },
  PROCESO_ADMINISTRATIVO: { primary: "samai", publicaciones: true },
  PETICIONES: { primary: "cpnu", publicaciones: false },
};

// Built-in providers always available (not in provider_connectors table)
const BUILTIN_CONNECTORS: ConnectorInfo[] = [
  { id: "builtin-cpnu", name: "CPNU", key: "cpnu", scope: "ACTS", capabilities: ["ACTUACIONES", "CASE_METADATA"], is_enabled: true, is_builtin: true },
  { id: "builtin-samai", name: "SAMAI", key: "samai", scope: "ACTS", capabilities: ["ACTUACIONES"], is_enabled: true, is_builtin: true },
  { id: "builtin-publicaciones", name: "Publicaciones Procesales", key: "publicaciones", scope: "PUBS", capabilities: ["ESTADOS", "DOCUMENTS"], is_enabled: true, is_builtin: true },
  { id: "builtin-tutelas", name: "Tutelas", key: "tutelas", scope: "ACTS", capabilities: ["ACTUACIONES"], is_enabled: true, is_builtin: true },
  { id: "builtin-samai-estados", name: "SAMAI Estados", key: "samai_estados", scope: "PUBS", capabilities: ["ESTADOS"], is_enabled: true, is_builtin: true },
];
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

// ============= Hook: Load dynamic connectors =============

function useConnectors() {
  return useQuery({
    queryKey: ["debug-panel-connectors"],
    queryFn: async () => {
      const { data } = await (supabase.from("provider_connectors") as any)
        .select("id, name, key, scope, capabilities, is_enabled")
        .order("name");
      const dbConnectors = (data || []).map((c: any) => ({ ...c, is_builtin: false })) as ConnectorInfo[];

      // Merge built-in providers, avoiding duplicates by key
      const dbKeys = new Set(dbConnectors.map(c => c.key?.toLowerCase()));
      const merged = [
        ...BUILTIN_CONNECTORS.filter(b => !dbKeys.has(b.key.toLowerCase())),
        ...dbConnectors,
      ];
      return merged;
    },
    staleTime: 1000 * 60 * 5,
  });
}

// ============= Auto-detect: resolve connectors for workflow =============

function resolveConnectorsForWorkflow(
  workflowType: WorkflowType,
  connectors: ConnectorInfo[],
): ConnectorInfo[] {
  // Map workflow types to known connector keys that serve them
  const WORKFLOW_CONNECTOR_MAP: Record<WorkflowType, string[]> = {
    CGP: ["cpnu"],
    LABORAL: ["cpnu"],
    CPACA: ["samai", "samai_estados", "samai-estados"],
    TUTELA: ["cpnu", "tutelas", "tutelas-api"],
    PENAL_906: ["cpnu", "samai"],
    PROCESO_ADMINISTRATIVO: ["samai", "samai_estados", "samai-estados"],
    PETICIONES: ["cpnu"],
  };

  const relevantKeys = WORKFLOW_CONNECTOR_MAP[workflowType] || [];
  const matched = connectors.filter(
    (c) =>
      c.is_enabled &&
      (relevantKeys.some((k) => c.key?.toLowerCase().includes(k) || c.name?.toLowerCase().includes(k)) ||
        (c.scope === "BOTH") ||
        (workflowType === "CPACA" && c.scope === "PUBS"))
  );

  // If no match by key, return all enabled connectors as fallback
  return matched.length > 0 ? matched : connectors.filter((c) => c.is_enabled);
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

      const out: any[] = [];

      // Show built-in providers first
      for (const b of BUILTIN_CONNECTORS) {
        out.push({
          connector_id: b.id,
          connector_name: b.name,
          is_builtin: true,
          can_decrypt: true, // Built-in = no secret needed
        });
      }

      // Then check external connectors
      for (const c of connectors || []) {
        // Skip if it's a built-in duplicate
        if (BUILTIN_CONNECTORS.some(b => b.key.toLowerCase() === c.key?.toLowerCase())) continue;
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
          out.push({ ...data, connector_id: c.id, connector_name: c.name, is_builtin: false });
        } catch (err: any) {
          out.push({ status: "ERROR", can_decrypt: false, connector_id: c.id, connector_name: c.name, is_builtin: false });
        }
      }
      setResults(out);
      toast.success(`Readiness checked for ${out.length} provider(s)`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Verifica el estado de secretos de todos los proveedores</p>
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
                r.is_builtin
                  ? "bg-blue-500/10 border-blue-500/30"
                  : r.can_decrypt ? "bg-emerald-500/10 border-emerald-500/30" : "bg-destructive/10 border-destructive/30"
              )}
            >
              <div className="flex items-center gap-2">
                {r.is_builtin ? (
                  <Server className="h-4 w-4 text-blue-500" />
                ) : r.can_decrypt ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className="font-medium">{r.connector_name || r.connector_id}</span>
                {r.is_builtin ? (
                  <Badge variant="info" className="text-[10px]">BUILT-IN</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">{r.instance_scope || "PLATFORM"}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {r.is_builtin ? (
                  <span className="text-xs text-blue-400">Edge function directa — sin secreto requerido</span>
                ) : (
                  <>
                    {r.platform_key_mode && <Badge variant="secondary" className="text-[10px]">{r.platform_key_mode}</Badge>}
                    <Badge variant={r.can_decrypt ? "secondary" : "destructive"} className="text-[10px]">
                      {r.can_decrypt ? "OK" : r.failure_reason || "FAIL"} {r.key_version ? `v${r.key_version}` : ""}
                    </Badge>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============= E2E Wizard Tab — Dynamic Connector =============

function E2EWizardTab({ radicado, workflowType, resolvedConnectors }: { radicado: string; workflowType: WorkflowType; resolvedConnectors: ConnectorInfo[] }) {
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

      // Separate built-in and external connectors
      const builtinConnectors = resolvedConnectors.filter(c => c.is_builtin);
      const externalConnectors = resolvedConnectors.filter(c => !c.is_builtin);

      // ── Built-in E2E flow ──
      for (const builtin of builtinConnectors) {
        setSteps(s => [...s, {
          name: `BUILTIN_${builtin.key.toUpperCase()}_IDENTIFIED`,
          ok: true,
          detail: { type: "built-in", key: builtin.key, scope: builtin.scope },
          message: `Edge function directa`,
        }]);

        // Call the actual sync
        const t1 = Date.now();
        try {
          const { data: syncData, error: syncErr } = await supabase.functions.invoke("sync-by-work-item", {
            body: { work_item_id: wi.id },
          });
          setSteps(s => [...s, {
            name: `BUILTIN_${builtin.key.toUpperCase()}_SYNC`,
            ok: !syncErr && syncData?.ok !== false,
            detail: syncErr ? { error: syncErr.message } : {
              provider: syncData?.provider,
              actuaciones: syncData?.actuaciones_count ?? syncData?.total_actuaciones,
              status: syncData?.scrape_status || syncData?.code,
            },
            duration_ms: Date.now() - t1,
          }]);
        } catch (err: any) {
          setSteps(s => [...s, {
            name: `BUILTIN_${builtin.key.toUpperCase()}_SYNC`,
            ok: false,
            detail: { error: err.message },
            duration_ms: Date.now() - t1,
          }]);
        }
      }

      // ── External E2E flow (existing logic) ──
      for (const connector of externalConnectors) {
        setSteps(s => [...s, { name: "CONNECTOR_RESOLVED", ok: true, detail: { id: connector.id, name: connector.name, key: connector.key, type: "external" } }]);

        // Find instance
        const { data: instances } = await (supabase.from("provider_instances") as any)
          .select("id, scope")
          .eq("connector_id", connector.id)
          .eq("is_enabled", true)
          .limit(1);

        const instance = instances?.[0];
        if (!instance) {
          setSteps(s => [...s, { name: "INSTANCE_RESOLVE", ok: false, message: `No hay instancia activa para ${connector.name}` }]);
          continue;
        }

        setSteps(s => [...s, { name: "INSTANCE_RESOLVE", ok: true, detail: { id: instance.id, scope: instance.scope } }]);

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
        setSteps(s => [...s, ...wizardSteps]);
      }

      // DB verification with three-state SAMAI_ESTADOS display
      const t5 = Date.now();
      const [{ count: actCount }, { count: pubCount }] = await Promise.all([
        (supabase.from("work_item_acts") as any).select("id", { count: "exact", head: true }).eq("work_item_id", wi.id).eq("is_archived", false),
        supabase.from("work_item_publicaciones").select("id", { count: "exact", head: true }).eq("work_item_id", wi.id).eq("is_archived", false),
      ]);

      const { data: srcData } = await (supabase.from("work_item_acts") as any)
        .select("source")
        .eq("work_item_id", wi.id)
        .eq("is_archived", false);
      const counts: Record<string, number> = {};
      for (const a of srcData || []) counts[a.source || "unknown"] = (counts[a.source || "unknown"] || 0) + 1;

      // SAMAI_ESTADOS three-state: fresh inserts vs cross-validated vs no data
      const directEstadosCount = counts["SAMAI_ESTADOS"] || 0;

      // Provenance check for SAMAI_ESTADOS
      let estadosProvenanceCount = 0;
      try {
        const { data: wiActs } = await (supabase.from("work_item_acts") as any)
          .select("id")
          .eq("work_item_id", wi.id)
          .eq("is_archived", false);
        if (wiActs?.length) {
          const actIds = wiActs.map((a: any) => a.id).slice(0, 200);
          // Find SAMAI_ESTADOS instance IDs
          const { data: extInstances } = await (supabase.from("provider_instances") as any)
            .select("id")
            .eq("is_enabled", true);
          if (extInstances?.length) {
            const { count: provCount } = await (supabase.from("act_provenance") as any)
              .select("id", { count: "exact", head: true })
              .in("work_item_act_id", actIds)
              .in("provider_instance_id", extInstances.map((i: any) => i.id));
            estadosProvenanceCount = provCount || 0;
          }
        }
      } catch { /* best effort */ }

      const estadosState = directEstadosCount > 0
        ? "FRESH_INSERTS"
        : estadosProvenanceCount > 0
        ? "CROSS_VALIDATED"
        : "NO_DATA";

      setSteps(s => [...s, {
        name: "VERIFY_DB_DATA",
        ok: (actCount || 0) > 0,
        detail: {
          actuaciones_total: actCount,
          publicaciones: pubCount,
          source_breakdown: counts,
          samai_estados: {
            state: estadosState,
            fresh_inserts: directEstadosCount,
            cross_validated: Math.max(0, estadosProvenanceCount - directEstadosCount),
            total_coverage: estadosProvenanceCount,
          },
        },
        duration_ms: Date.now() - t5,
        message: estadosState === "FRESH_INSERTS"
          ? `✅ ${directEstadosCount} SAMAI_ESTADOS insertados + ${estadosProvenanceCount} provenance`
          : estadosState === "CROSS_VALIDATED"
          ? `🔵 ${estadosProvenanceCount} cross-validated vía provenance (dedup healthy)`
          : "⚠️ Sin datos SAMAI_ESTADOS ni provenance",
      }]);

      toast.success("E2E Wizard completado");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const builtinNames = resolvedConnectors.filter(c => c.is_builtin).map(c => c.name);
  const externalNames = resolvedConnectors.filter(c => !c.is_builtin).map(c => c.name);
  const resolvedLabel = [
    ...builtinNames.map(n => `${n} (built-in)`),
    ...externalNames,
  ].join(", ") || "Sin proveedores";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          E2E para el radicado con: <strong>{resolvedLabel}</strong>
        </p>
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

// ============= Pipeline Debug Tab =============

function PipelineDebugTab({ radicado, workflowType, resolvedConnectors }: {
  radicado: string;
  workflowType: WorkflowType;
  resolvedConnectors: ConnectorInfo[];
}) {
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<StepData[]>([]);

  const run = async () => {
    const normalized = radicado.replace(/\D/g, "");
    if (normalized.length !== 23) { toast.error("Radicado 23 dígitos"); return; }

    setLoading(true);
    setSteps([]);
    const config = BUILTIN_PROVIDERS[workflowType];

    try {
      // Built-in provider: Health
      const t1 = Date.now();
      const { data: hd, error: he } = await supabase.functions.invoke("debug-external-provider", {
        body: { provider: config.primary, action: "health" },
      });
      setSteps(s => [...s, { name: `${config.primary.toUpperCase()}_HEALTH`, ok: !he, detail: hd, duration_ms: Date.now() - t1 }]);

      // Built-in provider: Snapshot
      const t2 = Date.now();
      const { data: sd, error: se } = await supabase.functions.invoke("debug-external-provider", {
        body: { provider: config.primary, action: "snapshot", identifier: normalized },
      });
      setSteps(s => [...s, { name: `${config.primary.toUpperCase()}_SNAPSHOT`, ok: !se && (sd?.status === 200 || sd?.status === 404), detail: sd, duration_ms: Date.now() - t2 }]);

      // Secondary built-in (if any)
      if (config.secondary) {
        const t2b = Date.now();
        const { data: sd2, error: se2 } = await supabase.functions.invoke("debug-external-provider", {
          body: { provider: config.secondary, action: "health" },
        });
        setSteps(s => [...s, { name: `${config.secondary!.toUpperCase()}_HEALTH`, ok: !se2, detail: sd2, duration_ms: Date.now() - t2b }]);
      }

      // External provider test — only non-built-in connectors
      const extConnectors = resolvedConnectors.filter(c => !c.is_builtin);

      for (const connector of extConnectors) {
        const t3 = Date.now();
        const { data: instances } = await (supabase.from("provider_instances") as any)
          .select("id")
          .eq("connector_id", connector.id)
          .eq("is_enabled", true)
          .limit(1);

        const instance = instances?.[0];
        if (instance) {
          const { data: extData, error: extErr } = await supabase.functions.invoke("provider-sync-external-provider", {
            body: { work_item_id: null, connector_id: connector.id, instance_id: instance.id, radicado: normalized, dry_run: true },
          });
          setSteps(s => [...s, {
            name: `EXT_${connector.key || connector.name}_PROBE`,
            ok: !extErr && extData?.ok !== false,
            detail: extErr ? { error: extErr.message } : extData,
            duration_ms: Date.now() - t3,
            message: extErr ? extErr.message : `${extData?.stage || "OK"}`,
          }]);
        } else {
          setSteps(s => [...s, { name: `EXT_${connector.key}_INSTANCE`, ok: false, message: "No hay instancia activa", duration_ms: Date.now() - t3 }]);
        }
      }

      // DB check
      const t4 = Date.now();
      const { data: wi } = await supabase
        .from("work_items")
        .select("id, radicado, workflow_type")
        .eq("radicado", normalized)
        .limit(1);
      setSteps(s => [...s, { name: "DB_WORK_ITEM", ok: (wi?.length || 0) > 0, detail: wi?.[0], duration_ms: Date.now() - t4 }]);

      if (wi?.[0]) {
        const [{ count: actCount }, { count: pubCount }] = await Promise.all([
          (supabase.from("work_item_acts") as any).select("id", { count: "exact", head: true }).eq("work_item_id", wi[0].id).eq("is_archived", false),
          supabase.from("work_item_publicaciones").select("id", { count: "exact", head: true }).eq("work_item_id", wi[0].id).eq("is_archived", false),
        ]);
        setSteps(s => [...s, { name: "DB_ACTUACIONES", ok: (actCount || 0) > 0, detail: { count: actCount } }]);
        setSteps(s => [...s, { name: "DB_PUBLICACIONES", ok: (pubCount || 0) > 0, detail: { count: pubCount } }]);

        // Source breakdown
        const { data: srcData } = await (supabase.from("work_item_acts") as any)
          .select("source")
          .eq("work_item_id", wi[0].id)
          .eq("is_archived", false);
        const counts: Record<string, number> = {};
        for (const a of srcData || []) counts[a.source || "unknown"] = (counts[a.source || "unknown"] || 0) + 1;
        setSteps(s => [...s, { name: "SOURCE_BREAKDOWN", ok: true, detail: counts }]);

        // Provenance check for external providers
        const { data: provData } = await (supabase.from("act_provenance") as any)
          .select("provider_instance_id")
          .eq("work_item_act_id", wi[0].id)
          .limit(50);
        const provInstances = new Set((provData || []).map((p: any) => p.provider_instance_id));
        setSteps(s => [...s, { name: "PROVENANCE_INSTANCES", ok: provInstances.size > 0, detail: { unique_instances: provInstances.size } }]);
      }

      toast.success("Pipeline debug completado");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const config = BUILTIN_PROVIDERS[workflowType];
  const extConnectors = resolvedConnectors.filter(c => !c.is_builtin);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline">{config.primary.toUpperCase()}</Badge>
          {config.secondary && <Badge variant="secondary">{config.secondary.toUpperCase()}</Badge>}
          {config.publicaciones && <Badge variant="secondary">+ Publicaciones</Badge>}
          {extConnectors.map(c => (
            <Badge key={c.id} className="bg-primary/20 text-primary border-primary/30">
              <Cable className="h-3 w-3 mr-1" />
              {c.name}
            </Badge>
          ))}
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

// ============= Sync Test Tab =============

function SyncTestTab({ radicado, workflowType, resolvedConnectors }: {
  radicado: string;
  workflowType: WorkflowType;
  resolvedConnectors: ConnectorInfo[];
}) {
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

      // Sync actuaciones (built-in)
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

      // Sync publicaciones (built-in)
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

      // External provider sync — only non-built-in connectors
      const extConnectors = resolvedConnectors.filter(c => !c.is_builtin);

      for (const connector of extConnectors) {
        const { data: instances } = await (supabase.from("provider_instances") as any)
          .select("id")
          .eq("connector_id", connector.id)
          .eq("is_enabled", true)
          .limit(1);

        const instance = instances?.[0];
        if (instance) {
          const t4 = Date.now();
          const { data: extSync, error: extErr } = await supabase.functions.invoke("provider-sync-external-provider", {
            body: { work_item_id: wi.id, connector_id: connector.id, instance_id: instance.id },
          });
          setSteps(s => [...s, {
            name: `EXT_SYNC_${connector.key || connector.name}`,
            ok: !extErr && extSync?.ok !== false,
            detail: extErr ? { error: extErr.message } : extSync,
            duration_ms: Date.now() - t4,
          }]);
        } else {
          setSteps(s => [...s, { name: `EXT_SYNC_${connector.key}`, ok: false, message: "Sin instancia activa" }]);
        }
      }

      // DB verification
      const t5 = Date.now();
      const [{ count: actCount }, { count: pubCount }] = await Promise.all([
        (supabase.from("work_item_acts") as any).select("id", { count: "exact", head: true }).eq("work_item_id", wi.id).eq("is_archived", false),
        supabase.from("work_item_publicaciones").select("id", { count: "exact", head: true }).eq("work_item_id", wi.id).eq("is_archived", false),
      ]);

      // Source breakdown
      const { data: srcData } = await (supabase.from("work_item_acts") as any)
        .select("source")
        .eq("work_item_id", wi.id)
        .eq("is_archived", false);
      const counts: Record<string, number> = {};
      for (const a of srcData || []) counts[a.source || "unknown"] = (counts[a.source || "unknown"] || 0) + 1;

      setSteps(s => [...s, {
        name: "DB_VERIFY",
        ok: (actCount || 0) > 0,
        detail: { actuaciones: actCount, publicaciones: pubCount, source_breakdown: counts },
        duration_ms: Date.now() - t5,
      }]);

      // Provider traces
      const t6 = Date.now();
      const { data: traces } = await (supabase.from("provider_sync_traces") as any)
        .select("stage, ok, result_code, connector_id")
        .eq("work_item_id", wi.id)
        .order("created_at", { ascending: false })
        .limit(20);

      setSteps(s => [...s, {
        name: "PROVIDER_TRACES",
        ok: (traces?.length || 0) > 0,
        detail: { count: traces?.length, stages: traces?.map((t: any) => `${t.stage}:${t.ok ? "OK" : t.result_code}`) },
        duration_ms: Date.now() - t6,
      }]);

      toast.success("Sync test completado");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const extConnectors = resolvedConnectors.filter(c => !c.is_builtin);
  const extNames = extConnectors.map(c => c.name).join(", ");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Ejecuta sync completo (actuaciones + publicaciones
          {extNames ? ` + ${extNames}` : ""}
          ) y verifica BD
          
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

// ============= External Provider Status Tab =============

function ExternalProviderStatusTab({ connectors, loading: connectorsLoading }: { connectors: ConnectorInfo[]; loading: boolean }) {
  if (connectorsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const enabled = connectors.filter(c => c.is_enabled);
  const disabled = connectors.filter(c => !c.is_enabled);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {connectors.length} conector(es) registrados — {enabled.length} activo(s), {disabled.length} inactivo(s)
      </p>

      {enabled.length === 0 && (
        <div className="rounded-lg border border-muted p-4 text-center text-sm text-muted-foreground">
          No hay conectores activos. Use el Wizard de Proveedores Externos para agregar uno.
        </div>
      )}

      <div className="space-y-2">
        {connectors.map(c => (
          <div
            key={c.id}
            className={cn(
              "flex items-center justify-between p-3 rounded-lg border text-sm",
              c.is_enabled ? "border-emerald-500/30 bg-emerald-500/5" : "border-muted bg-muted/30"
            )}
          >
            <div className="flex items-center gap-2">
              {c.is_enabled ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <XCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <div>
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground ml-2 font-mono">{c.key}</span>
              </div>
              {c.is_builtin ? (
                <Badge variant="info" className="text-[10px]">BUILT-IN</Badge>
              ) : (
                <Badge className="text-[10px] bg-purple-500/20 text-purple-400 border-purple-500/30">EXTERNAL</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{c.scope}</Badge>
              {(c.capabilities || []).map(cap => (
                <Badge key={cap} variant="secondary" className="text-[10px]">{cap}</Badge>
              ))}
              <Badge variant={c.is_enabled ? "default" : "secondary"} className="text-[10px]">
                {c.is_enabled ? "Activo" : "Inactivo"}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============= Main Component =============

export function MasterDebugPanel() {
  const [radicado, setRadicado] = useState("05001333300320190025200");
  const [workflowType, setWorkflowType] = useState<WorkflowType>("CPACA");
  // "auto" = workflow-based auto-detect, "all" = every connector, or Set of specific IDs
  const [connectorMode, setConnectorMode] = useState<"auto" | "all" | Set<string>>("auto");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const { data: connectors = [], isLoading: connectorsLoading } = useConnectors();


  // Resolve which connectors to use based on mode
  const resolveSelectedConnectors = (allConnectors: ConnectorInfo[]): ConnectorInfo[] => {
    if (connectorMode === "auto") return resolveConnectorsForWorkflow(workflowType, allConnectors);
    if (connectorMode === "all") return allConnectors.filter(c => c.is_enabled);
    return allConnectors.filter(c => (connectorMode as Set<string>).has(c.id));
  };

  const copyAll = () => {
    const resolved = resolveSelectedConnectors(connectors);
    navigator.clipboard.writeText(JSON.stringify({
      radicado,
      workflowType,
      selectedConnectors: resolved.map(c => ({ id: c.id, name: c.name, key: c.key })),
      mode: connectorMode === "auto" ? "auto" : connectorMode === "all" ? "all" : Array.from(connectorMode as Set<string>),
      timestamp: new Date().toISOString(),
    }, null, 2));
    toast.success("Datos copiados");
  };

  const toggleConnector = (id: string) => {
    setConnectorMode(prev => {
      const current = prev instanceof Set ? new Set(prev) : new Set<string>();
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return current.size === 0 ? "auto" : current;
    });
  };

  const connectorLabel = connectorMode === "auto"
    ? "Auto-detectar"
    : connectorMode === "all"
    ? `Todos (${connectors.filter(c => c.is_enabled).length})`
    : `${(connectorMode as Set<string>).size} seleccionado(s)`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Consola de Debug Unificada — Atenia AI
        </CardTitle>
        <CardDescription>
          Diagnóstico multi-proveedor: built-in (CPNU, SAMAI, Tutelas, Publicaciones) + proveedores externos registrados vía Wizard
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Shared Inputs */}
        <div className="grid gap-3 md:grid-cols-4">
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
            <Label className="text-xs text-muted-foreground">Categoría</Label>
            <Select value={workflowType} onValueChange={(v) => setWorkflowType(v as WorkflowType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_WORKFLOW_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              {ALL_WORKFLOW_OPTIONS.find(o => o.value === workflowType)?.description}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Cable className="h-3 w-3" />
              Proveedor Externo
            </Label>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal h-11">
                  <span className="truncate">{connectorLabel}</span>
                  <ChevronDown className="h-4 w-4 ml-2 shrink-0 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2 space-y-1" align="start">
                {/* Auto option */}
                <button
                  className={cn("flex items-center gap-2 w-full rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors",
                    connectorMode === "auto" && "bg-primary/10 text-primary font-medium")}
                  onClick={() => { setConnectorMode("auto"); setPopoverOpen(false); }}
                >
                  <Globe className="h-3.5 w-3.5" />
                  Auto-detectar (por categoría)
                </button>
                {/* All option */}
                <button
                  className={cn("flex items-center gap-2 w-full rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors",
                    connectorMode === "all" && "bg-primary/10 text-primary font-medium")}
                  onClick={() => { setConnectorMode("all"); setPopoverOpen(false); }}
                >
                  <Server className="h-3.5 w-3.5" />
                  Todos los activos ({connectors.filter(c => c.is_enabled).length})
                </button>
                <Separator className="my-1" />
                <p className="text-[10px] text-muted-foreground px-2 py-0.5">Seleccionar individualmente:</p>
                {connectorsLoading && <p className="text-xs text-muted-foreground px-2">Cargando...</p>}
                {connectors.map(c => {
                  const isChecked = connectorMode instanceof Set && connectorMode.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex items-center gap-2 w-full rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-muted transition-colors",
                        isChecked && "bg-primary/10"
                      )}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleConnector(c.id)}
                      />
                      <span className={c.is_enabled ? "" : "text-muted-foreground"}>{c.name}</span>
                      {c.is_builtin && <Badge variant="secondary" className="text-[9px]">built-in</Badge>}
                      <Badge variant="outline" className="text-[9px] ml-auto">{c.scope}</Badge>
                      {!c.is_enabled && <Badge variant="secondary" className="text-[9px]">off</Badge>}
                    </label>
                  );
                })}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <Separator />

        {/* Tabs */}
        <Tabs defaultValue="secrets" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
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
              Andro IA
            </TabsTrigger>
            <TabsTrigger value="providers" className="text-xs">
              <Cable className="h-3.5 w-3.5 mr-1" />
              Proveedores
            </TabsTrigger>
          </TabsList>

          <TabsContent value="secrets" className="mt-4">
            <SecretReadinessTab />
          </TabsContent>

          <TabsContent value="pipeline" className="mt-4">
            <PipelineDebugTab
              radicado={radicado}
              workflowType={workflowType}
              resolvedConnectors={resolveSelectedConnectors(connectors)}
            />
          </TabsContent>

          <TabsContent value="sync" className="mt-4">
            <SyncTestTab
              radicado={radicado}
              workflowType={workflowType}
              resolvedConnectors={resolveSelectedConnectors(connectors)}
            />
          </TabsContent>

          <TabsContent value="wizard" className="mt-4">
            <E2EWizardTab
              radicado={radicado}
              workflowType={workflowType}
              resolvedConnectors={resolveSelectedConnectors(connectors)}
            />
          </TabsContent>

          <TabsContent value="atenia" className="mt-4">
            <AteniaE2ETab radicado={radicado} />
          </TabsContent>

          <TabsContent value="providers" className="mt-4">
            <ExternalProviderStatusTab connectors={connectors} loading={connectorsLoading} />
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
