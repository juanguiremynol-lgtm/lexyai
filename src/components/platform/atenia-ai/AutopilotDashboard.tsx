/**
 * AutopilotDashboard — Supervisor panel section for the Autopilot Control Plane.
 *
 * Displays: last run time, actions taken, invariant violations, retry queue metrics,
 * demonitor gate breakdown, and a "Run Autopilot Now" button.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Bot,
  Loader2,
  ShieldAlert,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface Props {
  organizationId: string;
}

interface AutopilotSnapshot {
  ok: boolean;
  now: string;
  org_id: string;
  mode: string;
  config: Record<string, unknown>;
  health: {
    provider_status: Record<
      string,
      { avg_latency_ms: number; error_rate: number; degraded: boolean; total_calls: number; errors: number }
    >;
    sync: {
      total_monitored: number;
      synced_today: number;
      skipped_today: number;
      failures_today: number;
      scraping_pending_today: number;
      transient_without_retry: number;
      empty_result_count: number;
      empty_result_rate: number;
    };
    retry_queue: {
      pending_count: number;
      due_count: number;
      oldest_due_at: string | null;
      by_kind: Record<string, number>;
    };
    demonitors: {
      eligible_count: number;
      blocked_breakdown: Record<string, number>;
      executed_count: number;
    };
    invariants: {
      violations: Array<{
        code: string;
        severity: string;
        message: string;
        work_item_id?: string;
        radicado?: string;
      }>;
    };
  };
  actions_taken: Array<{
    type: string;
    work_item_id?: string;
    radicado?: string;
    reason: string;
  }>;
  duration_ms: number;
}

export function AutopilotDashboard({ organizationId }: Props) {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<AutopilotSnapshot | null>(null);

  // Last autopilot action from audit log
  const { data: lastRun } = useQuery({
    queryKey: ["autopilot-last-run", organizationId],
    queryFn: async () => {
      const { data } = await (supabase.from("atenia_ai_actions") as any)
        .select("created_at, action_type, action_result, evidence")
        .eq("organization_id", organizationId)
        .in("action_type", ["ENQUEUE_RETRY", "CREATE_ALERT", "TRIGGER_SYNC", "AUTO_DEMONITOR"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });

  const handleRunAutopilot = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("atenia-ai-autopilot", {
        body: { mode: "ON_DEMAND", organization_id: organizationId },
      });
      if (error) throw error;
      setSnapshot(data as AutopilotSnapshot);
      toast.success(`Autopilot completado en ${data?.duration_ms || 0}ms`);
      queryClient.invalidateQueries({ queryKey: ["autopilot-last-run"] });
    } catch (err: any) {
      toast.error("Error ejecutando Autopilot: " + (err.message || "desconocido"));
    } finally {
      setIsRunning(false);
    }
  };

  const health = snapshot?.health;
  const violations = health?.invariants?.violations || [];
  const actionsTaken = snapshot?.actions_taken || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            Autopilot Control Plane
          </CardTitle>
          <div className="flex items-center gap-2">
            {lastRun?.created_at && (
              <span className="text-[10px] text-muted-foreground">
                Última acción:{" "}
                {formatDistanceToNow(new Date(lastRun.created_at), { addSuffix: true, locale: es })}
              </span>
            )}
            <Button
              size="sm"
              variant="default"
              onClick={handleRunAutopilot}
              disabled={isRunning}
              className="gap-1.5 text-xs"
            >
              {isRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Ejecutar Autopilot
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!snapshot ? (
          <p className="text-xs text-muted-foreground">
            Ejecuta el Autopilot para obtener un snapshot en tiempo real de invariantes, cola de retries y
            estado de demonitoreo.
          </p>
        ) : (
          <>
            {/* Sync Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricBox label="Monitoreados" value={health!.sync.total_monitored} />
              <MetricBox label="Sincronizados hoy" value={health!.sync.synced_today} />
              <MetricBox label="Fallos hoy" value={health!.sync.failures_today} variant="destructive" />
              <MetricBox label="Scraping pendiente" value={health!.sync.scraping_pending_today} variant="warning" />
              <MetricBox label="Omitidos" value={health!.sync.skipped_today} />
              <MetricBox
                label="Transient sin retry"
                value={health!.sync.transient_without_retry}
                variant={health!.sync.transient_without_retry > 0 ? "destructive" : undefined}
              />
              <MetricBox
                label={`Vacíos 24h (${health!.sync.empty_result_rate}%)`}
                value={health!.sync.empty_result_count}
                variant={health!.sync.empty_result_rate > 20 ? "warning" : undefined}
              />
            </div>

            <Separator />

            {/* Retry Queue */}
            <div>
              <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Cola de Reintentos
              </h4>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Pendientes:</span>{" "}
                  <span className="font-semibold">{health!.retry_queue.pending_count}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Vencidos:</span>{" "}
                  <span className="font-semibold text-amber-600">{health!.retry_queue.due_count}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Más antiguo:</span>{" "}
                  <span className="font-semibold">
                    {health!.retry_queue.oldest_due_at
                      ? formatDistanceToNow(new Date(health!.retry_queue.oldest_due_at), {
                          addSuffix: true,
                          locale: es,
                        })
                      : "—"}
                  </span>
                </div>
              </div>
              {Object.keys(health!.retry_queue.by_kind).length > 0 && (
                <div className="flex gap-2 mt-1.5">
                  {Object.entries(health!.retry_queue.by_kind).map(([kind, count]) => (
                    <Badge key={kind} variant="outline" className="text-[10px]">
                      {kind}: {count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Demonitor Gates */}
            <div>
              <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Demonitoreo (Safety Gates)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Elegibles:</span>{" "}
                  <span className="font-semibold">{health!.demonitors.eligible_count}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] mr-1">PENDING_RETRY</Badge>
                  </span>
                  <span className="font-semibold">{health!.demonitors.blocked_breakdown.PENDING_RETRY || 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] mr-1">TRANSIENT_ERROR</Badge>
                  </span>
                  <span className="font-semibold">{health!.demonitors.blocked_breakdown.TRANSIENT_ERROR || 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] mr-1">RECENTLY_HEALTHY</Badge>
                  </span>
                  <span className="font-semibold">{health!.demonitors.blocked_breakdown.RECENTLY_HEALTHY || 0}</span>
                </div>
              </div>
            </div>

            {/* Invariant Violations */}
            {violations.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5 text-destructive">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Violaciones de Invariantes ({violations.length})
                  </h4>
                  <div className="space-y-2">
                    {violations.map((v, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs border rounded p-2">
                        {v.severity === "CRITICAL" ? (
                          <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={v.severity === "CRITICAL" ? "destructive" : "secondary"}
                              className="text-[10px]"
                            >
                              {v.code}
                            </Badge>
                            {v.radicado && (
                              <span className="text-muted-foreground">{v.radicado}</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-muted-foreground">{v.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Actions Taken */}
            {actionsTaken.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    Acciones Ejecutadas ({actionsTaken.length})
                  </h4>
                  <div className="space-y-1">
                    {actionsTaken.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {a.type}
                        </Badge>
                        {a.radicado && <span className="text-muted-foreground">{a.radicado}</span>}
                        <span className="text-muted-foreground">— {a.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {violations.length === 0 && actionsTaken.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                Todas las invariantes verificadas. Sin violaciones ni acciones correctivas necesarias.
              </div>
            )}

            {/* Run info */}
            <div className="text-[10px] text-muted-foreground flex items-center gap-2 pt-1">
              <Clock className="h-3 w-3" />
              Snapshot: {snapshot.now} · {snapshot.duration_ms}ms
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MetricBox({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: "destructive" | "warning";
}) {
  const colorClass =
    variant === "destructive"
      ? "text-destructive"
      : variant === "warning"
        ? "text-amber-600"
        : "";

  return (
    <div>
      <div className={`text-lg font-bold ${colorClass}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
