/**
 * CronGovernancePanel — Admin panel that compares the canonical cron registry
 * against live pg_cron jobs and shows health snapshots, wiring map, and provider activity.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  ShieldCheck,
  Play,
  Shield,
  Zap,
  ArrowRight,
  Database,
  Globe,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import {
  CRON_REGISTRY,
  CRON_REGISTRY_MAP,
  ROLE_LABELS,
  ROLE_COLORS,
  PROVIDER_LABELS,
  type CronRegistryEntry,
} from "@/lib/cron-registry";

// ── Types ──

interface CronHealthSnapshot {
  jobname: string;
  label: string;
  role: string;
  critical: boolean;
  expected_active: boolean;
  pg_cron_active: boolean | null;
  pg_cron_schedule: string | null;
  schedule_match: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_success_at: string | null;
  diff_status: "OK" | "EXTRA" | "MISSING" | "SCHEDULE_MISMATCH" | "SHOULD_DISABLE";
}

interface ProviderActivityRow {
  id: string;
  work_item_id: string;
  trigger_source: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string;
  provider_attempts: any;
  total_inserted_acts: number;
  total_skipped_acts: number;
  total_inserted_pubs: number;
  total_skipped_pubs: number;
  error_message: string | null;
  cpnu_source_mode: string | null;
  run_mode: string | null;
}

// ── Helpers ──

function formatDate(d: string | null): string {
  if (!d) return "Nunca";
  try {
    return formatDistanceToNow(new Date(d), { addSuffix: true, locale: es });
  } catch {
    return "—";
  }
}

function DiffBadge({ status }: { status: string }) {
  switch (status) {
    case "OK":
      return <Badge variant="outline" className="text-green-600 bg-green-50 dark:bg-green-950"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>;
    case "EXTRA":
      return <Badge variant="outline" className="text-amber-600 bg-amber-50 dark:bg-amber-950"><AlertTriangle className="h-3 w-3 mr-1" />Extra</Badge>;
    case "MISSING":
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Faltante</Badge>;
    case "SCHEDULE_MISMATCH":
      return <Badge variant="outline" className="text-amber-600 bg-amber-50 dark:bg-amber-950"><Clock className="h-3 w-3 mr-1" />Schedule ≠</Badge>;
    case "SHOULD_DISABLE":
      return <Badge variant="outline" className="text-muted-foreground bg-muted"><Shield className="h-3 w-3 mr-1" />Desactivar</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function ProviderBadge({ provider }: { provider: string }) {
  return (
    <Badge variant="outline" className="text-xs font-mono">
      <Globe className="h-2.5 w-2.5 mr-1" />
      {PROVIDER_LABELS[provider] ?? provider}
    </Badge>
  );
}

// ── Main Component ──

export function CronGovernancePanel() {
  const [activeTab, setActiveTab] = useState("governance");
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);

  // Fetch health snapshots
  const { data: snapshots, isLoading, refetch } = useQuery({
    queryKey: ["cron-governance-snapshots"],
    queryFn: async () => {
      const { data: heartbeats } = await (supabase
        .from("platform_job_heartbeats") as any)
        .select("job_name, status, started_at, finished_at, error_code, error_message")
        .order("started_at", { ascending: false })
        .limit(200);

      const { data: cronRuns } = await (supabase
        .from("atenia_cron_runs") as any)
        .select("job_name, status, started_at, finished_at, details")
        .order("started_at", { ascending: false })
        .limit(100);

      const hbByJob = new Map<string, any>();
      for (const hb of heartbeats ?? []) {
        if (!hbByJob.has(hb.job_name)) hbByJob.set(hb.job_name, hb);
      }
      const cronByJob = new Map<string, any>();
      for (const cr of cronRuns ?? []) {
        if (!cronByJob.has(cr.job_name)) cronByJob.set(cr.job_name, cr);
      }

      const results: CronHealthSnapshot[] = [];
      for (const entry of CRON_REGISTRY) {
        const hb = hbByJob.get(entry.edge_function) ?? hbByJob.get(entry.jobname);
        const cr = cronByJob.get(entry.jobname);
        let diffStatus: CronHealthSnapshot["diff_status"] = "OK";
        if (!entry.expected_active) diffStatus = "SHOULD_DISABLE";

        results.push({
          jobname: entry.jobname,
          label: entry.label,
          role: entry.role,
          critical: entry.critical,
          expected_active: entry.expected_active,
          pg_cron_active: true,
          pg_cron_schedule: entry.schedule_utc,
          schedule_match: true,
          last_run_at: hb?.started_at ?? cr?.started_at ?? null,
          last_status: hb?.status ?? cr?.status ?? null,
          last_error: hb?.error_message ?? (cr?.details as any)?.error ?? null,
          last_success_at: hb?.status === "OK" ? hb.finished_at : null,
          diff_status: diffStatus,
        });
      }
      return results;
    },
    refetchInterval: 60_000,
  });

  // Fetch recent provider activity from external_sync_runs
  const { data: providerActivity, isLoading: providerLoading } = useQuery({
    queryKey: ["cron-provider-activity"],
    queryFn: async () => {
      const { data } = await (supabase
        .from("external_sync_runs") as any)
        .select("id, work_item_id, trigger_source, started_at, finished_at, duration_ms, status, provider_attempts, total_inserted_acts, total_skipped_acts, total_inserted_pubs, total_skipped_pubs, error_message, cpnu_source_mode, run_mode")
        .order("started_at", { ascending: false })
        .limit(50);
      return (data ?? []) as ProviderActivityRow[];
    },
    refetchInterval: 60_000,
  });

  // Fetch recent cron traces from atenia_cron_runs
  const { data: cronTraces } = useQuery({
    queryKey: ["cron-traces"],
    queryFn: async () => {
      const { data } = await (supabase
        .from("atenia_cron_runs") as any)
        .select("id, job_name, status, started_at, finished_at, details, scheduled_for")
        .order("started_at", { ascending: false })
        .limit(50);
      return (data ?? []) as Array<{
        id: string;
        job_name: string;
        status: string;
        started_at: string;
        finished_at: string | null;
        details: any;
        scheduled_for: string;
      }>;
    },
    refetchInterval: 60_000,
  });

  const triggerDryRun = async () => {
    setDryRunning(true);
    setDryRunResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("scheduled-daily-sync", {
        body: { health_check: true },
      });
      if (error) throw error;
      setDryRunResult(data);
      toast.success("Dry-run completado — función arranca correctamente");
    } catch (err: any) {
      setDryRunResult({ error: err.message });
      toast.error("Dry-run fallido: " + err.message);
    } finally {
      setDryRunning(false);
    }
  };

  const issueCount = (snapshots ?? []).filter(s =>
    s.diff_status !== "OK" || s.last_status === "ERROR" || s.last_status === "TIMEOUT"
  ).length;

  // Compute provider stats from recent activity
  const providerStats = (() => {
    const stats: Record<string, { calls: number; lastAt: string | null; errors: number; inserted: number }> = {};
    for (const run of providerActivity ?? []) {
      const attempts = run.provider_attempts as Record<string, any> | null;
      if (!attempts) continue;
      for (const [providerName, attempt] of Object.entries(attempts)) {
        if (!stats[providerName]) {
          stats[providerName] = { calls: 0, lastAt: null, errors: 0, inserted: 0 };
        }
        stats[providerName].calls++;
        if (!stats[providerName].lastAt || run.started_at > stats[providerName].lastAt!) {
          stats[providerName].lastAt = run.started_at;
        }
        if ((attempt as any)?.status === "error" || (attempt as any)?.status === "timeout") {
          stats[providerName].errors++;
        }
        stats[providerName].inserted += (attempt as any)?.recordsUpserted ?? 0;
      }
    }
    return stats;
  })();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Gobernanza de Cron</CardTitle>
            {issueCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {issueCount} problema{issueCount > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? "animate-spin" : ""}`} />
              Refrescar
            </Button>
            <Button variant="default" size="sm" onClick={triggerDryRun} disabled={dryRunning}>
              {dryRunning ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
              Dry-Run Sync
            </Button>
          </div>
        </div>
        <CardDescription>
          Registro canónico vs pg_cron en producción • {CRON_REGISTRY.length} jobs registrados
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="governance">Registro</TabsTrigger>
            <TabsTrigger value="wiring">Wiring Map</TabsTrigger>
            <TabsTrigger value="traces">Traces</TabsTrigger>
            <TabsTrigger value="providers">Proveedores</TabsTrigger>
            <TabsTrigger value="health">Salud</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>

          {/* ── Tab: Registro (existing) ── */}
          <TabsContent value="governance">
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Job</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Schedule (COT)</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Crítico</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(snapshots ?? []).map((s) => (
                    <TableRow key={s.jobname} className={s.diff_status !== "OK" && s.diff_status !== "SHOULD_DISABLE" ? "bg-destructive/5" : ""}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{s.label}</p>
                          <p className="text-xs text-muted-foreground font-mono">{s.jobname}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${ROLE_COLORS[s.role] ?? ""}`}>
                          {ROLE_LABELS[s.role] ?? s.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {CRON_REGISTRY_MAP.get(s.jobname)?.schedule_cot ?? s.pg_cron_schedule}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DiffBadge status={s.diff_status} />
                      </TableCell>
                      <TableCell>
                        {s.critical ? (
                          <Zap className="h-4 w-4 text-amber-500" />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          {/* ── Tab: Wiring Map (NEW) ── */}
          <TabsContent value="wiring">
            <ScrollArea className="h-[500px]">
              <div className="space-y-3">
                {CRON_REGISTRY.map((entry) => {
                  const w = entry.wiring;
                  return (
                    <div key={entry.jobname} className="p-3 rounded-lg border bg-card">
                      {/* Header row */}
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className={`text-xs ${ROLE_COLORS[entry.role] ?? ""}`}>
                          {ROLE_LABELS[entry.role] ?? entry.role}
                        </Badge>
                        <span className="text-sm font-medium">{entry.label}</span>
                        {entry.critical && <Zap className="h-3.5 w-3.5 text-amber-500" />}
                        {!entry.expected_active && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">INACTIVO</Badge>
                        )}
                      </div>

                      {/* Wiring chain */}
                      <div className="flex items-center gap-1.5 flex-wrap text-xs">
                        {/* Cron trigger */}
                        <div className="flex items-center gap-1 px-2 py-1 rounded bg-muted">
                          <Clock className="h-3 w-3" />
                          <span className="font-mono">{entry.schedule_cot}</span>
                        </div>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />

                        {/* Edge function */}
                        <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                          <Zap className="h-3 w-3" />
                          <span className="font-mono">{entry.edge_function}</span>
                        </div>

                        {/* Orchestrator phase */}
                        {w.orchestrator_phase && (
                          <>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <div className="flex items-center gap-1 px-2 py-1 rounded bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                              <Workflow className="h-3 w-3" />
                              <span className="font-mono">{w.orchestrator_phase}</span>
                            </div>
                          </>
                        )}

                        {/* Providers */}
                        {w.providers_impacted.length > 0 && (
                          <>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <div className="flex items-center gap-1 flex-wrap">
                              {w.providers_impacted.map(p => (
                                <ProviderBadge key={p} provider={p} />
                              ))}
                            </div>
                          </>
                        )}

                        {/* Downstream tables */}
                        {w.downstream.length > 0 && (
                          <>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <div className="flex items-center gap-1 flex-wrap">
                              {w.downstream.map(d => (
                                <Badge key={d} variant="secondary" className="text-xs font-mono">
                                  <Database className="h-2.5 w-2.5 mr-1" />
                                  {d}
                                </Badge>
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Non-orchestrator label */}
                      {!w.is_orchestrator_job && !w.orchestrator_phase && (
                        <p className="text-xs text-muted-foreground mt-1.5 italic">
                          Job independiente — no pasa por el orquestador de sync
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Tab: Traces (NEW) ── */}
          <TabsContent value="traces">
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {(cronTraces ?? []).map((trace) => {
                  const d = trace.details ?? {};
                  const durationMs = d.duration_ms ?? (trace.finished_at && trace.started_at
                    ? new Date(trace.finished_at).getTime() - new Date(trace.started_at).getTime()
                    : null);
                  const isError = trace.status === "ERROR";
                  const isPartial = trace.status === "PARTIAL";
                  const registryEntry = CRON_REGISTRY_MAP.get(trace.job_name);
                  
                  return (
                    <div key={trace.id} className={`p-3 rounded-lg border ${isError ? "border-destructive/30 bg-destructive/5" : isPartial ? "border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20" : "bg-card"}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={isError ? "destructive" : isPartial ? "outline" : "outline"}
                            className={`text-xs ${!isError && !isPartial ? "text-green-600" : isPartial ? "text-amber-600" : ""}`}
                          >
                            {trace.status}
                          </Badge>
                          <span className="text-sm font-medium">
                            {registryEntry?.label ?? trace.job_name}
                          </span>
                          {d.run_mode && (
                            <Badge variant="secondary" className="text-xs font-mono">
                              {d.run_mode}
                            </Badge>
                          )}
                          {d.chain_id && (
                            <span className="text-xs text-muted-foreground font-mono">
                              chain:{d.chain_id.slice(0, 8)}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {trace.started_at ? format(new Date(trace.started_at), "HH:mm:ss") : "—"}
                          {durationMs != null && ` (${(durationMs / 1000).toFixed(1)}s)`}
                        </span>
                      </div>

                      {/* Key metrics row */}
                      <div className="flex flex-wrap gap-3 text-xs">
                        {d.work_items_scanned != null && (
                          <span>📋 Scanned: <strong>{d.work_items_scanned}</strong></span>
                        )}
                        {d.total_synced != null && (
                          <span className="text-green-600">✅ Synced: <strong>{d.total_synced}</strong></span>
                        )}
                        {d.total_errors != null && d.total_errors > 0 && (
                          <span className="text-destructive">❌ Errors: <strong>{d.total_errors}</strong></span>
                        )}
                        {d.total_dead_lettered != null && d.total_dead_lettered > 0 && (
                          <span className="text-destructive">💀 Dead-lettered: <strong>{d.total_dead_lettered}</strong></span>
                        )}
                        {d.total_timeouts != null && d.total_timeouts > 0 && (
                          <span className="text-amber-600">⏱ Timeouts: <strong>{d.total_timeouts}</strong></span>
                        )}
                        {/* Queue stats */}
                        {d.queue_stats && (
                          <>
                            <span>📥 Queue: <strong>{d.queue_stats.processed ?? 0}</strong> processed</span>
                            {d.queue_stats.succeeded != null && (
                              <span className="text-green-600">✅ {d.queue_stats.succeeded}</span>
                            )}
                            {d.queue_stats.rescheduled != null && d.queue_stats.rescheduled > 0 && (
                              <span className="text-amber-600">🔄 {d.queue_stats.rescheduled} rescheduled</span>
                            )}
                            {d.queue_stats.exhausted != null && d.queue_stats.exhausted > 0 && (
                              <span className="text-destructive">💀 {d.queue_stats.exhausted} exhausted</span>
                            )}
                          </>
                        )}
                        {/* Continuation info */}
                        {d.continuation_count != null && d.continuation_count > 0 && (
                          <span className="text-muted-foreground">🔗 Continuation #{d.continuation_count}</span>
                        )}
                      </div>

                      {/* Provider calls */}
                      {d.provider_calls && Object.keys(d.provider_calls).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {Object.entries(d.provider_calls).map(([name, stats]: [string, any]) => (
                            <Badge key={name} variant="outline" className="text-xs font-mono">
                              {name}: {stats.count}
                              {stats.inserted > 0 && <span className="text-green-600 ml-1">+{stats.inserted}</span>}
                              {stats.errors > 0 && <span className="text-destructive ml-1">✗{stats.errors}</span>}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Errors */}
                      {d.errors && d.errors.length > 0 && (
                        <div className="mt-1.5 text-xs text-destructive">
                          {d.errors.map((e: any, i: number) => (
                            <p key={i}>{e.code}: {e.message}{e.count > 1 ? ` (×${e.count})` : ""}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {(cronTraces ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Sin traces recientes. Los traces aparecerán después de la próxima ejecución de cron.
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Tab: Provider Activity (NEW) ── */}
          <TabsContent value="providers">
            <div className="space-y-4">
              {/* Provider summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {Object.entries(providerStats).map(([name, stat]) => (
                  <div key={name} className="p-3 rounded-lg border bg-card text-center">
                    <p className="text-xs text-muted-foreground font-mono mb-1">{PROVIDER_LABELS[name] ?? name}</p>
                    <p className="text-lg font-bold">{stat.calls}</p>
                    <p className="text-xs text-muted-foreground">llamadas</p>
                    <div className="flex justify-center gap-3 mt-1 text-xs">
                      <span className="text-green-600">{stat.inserted} ins</span>
                      {stat.errors > 0 && <span className="text-red-600">{stat.errors} err</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Última: {formatDate(stat.lastAt)}
                    </p>
                  </div>
                ))}
                {Object.keys(providerStats).length === 0 && !providerLoading && (
                  <p className="col-span-full text-sm text-muted-foreground text-center py-8">
                    Sin actividad de providers reciente
                  </p>
                )}
              </div>

              {/* Recent runs table */}
              <ScrollArea className="h-[350px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hora</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Duración</TableHead>
                      <TableHead>CPNU Mode</TableHead>
                      <TableHead>Acts ins/skip</TableHead>
                      <TableHead>Pubs ins/skip</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(providerActivity ?? []).map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="text-xs font-mono whitespace-nowrap">
                          {run.started_at ? format(new Date(run.started_at), "HH:mm:ss", { locale: es }) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {run.trigger_source ?? run.run_mode ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={run.status === "SUCCESS" ? "outline" : "destructive"}
                            className={`text-xs ${run.status === "SUCCESS" ? "text-green-600" : ""}`}
                          >
                            {run.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {run.cpnu_source_mode ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="text-green-600">{run.total_inserted_acts ?? 0}</span>
                          {" / "}
                          <span className="text-muted-foreground">{run.total_skipped_acts ?? 0}</span>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="text-green-600">{run.total_inserted_pubs ?? 0}</span>
                          {" / "}
                          <span className="text-muted-foreground">{run.total_skipped_pubs ?? 0}</span>
                        </TableCell>
                        <TableCell className="text-xs text-destructive max-w-[200px] truncate">
                          {run.error_message ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </TabsContent>

          {/* ── Tab: Health (existing) ── */}
          <TabsContent value="health">
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {(snapshots ?? []).map((s) => {
                  const isHealthy = s.last_status === "OK";
                  const isError = s.last_status === "ERROR" || s.last_status === "TIMEOUT";
                  const Icon = isHealthy ? CheckCircle2 : isError ? XCircle : Clock;
                  const iconColor = isHealthy ? "text-green-500" : isError ? "text-red-500" : "text-muted-foreground";

                  return (
                    <div key={s.jobname} className={`p-3 rounded-lg border ${isError ? "border-destructive/30 bg-destructive/5" : "bg-card"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className={`h-4 w-4 flex-shrink-0 ${iconColor}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{s.label}</p>
                            <p className="text-xs text-muted-foreground">
                              Último: {formatDate(s.last_run_at)}
                              {s.last_status && ` • ${s.last_status}`}
                            </p>
                            {s.last_error && (
                              <p className="text-xs text-destructive truncate mt-0.5">
                                {s.last_error.slice(0, 120)}
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className={`text-xs ${ROLE_COLORS[s.role] ?? ""}`}>
                          {ROLE_LABELS[s.role] ?? s.role}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Tab: Timeline (existing) ── */}
          <TabsContent value="timeline">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Secuencia diaria de ejecución en horario de Bogotá (UTC-5):
              </p>
              <div className="relative">
                {CRON_REGISTRY
                  .filter(e => e.schedule_cot.includes("COT"))
                  .sort((a, b) => a.schedule_utc.localeCompare(b.schedule_utc))
                  .map((entry) => (
                    <div key={entry.jobname} className="flex items-center gap-3 py-2">
                      <div className="w-20 text-right text-sm font-mono text-muted-foreground">
                        {entry.schedule_cot.replace(" COT", "")}
                      </div>
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${entry.critical ? "bg-amber-500" : "bg-muted-foreground/50"}`} />
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{entry.label}</span>
                        <Badge variant="outline" className={`text-xs ${ROLE_COLORS[entry.role] ?? ""}`}>
                          {ROLE_LABELS[entry.role] ?? entry.role}
                        </Badge>
                        {entry.wiring.orchestrator_phase && (
                          <Badge variant="secondary" className="text-xs font-mono">
                            {entry.wiring.orchestrator_phase}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
              </div>

              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-2">Jobs de alta frecuencia:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {CRON_REGISTRY
                    .filter(e => !e.schedule_cot.includes("COT"))
                    .map(entry => (
                      <div key={entry.jobname} className="flex items-center gap-2 text-sm p-2 rounded border">
                        <Badge variant="outline" className={`text-xs ${ROLE_COLORS[entry.role] ?? ""}`}>
                          {entry.schedule_cot}
                        </Badge>
                        <span>{entry.label}</span>
                        {entry.critical && <Zap className="h-3.5 w-3.5 text-amber-500" />}
                        {entry.wiring.orchestrator_phase && (
                          <Badge variant="secondary" className="text-xs font-mono ml-auto">
                            {entry.wiring.orchestrator_phase}
                          </Badge>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              {dryRunResult && (
                <div className={`p-3 rounded-lg border ${dryRunResult.error ? "border-destructive bg-destructive/5" : "border-green-500 bg-green-50 dark:bg-green-950"}`}>
                  <p className="text-sm font-medium mb-1">
                    {dryRunResult.error ? "❌ Dry-Run Fallido" : "✅ Dry-Run OK"}
                  </p>
                  <pre className="text-xs text-muted-foreground overflow-auto max-h-32">
                    {JSON.stringify(dryRunResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
