/**
 * Master Sync Panel — Superadmin debug tool for full sync execution
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  RefreshCw,
  ChevronDown,
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
} from "lucide-react";
import { toast } from "sonner";
import { useMasterSync } from "./useMasterSync";
import { buildGeminiPrompt, buildClaudeReport, buildErrorOnlyReport } from "./report-builders";
import { WORKFLOW_OPTIONS } from "./types";
import type { MasterSyncConfig } from "./types";

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <Check className="h-3.5 w-3.5 text-green-500" />;
    case "error":
      return <X className="h-3.5 w-3.5 text-red-500" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
    case "skipped":
    case "not_applicable":
      return <span className="h-3.5 w-3.5 text-muted-foreground">—</span>;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

export function MasterSyncPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    config,
    setConfig,
    state,
    preview,
    geminiAnalysis,
    isAnalyzing,
    traces,
    fetchPreview,
    execute,
    cancel,
    analyzeWithGemini,
    reset,
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

                {/* Summary */}
                <div className="text-xs space-y-0.5">
                  <div>
                    ✅ {state.successCount} exitosos ({state.totalActInserted} act.{" "}
                    {state.totalPubInserted} pub.)
                  </div>
                  <div>❌ {state.errorCount} fallidos</div>
                  <div>⏳ {state.totalItems - state.completedItems} pendientes</div>
                </div>

                <ResultsTable items={state.items} />
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

/* ─── Sub-components ─── */

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

function ResultsTable({ items }: { items: import("./types").ItemSyncResult[] }) {
  const completedItems = items.filter(
    (r) => r.act_status === "success" || r.act_status === "error" || r.act_status === "running",
  );
  const visibleItems = completedItems.slice(-20); // Show last 20

  return (
    <div className="max-h-64 overflow-auto rounded border text-xs">
      <table className="w-full">
        <thead className="sticky top-0 bg-muted">
          <tr>
            <th className="px-2 py-1 text-left">#</th>
            <th className="px-2 py-1 text-left">Radicado</th>
            <th className="px-2 py-1 text-left">Tipo</th>
            <th className="px-2 py-1 text-center">Act</th>
            <th className="px-2 py-1 text-center">Pub</th>
            <th className="px-2 py-1 text-right">Latencia</th>
            <th className="px-2 py-1 text-center">Estado</th>
          </tr>
        </thead>
        <tbody>
          {visibleItems.map((item, i) => {
            const idx = items.indexOf(item);
            const rowClass =
              item.act_status === "error"
                ? "bg-red-500/5"
                : item.act_ok && item.act_inserted === 0
                  ? "bg-muted/30"
                  : item.act_ok
                    ? "bg-green-500/5"
                    : "";

            return (
              <tr key={item.work_item_id} className={`border-t ${rowClass}`}>
                <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                <td className="px-2 py-1 font-mono truncate max-w-[180px]">{item.radicado}</td>
                <td className="px-2 py-1">{item.workflow_type}</td>
                <td className="px-2 py-1 text-center">
                  {item.act_status === "success" ? (
                    item.act_inserted > 0 ? (
                      <span className="text-green-600">+{item.act_inserted}</span>
                    ) : (
                      <span className="text-muted-foreground">+0</span>
                    )
                  ) : item.act_status === "error" ? (
                    <span className="text-red-500">{item.act_error_code?.slice(0, 12) || "ERR"}</span>
                  ) : (
                    <StatusIcon status={item.act_status} />
                  )}
                </td>
                <td className="px-2 py-1 text-center">
                  {item.pub_status === "not_applicable" ? (
                    "—"
                  ) : item.pub_status === "success" ? (
                    item.pub_inserted > 0 ? (
                      <span className="text-green-600">+{item.pub_inserted}</span>
                    ) : (
                      <span className="text-muted-foreground">+0</span>
                    )
                  ) : item.pub_status === "error" ? (
                    <span className="text-red-500">ERR</span>
                  ) : (
                    <StatusIcon status={item.pub_status} />
                  )}
                </td>
                <td className="px-2 py-1 text-right text-muted-foreground">
                  {item.act_latency_ms ? `${(item.act_latency_ms / 1000).toFixed(1)}s` : "—"}
                </td>
                <td className="px-2 py-1 text-center">
                  <StatusIcon status={item.act_status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
  state: import("./types").MasterSyncState;
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

      {/* Summary */}
      <div className="rounded-md border p-3 bg-muted/30 space-y-1 text-sm">
        <div className="font-medium">
          {state.status === "completed" ? "✅ Sincronización completada" : "⚠️ Resultados parciales"}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div>
            Procesados: {state.completedItems}/{state.totalItems}
          </div>
          <div className="text-green-600">Exitosos: {state.successCount}</div>
          <div className="text-red-500">Fallidos: {state.errorCount}</div>
          <div>Tiempo: {Math.round(elapsed / 1000)}s</div>
          <div>Act. nuevas: {state.totalActInserted}</div>
          <div>Pub. nuevas: {state.totalPubInserted}</div>
        </div>
      </div>

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
