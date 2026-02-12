/**
 * DailySyncHealthGate — Shows daily sync completeness for the last 7 days.
 *
 * Queries auto_sync_daily_ledger for recent runs and computes a completion rate.
 * Gate logic:
 *   - GREEN (≥90%): Healthy
 *   - YELLOW (50–89%): Incomplete
 *   - RED (<50%): Critical
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  CalendarSync,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface LedgerRow {
  id: string;
  run_date: string;
  status: string;
  items_targeted: number | null;
  items_succeeded: number | null;
  items_failed: number | null;
  items_skipped: number | null;
  expected_total_items: number | null;
  failure_reason: string | null;
  error_summary: Array<{ work_item_id: string; radicado?: string; error: string; ts?: string }> | null;
  started_at: string | null;
  finished_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function statusBadge(status: string) {
  switch (status) {
    case "SUCCESS":
      return <Badge variant="default" className="text-xs">✅ OK</Badge>;
    case "PARTIAL":
      return <Badge variant="secondary" className="text-xs">⚠️ Parcial</Badge>;
    case "FAILED":
      return <Badge variant="destructive" className="text-xs">❌ Fallido</Badge>;
    case "RUNNING":
      return <Badge variant="outline" className="text-xs">▶️ Ejecutando</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function durationStr(started: string | null, finished: string | null): string {
  if (!started || !finished) return "—";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  return `${Math.round(ms / 1000)}s`;
}

export function DailySyncHealthGate() {
  const { data: ledgerRows, isLoading } = useQuery({
    queryKey: ["daily-sync-ledger-health"],
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("auto_sync_daily_ledger")
        .select("id, run_date, status, items_targeted, items_succeeded, items_failed, items_skipped, expected_total_items, failure_reason, error_summary, started_at, finished_at, completed_at, created_at")
        .gte("run_date", sevenDaysAgo)
        .order("run_date", { ascending: false })
        .limit(14);

      if (error) {
        console.warn("[DailySyncHealth] Error:", error.message);
        return [];
      }
      return (data || []) as LedgerRow[];
    },
    refetchInterval: 120_000,
  });

  // Compute completion rate across recent runs
  const completedRuns = (ledgerRows || []).filter(
    (r) => r.status !== "RUNNING" && r.status !== "PENDING",
  );
  const totalExpected = completedRuns.reduce((s, r) => s + (r.expected_total_items || r.items_targeted || 0), 0);
  const totalSucceeded = completedRuns.reduce((s, r) => s + (r.items_succeeded || 0), 0);
  const completionRate = totalExpected > 0 ? Math.round((totalSucceeded / totalExpected) * 100) : 0;

  const latestRun = (ledgerRows || [])[0];

  // Gate color
  let gateColor: string;
  let gateIcon: typeof CheckCircle2;
  let gateLabel: string;

  if (completionRate >= 90) {
    gateColor = "text-green-500";
    gateIcon = CheckCircle2;
    gateLabel = "Sync diario saludable";
  } else if (completionRate >= 50) {
    gateColor = "text-amber-500";
    gateIcon = AlertTriangle;
    gateLabel = "Sync diario incompleto — revisar errores";
  } else {
    gateColor = "text-red-500";
    gateIcon = XCircle;
    gateLabel = "Sync diario crítico — menos del 50% procesado";
  }

  const GateIcon = gateIcon;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarSync className="h-4 w-4 text-primary" />
            Sync Diario — Completitud (7 días)
          </CardTitle>
          <div className="flex items-center gap-2">
            <GateIcon className={`h-4 w-4 ${gateColor}`} />
            <span className={`text-sm font-bold ${gateColor}`}>{completionRate}%</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : (
          <>
            {/* Gate summary */}
            <div className={`text-sm ${gateColor} flex items-center gap-2`}>
              <GateIcon className="h-4 w-4" />
              {gateLabel}
              {latestRun && (
                <span className="text-muted-foreground text-xs ml-2">
                  (último: {latestRun.items_succeeded ?? 0}/{latestRun.expected_total_items || latestRun.items_targeted || "?"} —{" "}
                  {latestRun.run_date})
                </span>
              )}
            </div>

            {/* Recent runs table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 px-1 font-medium">Fecha</th>
                    <th className="text-center py-1.5 px-1 font-medium">Estado</th>
                    <th className="text-center py-1.5 px-1 font-medium">Resultado</th>
                    <th className="text-center py-1.5 px-1 font-medium">Duración</th>
                    <th className="text-left py-1.5 px-1 font-medium">Razón</th>
                    <th className="text-left py-1.5 px-1 font-medium">Errores</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledgerRows || []).map((row) => {
                    const expected = row.expected_total_items || row.items_targeted || 0;
                    const succeeded = row.items_succeeded || 0;
                    const failed = row.items_failed || 0;
                    const skipped = row.items_skipped || 0;
                    const errors = row.error_summary || [];

                    return (
                      <tr key={row.id} className="border-b hover:bg-muted/50">
                        <td className="py-1.5 px-1 font-mono">{row.run_date}</td>
                        <td className="py-1.5 px-1 text-center">{statusBadge(row.status)}</td>
                        <td className="py-1.5 px-1 text-center">
                          <span className="text-green-600">{succeeded}✅</span>{" "}
                          <span className="text-red-600">{failed}❌</span>{" "}
                          <span className="text-muted-foreground">{skipped}⏭️</span>{" "}
                          <span className="text-muted-foreground">/ {expected}</span>
                        </td>
                        <td className="py-1.5 px-1 text-center text-muted-foreground">
                          {durationStr(row.started_at, row.finished_at || row.completed_at)}
                        </td>
                        <td className="py-1.5 px-1">
                          {row.failure_reason ? (
                            <Badge variant="outline" className="text-[10px]">{row.failure_reason}</Badge>
                          ) : "—"}
                        </td>
                        <td className="py-1.5 px-1">
                          {errors.length > 0 ? (
                            <Collapsible>
                              <CollapsibleTrigger className="flex items-center gap-1 text-destructive cursor-pointer">
                                {errors.length} error(es)
                                <ChevronDown className="h-3 w-3" />
                              </CollapsibleTrigger>
                              <CollapsibleContent className="mt-1 space-y-0.5">
                                {errors.slice(0, 10).map((e, i) => (
                                  <p key={i} className="text-[10px] text-muted-foreground font-mono truncate">
                                    {e.radicado || e.work_item_id?.slice(0, 8)} — {e.error}
                                  </p>
                                ))}
                                {errors.length > 10 && (
                                  <p className="text-[10px] text-muted-foreground">…y {errors.length - 10} más</p>
                                )}
                              </CollapsibleContent>
                            </Collapsible>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(!ledgerRows || ledgerRows.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Sin registros de sync diario en los últimos 7 días.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
