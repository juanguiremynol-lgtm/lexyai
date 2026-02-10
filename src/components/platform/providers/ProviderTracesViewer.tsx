/**
 * ProviderTracesViewer — Show last 50 provider_sync_traces for a provider instance.
 * Filter by stage and result_code. Highlight important codes.
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Loader2, List, AlertTriangle, Clock, XCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

interface Instance {
  id: string;
  name: string;
}

interface Trace {
  id: string;
  created_at: string;
  stage: string;
  result_code: string;
  ok: boolean;
  latency_ms: number;
  payload: any;
  work_item_id: string | null;
  run_id: string | null;
}

const HIGHLIGHT_CODES = [
  "PROVIDER_EMPTY_RESULT",
  "SCRAPING_PENDING",
  "PROVIDER_404",
  "RECORD_NOT_FOUND",
  "CASE_NOT_FOUND",
  "SCRAPING_STUCK",
  "WILDCARD_ALLOWLIST_IN_PROD",
  "WARN",
];

function getCodeColor(code: string, ok: boolean): string {
  if (HIGHLIGHT_CODES.includes(code)) {
    if (code === "WARN" || code === "WILDCARD_ALLOWLIST_IN_PROD") return "text-amber-400 border-amber-500/50 bg-amber-500/10";
    if (code.includes("404") || code.includes("NOT_FOUND") || code === "SCRAPING_STUCK") return "text-red-400 border-red-500/50 bg-red-500/10";
    if (code === "SCRAPING_PENDING") return "text-blue-400 border-blue-500/50 bg-blue-500/10";
    if (code === "PROVIDER_EMPTY_RESULT") return "text-amber-400 border-amber-500/50 bg-amber-500/10";
  }
  if (ok) return "text-emerald-400 border-emerald-500/50 bg-emerald-500/10";
  return "text-red-400 border-red-500/50 bg-red-500/10";
}

interface ProviderTracesViewerProps {
  instance: Instance | null;
}

export function ProviderTracesViewer({ instance }: ProviderTracesViewerProps) {
  const [stageFilter, setStageFilter] = useState("all");
  const [codeFilter, setCodeFilter] = useState("all");

  const { data: traces, isLoading, refetch } = useQuery({
    queryKey: ["provider-sync-traces", instance?.id],
    queryFn: async () => {
      if (!instance) return [];
      const { data } = await supabase
        .from("provider_sync_traces")
        .select("*")
        .eq("provider_instance_id", instance.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data || []) as Trace[];
    },
    enabled: !!instance,
  });

  const stages = [...new Set((traces || []).map((t) => t.stage))];
  const codes = [...new Set((traces || []).map((t) => t.result_code))];

  const filtered = (traces || []).filter((t) => {
    if (stageFilter !== "all" && t.stage !== stageFilter) return false;
    if (codeFilter !== "all" && t.result_code !== codeFilter) return false;
    return true;
  });

  // Stats — deduplicated by run_id so multi-stage traces don't inflate rates
  const dedupedTraces = useMemo(() => {
    const allTraces = traces || [];
    // Group by run_id; traces without run_id count individually
    const byRun = new Map<string, Trace>();
    for (const t of allTraces) {
      const key = t.run_id || t.id; // fallback to row id if no run_id
      const existing = byRun.get(key);
      // Keep the "worst" outcome per run: !ok beats ok, highlight codes beat normal
      if (!existing || (!t.ok && existing.ok) || (HIGHLIGHT_CODES.includes(t.result_code) && !HIGHLIGHT_CODES.includes(existing.result_code))) {
        byRun.set(key, t);
      }
    }
    return Array.from(byRun.values());
  }, [traces]);

  const total = dedupedTraces.length;
  const errorCount = dedupedTraces.filter((t) => !t.ok).length;
  const warnCount = dedupedTraces.filter((t) => HIGHLIGHT_CODES.includes(t.result_code)).length;
  // Avg latency uses all rows (not deduped) to reflect true wall-clock time
  const allTotal = traces?.length || 0;
  const avgLatency = allTotal > 0 ? Math.round((traces || []).reduce((s, t) => s + (t.latency_ms || 0), 0) / allTotal) : 0;

  if (!instance) {
    return (
      <Card className="border-slate-700 bg-slate-900/50 opacity-60">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <List className="h-5 w-5 text-amber-400" /> Traces Timeline
          </CardTitle>
          <CardDescription>Seleccione una instancia para ver traces</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-slate-700 bg-slate-900/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <List className="h-5 w-5 text-amber-400" /> Traces Timeline
          </CardTitle>
          <CardDescription>{instance.name} — últimas 50 trazas</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div className="bg-slate-800/50 rounded p-2 border border-slate-700">
            <span className="text-slate-400">Runs</span>
            <p className="text-slate-200 font-mono text-lg">{total}</p>
          </div>
          <div className="bg-slate-800/50 rounded p-2 border border-slate-700">
            <span className="text-slate-400">Errores</span>
            <p className="text-red-400 font-mono text-lg">{errorCount}</p>
          </div>
          <div className="bg-slate-800/50 rounded p-2 border border-slate-700">
            <span className="text-slate-400">Advertencias</span>
            <p className="text-amber-400 font-mono text-lg">{warnCount}</p>
          </div>
          <div className="bg-slate-800/50 rounded p-2 border border-slate-700">
            <span className="text-slate-400">Latencia Prom.</span>
            <p className="text-slate-200 font-mono text-lg">{avgLatency}ms</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="bg-slate-800 border-slate-600 w-[160px]">
              <SelectValue placeholder="Stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los stages</SelectItem>
              {stages.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={codeFilter} onValueChange={setCodeFilter}>
            <SelectTrigger className="bg-slate-800 border-slate-600 w-[200px]">
              <SelectValue placeholder="Result Code" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los códigos</SelectItem>
              {codes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Traces list */}
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {filtered.map((trace) => (
              <div key={trace.id} className="bg-slate-800/30 border border-slate-700 rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {trace.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : HIGHLIGHT_CODES.includes(trace.result_code) ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-400" />
                    )}
                    <Badge variant="outline" className="text-xs border-slate-600">{trace.stage}</Badge>
                    <Badge variant="outline" className={`text-xs ${getCodeColor(trace.result_code, trace.ok)}`}>
                      {trace.result_code}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Clock className="h-3 w-3" />
                    {trace.latency_ms}ms
                    <span>{format(new Date(trace.created_at), "HH:mm:ss dd/MM")}</span>
                  </div>
                </div>
                {trace.run_id && <p className="text-xs text-slate-500 font-mono">run: {trace.run_id.slice(0, 8)}</p>}
                {trace.payload && typeof trace.payload === "object" && Object.keys(trace.payload).length > 0 && (
                  <details className="mt-1">
                    <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">payload</summary>
                    <pre className="text-xs text-slate-400 bg-slate-900/50 rounded p-2 mt-1 overflow-auto max-h-24">
                      {JSON.stringify(trace.payload, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-slate-500 py-8">No hay trazas{stageFilter !== "all" || codeFilter !== "all" ? " con estos filtros" : ""}</p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
