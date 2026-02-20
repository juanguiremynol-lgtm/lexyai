/**
 * AteniaRunbookPanel — "Runbook diario" section in Supervisor.
 *
 * Shows last OK/FAILED per daily job, and a "Ejecutar runbook ahora" button
 * that triggers RUN_DAILY_RUNBOOK mode on the supervisor.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PlayCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";

const RUNBOOK_JOBS = [
  { job_name: "DAILY_ENQUEUE", label: "Encolamiento diario", icon: "📋" },
  { job_name: "PROCESS_QUEUE", label: "Drenaje de cola", icon: "⚡" },
  { job_name: "HEARTBEAT", label: "Heartbeat de salud", icon: "💓" },
  { job_name: "WATCHDOG", label: "Watchdog auto-sanación", icon: "🐕" },
  { job_name: "EMAIL_DISPATCH", label: "Despacho de emails", icon: "📧" },
];

function statusBadge(status: string | null) {
  if (!status) return <Badge variant="outline" className="text-xs">Sin datos</Badge>;
  if (status === "OK") return <Badge className="text-xs bg-green-600">OK</Badge>;
  if (status === "RUNNING") return <Badge className="text-xs bg-blue-600">Ejecutando</Badge>;
  return <Badge variant="destructive" className="text-xs">{status}</Badge>;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "nunca";
  const mins = Math.round((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.round(hrs / 24)}d`;
}

export function AteniaRunbookPanel() {
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);

  const { data: cronRuns, isLoading, refetch } = useQuery({
    queryKey: ["runbook-cron-status"],
    queryFn: async () => {
      const results: Record<string, { status: string; finished_at: string | null; started_at: string }> = {};
      for (const job of RUNBOOK_JOBS) {
        const { data } = await (supabase
          .from("atenia_cron_runs") as any)
          .select("status, finished_at, started_at")
          .eq("job_name", job.job_name)
          .order("started_at", { ascending: false })
          .limit(1);
        if (data?.[0]) {
          results[job.job_name] = data[0];
        }
      }
      return results;
    },
    staleTime: 30_000,
  });

  // Live actions feed for current runbook execution
  const { data: recentActions } = useQuery({
    queryKey: ["runbook-actions", isRunning],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data } = await (supabase
        .from("atenia_ai_actions") as any)
        .select("id, action_type, summary, created_at, action_result, evidence")
        .eq("action_type", "RUNBOOK_STEP")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
    staleTime: 5_000,
    refetchInterval: isRunning ? 3_000 : false,
  });

  const handleRunRunbook = async () => {
    setIsRunning(true);
    setRunResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("atenia-ai-supervisor", {
        body: { mode: "RUN_DAILY_RUNBOOK" },
      });
      if (error) throw error;
      setRunResult(data);
      toast.success("Runbook ejecutado correctamente");
      setTimeout(() => refetch(), 2000);
    } catch (err: any) {
      toast.error("Error ejecutando runbook: " + (err.message || "desconocido"));
      setRunResult({ error: err.message });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            Runbook Diario
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Refrescar
            </Button>
            <Button size="sm" onClick={handleRunRunbook} disabled={isRunning}>
              {isRunning ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <PlayCircle className="h-3 w-3 mr-1" />
              )}
              Ejecutar runbook ahora
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Job status grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {RUNBOOK_JOBS.map((job) => {
            const run = cronRuns?.[job.job_name];
            return (
              <div key={job.job_name} className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{job.icon}</span>
                  <span className="text-xs font-medium truncate">{job.label}</span>
                </div>
                <div className="flex items-center justify-between">
                  {statusBadge(run?.status ?? null)}
                  <span className="text-[10px] text-muted-foreground">
                    {timeAgo(run?.finished_at ?? run?.started_at ?? null)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Run result */}
        {runResult && (
          <div className="border rounded-lg p-3 bg-muted/30">
            <p className="text-xs font-medium mb-1">
              {runResult.error ? "❌ Error" : "✅ Resultado del runbook"}
            </p>
            <pre className="text-[10px] font-mono overflow-x-auto max-h-40 whitespace-pre-wrap">
              {JSON.stringify(runResult, null, 2)}
            </pre>
          </div>
        )}

        {/* Recent runbook actions feed */}
        {recentActions && recentActions.length > 0 && (
          <div className="border rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Acciones recientes del runbook</p>
            {recentActions.slice(0, 8).map((action: any) => (
              <div key={action.id} className="flex items-center gap-2 text-xs">
                {action.action_result === "OK" ? (
                  <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                ) : action.action_result === "FAILED" ? (
                  <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                ) : (
                  <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                <span className="truncate">{action.summary || action.action_type}</span>
                <span className="text-muted-foreground shrink-0 ml-auto">
                  {timeAgo(action.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
