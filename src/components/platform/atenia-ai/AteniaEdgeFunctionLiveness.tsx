/**
 * AteniaEdgeFunctionLiveness — Shows liveness status of critical edge functions.
 * Probes each function via the watchdog's last run or on-demand.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, XCircle, Server, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const CRITICAL_FUNCTIONS = [
  { name: "scheduled-daily-sync", label: "Sync Diario" },
  { name: "scheduled-publicaciones-monitor", label: "Monitor Publicaciones" },
  { name: "sync-by-work-item", label: "Sync por Asunto" },
  { name: "sync-publicaciones-by-work-item", label: "Sync Publicaciones" },
  { name: "fallback-sync-check", label: "Fallback Sync" },
  { name: "atenia-ai-supervisor", label: "Supervisor AI" },
  { name: "provider-sync-external-provider", label: "Sync Externo" },
];

export function AteniaEdgeFunctionLiveness() {
  const [isProbing, setIsProbing] = useState(false);
  const [probeResults, setProbeResults] = useState<Record<string, { ok: boolean; status?: number; error?: string }>>({});

  // Get last watchdog liveness results from atenia_ai_actions
  const { data: lastLivenessAction } = useQuery({
    queryKey: ["edge-fn-liveness-last"],
    queryFn: async () => {
      const { data } = await (supabase
        .from("atenia_ai_actions") as any)
        .select("evidence, created_at")
        .eq("action_type", "WATCHDOG_EDGE_FUNCTION_DOWN")
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    },
    staleTime: 1000 * 60 * 2,
  });

  // Get pending EDGE_FUNCTION_REDEPLOY remediation tasks
  const { data: redeployTasks } = useQuery({
    queryKey: ["edge-fn-redeploy-tasks"],
    queryFn: async () => {
      const { data } = await (supabase
        .from("atenia_ai_remediation_queue") as any)
        .select("id, payload, status, created_at")
        .eq("action_type", "EDGE_FUNCTION_REDEPLOY")
        .in("status", ["PENDING", "RUNNING"])
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
    staleTime: 1000 * 30,
  });

  const handleProbe = async () => {
    setIsProbing(true);
    const results: Record<string, { ok: boolean; status?: number; error?: string }> = {};

    try {
      const probes = CRITICAL_FUNCTIONS.map(async (fn) => {
        try {
          // Use supabase.functions.invoke with a minimal body — it will fail fast if function doesn't exist
          const resp = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn.name}`,
            { method: "OPTIONS" }
          );
          results[fn.name] = { ok: resp.status < 500, status: resp.status };
        } catch (err: any) {
          results[fn.name] = { ok: false, error: err.message?.slice(0, 100) };
        }
      });

      await Promise.all(probes);
      setProbeResults(results);

      const dead = Object.entries(results).filter(([, v]) => !v.ok);
      if (dead.length === 0) {
        toast.success("Todas las funciones Edge están respondiendo");
      } else {
        toast.error(`${dead.length} función(es) no responden: ${dead.map(([k]) => k).join(", ")}`);
      }
    } finally {
      setIsProbing(false);
    }
  };

  const hasProbed = Object.keys(probeResults).length > 0;
  const deadFromWatchdog = lastLivenessAction?.evidence?.dead_functions ?? [];
  const hasWatchdogIssues = deadFromWatchdog.length > 0;

  return (
    <Card className={hasWatchdogIssues ? "border-red-500/50" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="h-4 w-4" />
            Edge Function Liveness
          </CardTitle>
          <Button variant="outline" size="sm" onClick={handleProbe} disabled={isProbing}>
            {isProbing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Probar ahora
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Watchdog alert banner */}
        {hasWatchdogIssues && (
          <div className="mb-4 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm">
            <p className="font-medium text-red-400">
              El Watchdog detectó {deadFromWatchdog.length} función(es) sin desplegar
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Última detección: {lastLivenessAction?.created_at ? new Date(lastLivenessAction.created_at).toLocaleString("es-CO") : "—"}
            </p>
          </div>
        )}

        {/* Pending redeploy tasks */}
        {redeployTasks && redeployTasks.length > 0 && (
          <div className="mb-4 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-sm">
            <p className="font-medium text-yellow-400">
              {redeployTasks.length} tarea(s) de redespliegue pendientes
            </p>
            <div className="mt-1 space-y-1">
              {redeployTasks.map((task: any) => (
                <p key={task.id} className="text-xs text-muted-foreground font-mono">
                  {task.payload?.function_name ?? "?"} — {task.status}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Function grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CRITICAL_FUNCTIONS.map((fn) => {
            const result = probeResults[fn.name];
            const watchdogDead = deadFromWatchdog.some((d: any) => d.fn === fn.name);

            let statusIcon;
            let statusLabel;
            if (hasProbed && result) {
              statusIcon = result.ok
                ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                : <XCircle className="h-4 w-4 text-red-500" />;
              statusLabel = result.ok ? "OK" : `Error ${result.status ?? ""}`;
            } else if (watchdogDead) {
              statusIcon = <XCircle className="h-4 w-4 text-red-500" />;
              statusLabel = "No desplegada";
            } else {
              statusIcon = <div className="h-4 w-4 rounded-full bg-muted" />;
              statusLabel = "Sin verificar";
            }

            return (
              <div key={fn.name} className="flex items-center justify-between p-2 rounded border bg-muted/30">
                <div className="flex items-center gap-2">
                  {statusIcon}
                  <div>
                    <p className="text-sm font-medium">{fn.label}</p>
                    <p className="text-xs text-muted-foreground font-mono">{fn.name}</p>
                  </div>
                </div>
                <Badge variant={
                  hasProbed && result?.ok ? "default" :
                  (hasProbed && !result?.ok) || watchdogDead ? "destructive" :
                  "outline"
                } className="text-xs">
                  {statusLabel}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
