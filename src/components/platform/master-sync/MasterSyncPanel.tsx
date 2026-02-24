/**
 * Master Sync Panel — Superadmin debug tool for full sync execution
 * v2: Enhanced with scrollable results, provider detail, expandable rows, summary stats, and filters
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Play,
  Square,
  Copy,
  Download,
  AlertTriangle,
  Brain,
  Loader2,
  Check,
  X,
  Clock,
  FileText,
  ArrowDown,
  Search,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { useMasterSync } from "./useMasterSync";
import { buildGeminiPrompt, buildClaudeReport, buildErrorOnlyReport } from "./report-builders";
import { WORKFLOW_OPTIONS } from "./types";
import type { MasterSyncConfig, ItemSyncResult, MasterSyncState } from "./types";

// ─── Provider color coding ───
const PROVIDER_COLORS: Record<string, string> = {
  cpnu: "text-blue-400",
  samai: "text-purple-400",
  "ext:SAMAI Estados API": "text-teal-400",
  SAMAI_ESTADOS: "text-teal-400",
  "ext:SAMAI Estados": "text-teal-400",
  tutelas: "text-orange-400",
  publicaciones: "text-green-400",
};

function getProviderColor(provider: string): string {
  const lower = provider.toLowerCase();
  if (lower.includes("cpnu")) return PROVIDER_COLORS.cpnu;
  if (lower.includes("samai") && (lower.includes("estado") || lower.includes("ext"))) return PROVIDER_COLORS["ext:SAMAI Estados API"];
  if (lower.includes("samai")) return PROVIDER_COLORS.samai;
  if (lower.includes("tutela")) return PROVIDER_COLORS.tutelas;
  if (lower.includes("public")) return PROVIDER_COLORS.publicaciones;
  return "text-muted-foreground";
}

function getStatusIcon(status: string): string {
  switch (status) {
    case "success": return "✅";
    case "empty": return "⚪";
    case "error": return "❌";
    case "not_found": return "🔍";
    case "timeout": case "scraping_timeout": return "⏳";
    case "partial_error": return "⚠️";
    case "running": return "🔄";
    case "skipped": case "not_applicable": return "—";
    default: return "⏳";
  }
}

function getOverallStatus(item: ItemSyncResult): { icon: string; label: string } {
  if (item.act_status === "running") return { icon: "🔄", label: "running" };
  if (item.act_status === "pending") return { icon: "⏳", label: "pending" };

  const actOk = item.act_status === "success" || item.act_status === "empty";
  const pubOk = item.pub_status === "success" || item.pub_status === "not_applicable" || item.pub_status === "skipped";
  const pubWarn = item.pub_status === "partial_error";

  if (actOk && pubOk) return { icon: "✅", label: "success" };
  if (actOk && pubWarn) return { icon: "⚠️", label: "partial" };
  if (actOk && item.pub_status === "error") return { icon: "⚠️", label: "partial" };
  if (item.act_status === "empty") return { icon: "⚪", label: "empty" };
  return { icon: "❌", label: "error" };
}

function formatLatency(ms: number | null): string {
  if (!ms) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// ─── Provider stats computation ───
interface ProviderStats {
  name: string;
  calls: number;
  success: number;
  errors: number;
  latencies: number[];
}

function computeProviderStats(items: ItemSyncResult[]): ProviderStats[] {
  const map: Record<string, ProviderStats> = {};

  for (const item of items) {
    // From provider_attempts
    if (item.act_provider_attempts?.length > 0) {
      for (const attempt of item.act_provider_attempts) {
        const name = attempt.provider || "unknown";
        if (!map[name]) map[name] = { name, calls: 0, success: 0, errors: 0, latencies: [] };
        map[name].calls++;
        if (attempt.status === "success") map[name].success++;
        else map[name].errors++;
        if (attempt.latencyMs || attempt.latency_ms) {
          map[name].latencies.push(attempt.latencyMs || attempt.latency_ms);
        }
      }
    } else if (item.act_provider) {
      // Fallback: use top-level provider
      const name = item.act_provider;
      if (!map[name]) map[name] = { name, calls: 0, success: 0, errors: 0, latencies: [] };
      map[name].calls++;
      if (item.act_ok) map[name].success++;
      else map[name].errors++;
      if (item.act_latency_ms) map[name].latencies.push(item.act_latency_ms);
    }

    // Publicaciones
    if (item.pub_status !== "not_applicable" && item.pub_status !== "skipped" && item.pub_status !== "pending") {
      if (!map["publicaciones"]) map["publicaciones"] = { name: "publicaciones", calls: 0, success: 0, errors: 0, latencies: [] };
      map["publicaciones"].calls++;
      if (item.pub_ok) map["publicaciones"].success++;
      else map["publicaciones"].errors++;
      if (item.pub_latency_ms) map["publicaciones"].latencies.push(item.pub_latency_ms);
    }
  }

  return Object.values(map).sort((a, b) => b.calls - a.calls);
}

function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ─── Detect problems ───
function detectProblems(items: ItemSyncResult[]): string[] {
  const problems: string[] = [];

  const emptyItems = items.filter((r) => r.act_status === "empty");
  if (emptyItems.length > 0) {
    const types = [...new Set(emptyItems.map((r) => r.workflow_type))].join(", ");
    problems.push(`${emptyItems.length} items (${types}): proveedor retornó 0 actuaciones — pueden ser recién radicados`);
  }

  // check_pub_date_source constraint violations
  const pubConstraintErrors = items.filter(
    (r) => r.pub_raw_response?.errors?.some((e: string) => e.includes("check_pub_date_source")),
  );
  if (pubConstraintErrors.length > 0) {
    problems.push(`${pubConstraintErrors.length} items: violación de constraint check_pub_date_source (publicaciones bloqueadas)`);
  }

  const zeroPubInserted = items.reduce((s, r) => s + r.pub_inserted, 0);
  const pubProcessed = items.filter((r) => r.pub_status !== "not_applicable" && r.pub_status !== "pending");
  if (pubProcessed.length > 0 && zeroPubInserted === 0) {
    problems.push("0 publicaciones insertadas globalmente — pipeline puede estar detenido");
  }

  const timeouts = items.filter(
    (r) => r.act_error_code?.includes("TIMEOUT") || r.act_error_code?.includes("SCRAPING"),
  );
  if (timeouts.length > 0) {
    problems.push(`${timeouts.length} items: timeout/scraping pendiente`);
  }

  return problems;
}

type StatusFilter = "all" | "success" | "empty" | "error" | "pending";

export function MasterSyncPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    config, setConfig, state, preview, geminiAnalysis, isAnalyzing, traces,
    fetchPreview, execute, cancel, analyzeWithGemini, reset,
  } = useMasterSync();

  const updateConfig = (partial: Partial<MasterSyncConfig>) =>
    setConfig((c) => ({ ...c, ...partial }));

  const toggleWorkflow = (wf: string) =>
    setConfig((c) => ({
      ...c,
      workflowFilter: c.workflowFilter.includes(wf)
        ? c.workflowFilter.filter((w) => w !== wf)
        : [...c.workflowFilter, wf],
    }));

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado al portapapeles`);
  };

  const handleDownload = (text: string, filename: string) => {
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const workflowCounts = preview
    ? WORKFLOW_OPTIONS.map((wf) => ({
        ...wf,
        count: preview.filter((p) => p.workflow_type === wf.value).length,
      }))
    : [];

  const neverSynced = preview?.filter((p) => !p.last_synced_at).length || 0;
  const stale7d = preview?.filter((p) => {
    if (!p.last_synced_at) return false;
    return Date.now() - new Date(p.last_synced_at).getTime() > 7 * 24 * 60 * 60 * 1000;
  }).length || 0;

  const progress =
    state.totalItems > 0 ? Math.round((state.completedItems / state.totalItems) * 100) : 0;

  const elapsedMs = state.startedAt ? Date.now() - new Date(state.startedAt).getTime() : 0;
  const avgPerItem = state.completedItems > 0 ? elapsedMs / state.completedItems : 5000;
  const remainingItems = state.totalItems - state.completedItems;
  const estimatedRemainingMs = remainingItems * avgPerItem;

  const formatMs = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <Card className="border-amber-500/30">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-amber-500" />
                <div>
                  <CardTitle className="text-base">Sincronización Maestra (Debug)</CardTitle>
                  <CardDescription className="text-xs">
                    Ejecuta sincronización completa de TODOS los asuntos con radicado. Solo superadmin.
                  </CardDescription>
                </div>
              </div>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {/* === IDLE / CONFIG === */}
            {(state.status === "idle" || state.status === "loading_items") && (
              <ConfigPanel
                config={config}
                updateConfig={updateConfig}
                toggleWorkflow={toggleWorkflow}
                onPreview={fetchPreview}
                isLoading={state.status === "loading_items"}
              />
            )}

            {/* === PREVIEW === */}
            {state.status === "previewing" && preview && (
              <div className="space-y-3">
                <div className="rounded-md border p-3 bg-muted/30 space-y-1">
                  <div className="text-sm font-medium">
                    📋 Vista Previa: {preview.length} asuntos encontrados
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {workflowCounts
                      .filter((w) => w.count > 0)
                      .map((w) => `${w.value}: ${w.count}`)
                      .join(" | ")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Nunca sincronizados: {neverSynced} | Última sync &gt; 7 días: {stale7d}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Tiempo estimado: ~{formatMs(preview.length * 5000 / (config.batchSize || 3))} (
                    {config.batchSize} simultáneos)
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={execute}>
                    <Play className="h-4 w-4 mr-1" />
                    Ejecutar Sincronización Maestra
                  </Button>
                  <Button size="sm" variant="outline" onClick={reset}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {/* === RUNNING === */}
            {state.status === "running" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                    Sincronización en Progreso...
                  </div>
                  <Button size="sm" variant="destructive" onClick={cancel}>
                    <Square className="h-3 w-3 mr-1" />
                    Cancelar
                  </Button>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {state.completedItems}/{state.totalItems} ({progress}%)
                    </span>
                    <span>
                      Lote {state.currentBatch}/{state.totalBatches} | Transcurrido:{" "}
                      {formatMs(elapsedMs)} | Restante: ~{formatMs(estimatedRemainingMs)}
                    </span>
                  </div>
                </div>

                {/* Enhanced Summary */}
                <SummaryStats items={state.items} isRunning />

                <ResultsTable items={state.items} autoScroll />
              </div>
            )}

            {/* === COMPLETED / CANCELLED === */}
            {(state.status === "completed" || state.status === "cancelled") && (
              <CompletedView
                state={state}
                config={config}
                geminiAnalysis={geminiAnalysis}
                isAnalyzing={isAnalyzing}
                traces={traces}
                onAnalyze={() => analyzeWithGemini(buildGeminiPrompt(state.items, config))}
                onCopyFull={() =>
                  handleCopy(buildClaudeReport(state.items, config, traces || undefined), "Reporte completo")
                }
                onCopyErrors={() =>
                  handleCopy(buildErrorOnlyReport(state.items, config), "Reporte de errores")
                }
                onDownload={() =>
                  handleDownload(
                    buildClaudeReport(state.items, config, traces || undefined),
                    `atenia-master-sync-${new Date().toISOString().slice(0, 10)}.md`,
                  )
                }
                onReset={reset}
              />
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/* ─── Summary Stats Card ─── */
function SummaryStats({ items, isRunning = false }: { items: ItemSyncResult[]; isRunning?: boolean }) {
  const completed = items.filter((r) => r.act_status !== "pending" && r.act_status !== "running");
  const successCount = items.filter((r) => r.act_status === "success").length;
  const emptyCount = items.filter((r) => r.act_status === "empty").length;
  const errorCount = items.filter((r) => r.act_status === "error").length;
  const pendingCount = items.filter((r) => r.act_status === "pending" || r.act_status === "running").length;
  const totalActInserted = items.reduce((s, r) => s + r.act_inserted, 0);
  const totalActSkipped = items.reduce((s, r) => s + r.act_skipped, 0);
  const totalPubInserted = items.reduce((s, r) => s + r.pub_inserted, 0);
  const totalPubSkipped = items.reduce((s, r) => s + r.pub_skipped, 0);

  const providerStats = computeProviderStats(completed);
  const problems = detectProblems(completed);

  const [showProviders, setShowProviders] = useState(!isRunning);

  return (
    <div className="rounded-md border p-3 bg-muted/30 space-y-2 text-xs">
      {/* Top line */}
      <div className="flex flex-wrap gap-3 font-medium">
        <span className="text-green-500">✅ {successCount} exitosos</span>
        {emptyCount > 0 && <span className="text-muted-foreground">⚪ {emptyCount} vacíos</span>}
        <span className="text-red-500">❌ {errorCount} fallidos</span>
        {pendingCount > 0 && <span className="text-muted-foreground">⏳ {pendingCount} pendientes</span>}
      </div>

      {/* Counts */}
      <div className="flex flex-wrap gap-4 text-muted-foreground border-t border-border/50 pt-1.5">
        <span>Actuaciones: <span className="text-foreground">{totalActInserted}</span> insertadas, <span className="text-muted-foreground">{totalActSkipped}</span> dedup</span>
        <span>Publicaciones: <span className="text-foreground">{totalPubInserted}</span> insertadas, <span className="text-muted-foreground">{totalPubSkipped}</span> dedup</span>
      </div>

      {/* Provider breakdown (collapsible) */}
      {providerStats.length > 0 && (
        <Collapsible open={showProviders} onOpenChange={setShowProviders}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors border-t border-border/50 pt-1.5 w-full text-left">
              {showProviders ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Proveedores ({providerStats.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-0.5 mt-1">
              {providerStats.map((ps) => {
                const p50 = percentile(ps.latencies, 0.5);
                const p90 = percentile(ps.latencies, 0.9);
                return (
                  <div key={ps.name} className="flex items-center gap-2">
                    <span className={`font-mono ${getProviderColor(ps.name)}`}>{ps.name}:</span>
                    <span>{ps.calls} llamadas → {ps.success} ✅ {ps.errors} ❌</span>
                    {p50 != null && (
                      <span className="text-muted-foreground">
                        │ p50: {formatLatency(p50)}{p90 != null ? ` p90: ${formatLatency(p90)}` : ""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Problems */}
      {problems.length > 0 && (
        <div className="border-t border-border/50 pt-1.5 space-y-0.5">
          <div className="font-medium text-amber-500">⚠️ Problemas detectados:</div>
          {problems.map((p, i) => (
            <div key={i} className="text-muted-foreground">• {p}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Results Table (Scrollable, Expandable) ─── */
function ResultsTable({ items, autoScroll = false }: { items: ItemSyncResult[]; autoScroll?: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [userScrolled, setUserScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);

  // Filter items
  const visibleItems = useMemo(() => {
    let filtered = items.filter(
      (r) => r.act_status !== "pending",
    );

    if (filter === "success") filtered = filtered.filter((r) => r.act_status === "success");
    else if (filter === "empty") filtered = filtered.filter((r) => r.act_status === "empty");
    else if (filter === "error") filtered = filtered.filter((r) => r.act_status === "error");
    else if (filter === "pending") filtered = filtered.filter((r) => r.act_status === "running" || r.act_status === "pending");

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((r) => r.radicado.toLowerCase().includes(term));
    }

    return filtered;
  }, [items, filter, searchTerm]);

  // Auto-scroll to bottom when new items complete
  useEffect(() => {
    if (!autoScroll || userScrolled) return;
    const currentCount = visibleItems.length;
    if (currentCount > lastCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    lastCountRef.current = currentCount;
  }, [visibleItems.length, autoScroll, userScrolled]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If user scrolled up more than 100px from bottom, mark as user-scrolled
    setUserScrolled(scrollHeight - scrollTop - clientHeight > 100);
  }, []);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setUserScrolled(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex items-center gap-1">
          <Filter className="h-3 w-3 text-muted-foreground" />
          {(["all", "success", "empty", "error", "pending"] as StatusFilter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "ghost"}
              className="h-6 px-2 text-xs"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Todos" : f === "success" ? "✅ Éxitos" : f === "empty" ? "⚪ Vacíos" : f === "error" ? "❌ Errores" : "⏳ Pendientes"}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <Search className="h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Buscar radicado..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-6 w-40 text-xs"
          />
        </div>
      </div>

      {/* Scrollable table */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-[600px] overflow-y-auto rounded border text-xs"
        >
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="px-2 py-1.5 text-left w-8">#</th>
                <th className="px-2 py-1.5 text-left">Radicado</th>
                <th className="px-2 py-1.5 text-left w-16">Tipo</th>
                <th className="px-2 py-1.5 text-left min-w-[220px]">Actuaciones</th>
                <th className="px-2 py-1.5 text-left min-w-[180px]">Publicaciones</th>
                <th className="px-2 py-1.5 text-right w-16">Latencia</th>
                <th className="px-2 py-1.5 text-center w-10">Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const idx = items.indexOf(item);
                const isExpanded = expandedId === item.work_item_id;
                const overall = getOverallStatus(item);

                const rowBg =
                  item.act_status === "error" ? "bg-red-500/5" :
                  item.act_status === "empty" ? "bg-muted/20" :
                  item.act_ok && item.act_inserted > 0 ? "bg-green-500/5" :
                  "";

                return (
                  <React.Fragment key={item.work_item_id}>
                    <tr
                      className={`border-t cursor-pointer hover:bg-muted/40 transition-colors ${rowBg}`}
                      onClick={() => setExpandedId(isExpanded ? null : item.work_item_id)}
                    >
                      <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                      <td className="px-2 py-1 font-mono text-[11px]">
                        <div className="flex items-center gap-1">
                          {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                          <span className="truncate max-w-[160px]">{item.radicado}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{item.workflow_type}</Badge>
                      </td>
                      <td className="px-2 py-1">
                        <ActuacionesCell item={item} />
                      </td>
                      <td className="px-2 py-1">
                        <PublicacionesCell item={item} />
                      </td>
                      <td className="px-2 py-1 text-right text-muted-foreground">
                        {formatLatency(item.total_ms || item.act_latency_ms)}
                      </td>
                      <td className="px-2 py-1 text-center">{overall.icon}</td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <ExpandedRowDetail item={item} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* "Jump to bottom" button */}
        {autoScroll && userScrolled && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-2 right-4 h-7 text-xs shadow-lg"
            onClick={scrollToBottom}
          >
            <ArrowDown className="h-3 w-3 mr-1" />
            Ir al final ↓
          </Button>
        )}
      </div>
    </div>
  );
}

// Need React import for Fragment
import * as React from "react";

/* ─── Actuaciones Cell (multi-provider detail) ─── */
function ActuacionesCell({ item }: { item: ItemSyncResult }) {
  if (item.act_status === "running") {
    return <span className="text-blue-400 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Sincronizando...</span>;
  }
  if (item.act_status === "pending") {
    return <span className="text-muted-foreground">Pendiente</span>;
  }

  const attempts = item.act_provider_attempts || [];

  if (attempts.length > 0) {
    return (
      <div className="space-y-0.5">
        {attempts.map((a: any, i: number) => {
          const provName = a.provider || "unknown";
          const statusIcon = getStatusIcon(a.status);
          const latency = a.latencyMs || a.latency_ms;
          const count = a.actuacionesCount ?? a.inserted_count ?? 0;

          return (
            <div key={i} className="flex items-center gap-1 text-[11px]">
              <span>{statusIcon}</span>
              <span className={`font-mono ${getProviderColor(provName)}`}>{provName}:</span>
              {a.status === "success" ? (
                <span>
                  <span className={count > 0 ? "text-green-500 font-medium" : "text-muted-foreground"}>
                    +{count}
                  </span>
                  {" new"}
                  {latency ? ` (${formatLatency(latency)})` : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {a.message?.slice(0, 40) || a.status}
                  {latency ? ` (${formatLatency(latency)})` : ""}
                </span>
              )}
            </div>
          );
        })}
        {item.act_status === "error" && item.act_error_code && (
          <div className="text-red-400 text-[10px]">→ {item.act_error_code}</div>
        )}
      </div>
    );
  }

  // Fallback: no attempts detail
  if (item.act_status === "success" || item.act_status === "empty") {
    const provider = item.act_provider || "unknown";
    return (
      <div className="text-[11px]">
        <span>{item.act_status === "empty" ? "⚪" : "✅"} </span>
        <span className={`font-mono ${getProviderColor(provider)}`}>{provider}:</span>
        {" "}
        <span className={item.act_inserted > 0 ? "text-green-500 font-medium" : "text-muted-foreground"}>
          +{item.act_inserted}
        </span>
        {" new, "}{item.act_skipped}{" skip"}
        {item.act_latency_ms ? ` (${formatLatency(item.act_latency_ms)})` : ""}
      </div>
    );
  }

  // Error
  return (
    <div className="text-[11px]">
      <span>❌ <span className={`font-mono ${getProviderColor(item.act_provider || "")}`}>{item.act_provider || "unknown"}</span>: </span>
      <span className="text-red-400">{item.act_error_code || "ERROR"}</span>
      {item.act_latency_ms ? ` (${formatLatency(item.act_latency_ms)})` : ""}
    </div>
  );
}

/* ─── Publicaciones Cell ─── */
function PublicacionesCell({ item }: { item: ItemSyncResult }) {
  if (item.pub_status === "not_applicable" || item.pub_status === "skipped") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (item.pub_status === "pending") {
    return <span className="text-muted-foreground">Pendiente</span>;
  }
  if (item.pub_status === "running") {
    return <span className="text-blue-400 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /></span>;
  }

  const pubErrors = item.pub_raw_response?.errors || [];
  const constraintErrors = pubErrors.filter((e: string) => e.includes("check_pub_date_source"));
  const hasGap = item.pub_raw_response?.coverage_gap?.detected;
  const icon = item.pub_status === "success" ? (item.pub_inserted > 0 ? "✅" : "⚪") :
    item.pub_status === "partial_error" ? "⚠️" : "❌";

  return (
    <div className="space-y-0.5 text-[11px]">
      <div>
        <span>{icon} </span>
        <span className={`font-mono ${getProviderColor("publicaciones")}`}>pub:</span>
        {" "}
        <span className={item.pub_inserted > 0 ? "text-green-500 font-medium" : "text-muted-foreground"}>
          {item.pub_inserted}
        </span>
        {" new, "}{item.pub_skipped}{" skip"}
        {item.pub_latency_ms ? ` (${formatLatency(item.pub_latency_ms)})` : ""}
      </div>
      {constraintErrors.length > 0 && (
        <div className="text-red-400 text-[10px]">⛔ check_pub_date_source</div>
      )}
      {hasGap && (
        <div className="text-amber-400 text-[10px]">COVERAGE_GAP</div>
      )}
    </div>
  );
}

/* ─── Expanded Row Detail ─── */
function ExpandedRowDetail({ item }: { item: ItemSyncResult }) {
  const [showJson, setShowJson] = useState(false);

  const attempts = item.act_provider_attempts || [];
  const pubErrors = item.pub_raw_response?.errors || [];

  return (
    <div className="px-4 py-3 bg-muted/20 border-t space-y-3 text-xs">
      {/* Actuaciones detail */}
      <div className="rounded border p-2 space-y-1">
        <div className="font-medium">Actuaciones</div>
        <div>Proveedor: {item.act_provider || "none"} ({item.act_raw_response?.provider_order_reason || "—"})</div>
        {attempts.length > 0 && (
          <div className="space-y-0.5 pl-2 border-l-2 border-border">
            {attempts.map((a: any, i: number) => (
              <div key={i}>
                {i + 1}. <span className={`font-mono ${getProviderColor(a.provider)}`}>{a.provider}</span>
                {" → "}{a.status}
                {" ("}{ formatLatency(a.latencyMs || a.latency_ms) }{")"}
                {a.actuacionesCount != null && ` → ${a.actuacionesCount} actuaciones`}
                {a.message && <span className="text-muted-foreground"> — {a.message?.slice(0, 60)}</span>}
              </div>
            ))}
          </div>
        )}
        <div>Resultado: {item.act_inserted} insertadas, {item.act_skipped} dedup</div>
        {item.act_raw_response?.latest_event_date && (
          <div>Evento más reciente: {item.act_raw_response.latest_event_date}</div>
        )}
        {item.act_raw_response?.trace_id && (
          <div className="text-muted-foreground font-mono">Trace ID: {item.act_raw_response.trace_id}</div>
        )}
      </div>

      {/* Publicaciones detail */}
      {item.pub_status !== "not_applicable" && item.pub_status !== "skipped" && (
        <div className="rounded border p-2 space-y-1">
          <div className="font-medium">Publicaciones</div>
          <div>Proveedor: publicaciones ({formatLatency(item.pub_latency_ms)})</div>
          <div>Resultado: {item.pub_inserted} insertadas, {item.pub_skipped} dedup</div>
          <div>Status: {item.pub_raw_response?.status || item.pub_status}</div>
          {pubErrors.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-red-400 font-medium">⛔ Errores:</div>
              {pubErrors.filter((e: string) => e.length > 0).map((e: string, i: number) => (
                <div key={i} className="text-red-400 pl-2">• {e}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timing */}
      <div className="rounded border p-2">
        <div className="font-medium">Timing</div>
        <div>
          Iniciado: {item.started_at ? new Date(item.started_at).toLocaleTimeString() : "—"}
          {" → "}Completado: {item.completed_at ? new Date(item.completed_at).toLocaleTimeString() : "—"}
          {item.total_ms ? ` (${formatLatency(item.total_ms)} total)` : ""}
        </div>
      </div>

      {/* Raw JSON toggle */}
      <div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs"
          onClick={() => setShowJson(!showJson)}
        >
          {showJson ? "Ocultar JSON ▴" : "Ver JSON completo ▾"}
        </Button>
        {showJson && (
          <pre className="mt-1 p-2 bg-zinc-950 text-zinc-300 rounded text-[10px] max-h-64 overflow-auto font-mono">
            {JSON.stringify({ act: item.act_raw_response, pub: item.pub_raw_response }, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ─── Config Panel ─── */
function ConfigPanel({
  config,
  updateConfig,
  toggleWorkflow,
  onPreview,
  isLoading,
}: {
  config: MasterSyncConfig;
  updateConfig: (p: Partial<MasterSyncConfig>) => void;
  toggleWorkflow: (wf: string) => void;
  onPreview: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Scope */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Alcance</Label>
        <div className="flex flex-wrap gap-2">
          {[
            { value: "ALL" as const, label: "Todos con radicado" },
            { value: "MONITORING_ONLY" as const, label: "Solo monitoreo activo" },
            { value: "FAILED_ONLY" as const, label: "Solo fallidos / nunca sincronizados" },
          ].map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant={config.scope === opt.value ? "default" : "outline"}
              onClick={() => updateConfig({ scope: opt.value })}
              className="text-xs"
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Workflow filter */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Filtro de Flujo</Label>
        <div className="flex flex-wrap gap-3">
          {WORKFLOW_OPTIONS.map((wf) => (
            <div key={wf.value} className="flex items-center gap-1.5">
              <Checkbox
                id={`wf-${wf.value}`}
                checked={config.workflowFilter.includes(wf.value)}
                onCheckedChange={() => toggleWorkflow(wf.value)}
              />
              <Label htmlFor={`wf-${wf.value}`} className="text-xs">
                {wf.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      {/* Options */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="include-pub"
            checked={config.includePublicaciones}
            onCheckedChange={(v) => updateConfig({ includePublicaciones: !!v })}
          />
          <Label htmlFor="include-pub" className="text-xs">
            Incluir publicaciones (estados)
          </Label>
        </div>
        <div className="flex items-center gap-1.5">
          <Checkbox
            id="force-refresh"
            checked={config.forceRefresh}
            onCheckedChange={(v) => updateConfig({ forceRefresh: !!v })}
          />
          <Label htmlFor="force-refresh" className="text-xs">
            Forzar re-consulta
          </Label>
        </div>
        <div className="flex items-center gap-1.5">
          <Label htmlFor="batch-size" className="text-xs">
            Concurrencia:
          </Label>
          <Input
            id="batch-size"
            type="number"
            min={1}
            max={10}
            value={config.batchSize}
            onChange={(e) => updateConfig({ batchSize: parseInt(e.target.value) || 3 })}
            className="w-16 h-7 text-xs"
          />
        </div>
      </div>

      {/* Org */}
      <div className="space-y-1">
        <Label className="text-xs font-medium">Organización</Label>
        <Input
          value={config.organizationId}
          onChange={(e) => updateConfig({ organizationId: e.target.value })}
          className="h-7 text-xs font-mono"
        />
      </div>

      <Button size="sm" onClick={onPreview} disabled={isLoading || config.workflowFilter.length === 0}>
        {isLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
        Vista Previa
      </Button>
    </div>
  );
}

/* ─── Completed View ─── */
function CompletedView({
  state,
  config,
  geminiAnalysis,
  isAnalyzing,
  traces,
  onAnalyze,
  onCopyFull,
  onCopyErrors,
  onDownload,
  onReset,
}: {
  state: MasterSyncState;
  config: MasterSyncConfig;
  geminiAnalysis: string | null;
  isAnalyzing: boolean;
  traces: any[] | null;
  onAnalyze: () => void;
  onCopyFull: () => void;
  onCopyErrors: () => void;
  onDownload: () => void;
  onReset: () => void;
}) {
  const elapsed = state.startedAt && state.completedAt
    ? new Date(state.completedAt).getTime() - new Date(state.startedAt).getTime()
    : 0;

  const claudeReport = buildClaudeReport(state.items, config, traces || undefined);

  return (
    <div className="space-y-4">
      {state.status === "cancelled" && (
        <div className="text-sm text-amber-600 flex items-center gap-1">
          <AlertTriangle className="h-4 w-4" />
          Sincronización cancelada. Resultados parciales: {state.completedItems}/{state.totalItems} items.
        </div>
      )}

      {/* Enhanced Summary */}
      <SummaryStats items={state.items} />

      {/* Results table */}
      <ResultsTable items={state.items} />

      {/* Gemini Analysis */}
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Resumen Inteligente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {geminiAnalysis ? (
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{geminiAnalysis}</div>
          ) : (
            <Button size="sm" onClick={onAnalyze} disabled={isAnalyzing}>
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Brain className="h-4 w-4 mr-1" />
              )}
              Generar análisis con Atenia AI
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Claude Report */}
      <Card className="border-muted">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              📋 Reporte Técnico para Claude
            </CardTitle>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCopyFull}>
                <Copy className="h-3 w-3 mr-1" />
                Copiar Todo
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCopyErrors}>
                <Copy className="h-3 w-3 mr-1" />
                Solo Errores
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onDownload}>
                <Download className="h-3 w-3 mr-1" />
                .md
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            readOnly
            value={claudeReport}
            className="font-mono text-xs h-64 bg-zinc-950 text-zinc-300 border-zinc-800"
          />
          <p className="text-xs text-muted-foreground mt-2">
            💡 Copia este reporte y pégalo en Claude para obtener diagnóstico técnico detallado.
          </p>
        </CardContent>
      </Card>

      <Button size="sm" variant="outline" onClick={onReset}>
        Nueva sincronización
      </Button>
    </div>
  );
}
