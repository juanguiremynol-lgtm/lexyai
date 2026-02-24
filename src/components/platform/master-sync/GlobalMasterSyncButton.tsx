/**
 * Global Master Sync — Platform Console button that invokes the
 * server-side `global-master-sync` edge function (enqueue + kick pattern).
 *
 * Flow: idle → dry_run (preview) → confirm → kicking → polling → done/error
 * With live visual progress: progress bar, per-org animated status, elapsed timer.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  RefreshCw, Loader2, AlertTriangle, CheckCircle, Globe,
  ChevronDown, ChevronUp, Play, Eye, Clock, Zap, Building2,
  XCircle, SkipForward, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────

interface KickResult {
  ok: boolean;
  master_chain_id: string;
  heartbeat_id: string | null;
  total_orgs: number;
  kicked_orgs: Array<{ org_id: string; status: string; error?: string }>;
  skipped_orgs: Array<{ org_id: string; reason: string }>;
  started_at: string;
  duration_ms: number;
  error?: string;
}

interface OrgProgress {
  organization_id: string;
  status: string;
  trigger_source: string;
  chain_id: string;
  items_succeeded: number;
  items_failed: number;
  items_skipped: number;
  dead_letter_count: number;
  timeout_count: number;
  continuation_block_reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface ChainProgress {
  total_orgs: number;
  orgs_done: number;
  orgs_error: number;
  orgs_running: number;
  total_items_succeeded: number;
  total_items_failed: number;
  total_items_skipped: number;
  total_dead_letter: number;
  all_done: boolean;
  org_details: OrgProgress[];
}

interface DryRunPreview {
  orgs: Array<{
    org_id: string;
    org_name: string | null;
    eligible_items: number;
    monitoring_enabled_count: number;
  }>;
  total_eligible: number;
  total_orgs: number;
}

type Phase = "idle" | "dry_run_loading" | "dry_run_preview" | "kicking" | "polling" | "done" | "error";

// ─── Helpers ─────────────────────────────────────────────────────────

function aggregateFromOrgRows(rows: OrgProgress[]): ChainProgress {
  const terminalStatuses = ["SUCCESS", "FAILED", "PARTIAL"];
  let orgsDone = 0, orgsError = 0, orgsRunning = 0;
  let totalSucceeded = 0, totalFailed = 0, totalSkipped = 0, totalDL = 0;

  for (const r of rows) {
    const isTerminal = terminalStatuses.includes(r.status);
    if (isTerminal && r.status === "SUCCESS") orgsDone++;
    else if (isTerminal) orgsError++;
    else orgsRunning++;

    totalSucceeded += r.items_succeeded || 0;
    totalFailed += r.items_failed || 0;
    totalSkipped += r.items_skipped || 0;
    totalDL += r.dead_letter_count || 0;
  }

  return {
    total_orgs: rows.length,
    orgs_done: orgsDone,
    orgs_error: orgsError,
    orgs_running: orgsRunning,
    total_items_succeeded: totalSucceeded,
    total_items_failed: totalFailed,
    total_items_skipped: totalSkipped,
    total_dead_letter: totalDL,
    all_done: orgsRunning === 0,
    org_details: rows,
  };
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${s}s`;
}

function orgStatusIcon(status: string) {
  switch (status) {
    case "SUCCESS": return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    case "FAILED": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "PARTIAL": return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    case "RUNNING": case "PENDING": return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
    default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

// ─── Component ───────────────────────────────────────────────────────

export function GlobalMasterSyncButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [kickResult, setKickResult] = useState<KickResult | null>(null);
  const [progress, setProgress] = useState<ChainProgress | null>(null);
  const [dryRunPreview, setDryRunPreview] = useState<DryRunPreview | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Elapsed timer
  useEffect(() => {
    if (startTime && (phase === "kicking" || phase === "polling")) {
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTime);
      }, 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  }, [startTime, phase]);

  // ─── Dry Run ─────────────────────────────────────────────────────

  const runDryRun = useCallback(async () => {
    setPhase("dry_run_loading");
    setDryRunPreview(null);

    try {
      // Query orgs with eligible work items
      const { data: orgRows, error: orgErr } = await supabase
        .from("work_items")
        .select("organization_id")
        .eq("monitoring_enabled", true)
        .not("radicado", "is", null)
        .not("organization_id", "is", null);

      if (orgErr) throw orgErr;

      const orgMap = new Map<string, number>();
      for (const r of (orgRows || [])) {
        if (!r.organization_id) continue;
        orgMap.set(r.organization_id, (orgMap.get(r.organization_id) || 0) + 1);
      }

      // Fetch org names
      const orgIds = [...orgMap.keys()];
      const { data: orgsData } = await supabase
        .from("organizations")
        .select("id, name")
        .in("id", orgIds);

      const nameMap = new Map<string, string>();
      for (const o of (orgsData || [])) {
        nameMap.set(o.id, o.name);
      }

      const orgs = orgIds.map(id => ({
        org_id: id,
        org_name: nameMap.get(id) || null,
        eligible_items: orgMap.get(id) || 0,
        monitoring_enabled_count: orgMap.get(id) || 0,
      }));

      const totalEligible = orgs.reduce((sum, o) => sum + o.eligible_items, 0);

      setDryRunPreview({
        orgs,
        total_eligible: totalEligible,
        total_orgs: orgs.length,
      });
      setPhase("dry_run_preview");
    } catch (err: any) {
      console.error("[GlobalMasterSync] DryRun error:", err);
      setPhase("error");
      toast.error("Error en dry-run: " + (err?.message || "desconocido"));
    }
  }, []);

  // ─── Polling ─────────────────────────────────────────────────────

  const pollProgress = useCallback((chainId: string) => {
    let consecutiveErrors = 0;

    const poll = async () => {
      try {
        const { data: rows, error } = await supabase.rpc("get_chain_progress", {
          p_chain_id: chainId,
        });

        if (error) {
          const msg = error.message || "";
          if (msg.includes("platform admin") || msg.includes("Not authorized") || error.code === "42501") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setPhase("error");
            toast.error("Acceso denegado: se requiere rol de platform admin");
            return;
          }
          consecutiveErrors++;
          if (consecutiveErrors >= 5) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setPhase("error");
            toast.error("Polling detenido tras errores consecutivos");
          }
          return;
        }

        consecutiveErrors = 0;
        if (!rows || rows.length === 0) return;

        const agg = aggregateFromOrgRows(rows as OrgProgress[]);
        setProgress(agg);

        if (agg.all_done) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPhase(agg.orgs_error > 0 ? "error" : "done");

          if (agg.orgs_error === 0) {
            toast.success(`Global sync completado: ${agg.total_items_succeeded} exitosos en ${agg.total_orgs} org(s)`);
          } else {
            toast.warning(`Global sync parcial: ${agg.orgs_done} OK, ${agg.orgs_error} con errores`);
          }
        }
      } catch {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPhase("error");
        }
      }
    };

    poll();
    pollRef.current = setInterval(poll, 4000);
  }, []);

  // ─── Execute ─────────────────────────────────────────────────────

  const runGlobalSync = useCallback(async () => {
    if (phase === "kicking" || phase === "polling") return;
    setPhase("kicking");
    setKickResult(null);
    setProgress(null);
    setStartTime(Date.now());
    setElapsed(0);

    try {
      toast.info("Iniciando sincronización global (enqueue + kick)…");

      const { data, error } = await supabase.functions.invoke("global-master-sync", {
        body: {},
      });

      if (error) throw error;

      const res = data as KickResult;
      setKickResult(res);

      if (!res.ok) {
        setPhase("error");
        toast.error("Global sync kickoff falló: " + (res.error || "desconocido"));
        return;
      }

      toast.success(`Kickoff OK: ${res.kicked_orgs.length} org(s) iniciadas, ${res.skipped_orgs.length} omitidas (${res.duration_ms}ms)`);

      if (res.kicked_orgs.length === 0) {
        setPhase("done");
        return;
      }

      setPhase("polling");
      setShowDetails(true);
      pollProgress(res.master_chain_id);
    } catch (err: any) {
      console.error("[GlobalMasterSync] Error:", err);
      setPhase("error");
      toast.error("Error invocando global-master-sync: " + (err?.message || "desconocido"));
    }
  }, [phase, pollProgress]);

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    pollRef.current = null;
    timerRef.current = null;
    setPhase("idle");
    setKickResult(null);
    setProgress(null);
    setDryRunPreview(null);
    setShowDetails(false);
    setStartTime(null);
    setElapsed(0);
  };

  const progressPercent = progress
    ? Math.round(((progress.orgs_done + progress.orgs_error) / Math.max(progress.total_orgs, 1)) * 100)
    : 0;

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-destructive" />
            <div>
              <CardTitle className="text-base">Sincronización Global (Override Manual)</CardTitle>
              <CardDescription className="text-xs">
                Sincroniza TODOS los asuntos de TODAS las organizaciones via scheduled-daily-sync.
              </CardDescription>
            </div>
          </div>
          {(phase === "polling" || phase === "kicking") && startTime && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono tabular-nums">
              <Clock className="h-3.5 w-3.5 animate-pulse" />
              {formatElapsed(elapsed)}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ═══ IDLE ═══ */}
        {phase === "idle" && (
          <div className="space-y-3">
            <div className="p-3 rounded-md border border-destructive/20 bg-destructive/5 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Acción de alto impacto
              </div>
              <p className="text-muted-foreground">
                Enqueue + kick: crea ledger entries por org y dispara scheduled-daily-sync para cada una.
              </p>
            </div>
            <Button onClick={runDryRun} variant="outline" size="sm" className="gap-1.5">
              <Eye className="h-4 w-4" />
              Vista previa (dry-run)
            </Button>
          </div>
        )}

        {/* ═══ DRY RUN LOADING ═══ */}
        {phase === "dry_run_loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Enumerando organizaciones y asuntos elegibles…
          </div>
        )}

        {/* ═══ DRY RUN PREVIEW ═══ */}
        {phase === "dry_run_preview" && dryRunPreview && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-lg bg-muted/40 text-center">
                <div className="text-2xl font-bold">{dryRunPreview.total_orgs}</div>
                <div className="text-[11px] text-muted-foreground">Organizaciones</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/40 text-center">
                <div className="text-2xl font-bold">{dryRunPreview.total_eligible}</div>
                <div className="text-[11px] text-muted-foreground">Asuntos elegibles</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/40 text-center">
                <div className="text-2xl font-bold text-amber-500">~{Math.ceil(dryRunPreview.total_eligible * 2.5 / 60)}m</div>
                <div className="text-[11px] text-muted-foreground">Tiempo estimado</div>
              </div>
            </div>

            {/* Per-org breakdown */}
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {dryRunPreview.orgs.map((o) => (
                <div key={o.org_id} className="flex items-center justify-between p-2 rounded-md bg-muted/20 text-xs">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium truncate max-w-[180px]" title={o.org_name || o.org_id}>
                      {o.org_name || o.org_id.slice(0, 12) + "…"}
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {o.eligible_items} asuntos
                  </Badge>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={runGlobalSync} variant="destructive" size="sm" className="gap-1.5">
                <Zap className="h-4 w-4" />
                Confirmar y ejecutar
              </Button>
              <Button onClick={reset} variant="ghost" size="sm">
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* ═══ KICKING ═══ */}
        {phase === "kicking" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Enviando kicks a las organizaciones…
            </div>
            <Progress value={10} className="h-2 animate-pulse" />
          </div>
        )}

        {/* ═══ POLLING ═══ */}
        {phase === "polling" && (
          <div className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Progreso general</span>
                <span className="font-mono font-medium">{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2.5" />
            </div>

            {/* Stats row */}
            {progress && <LiveStats progress={progress} />}

            {/* Chain info */}
            {kickResult && (
              <div className="text-[10px] text-muted-foreground font-mono bg-muted/20 px-2 py-1 rounded flex items-center gap-2">
                <span>chain: {kickResult.master_chain_id.slice(0, 12)}…</span>
                <span>|</span>
                <span>kicked: {kickResult.kicked_orgs.length}</span>
                {kickResult.skipped_orgs.length > 0 && (
                  <>
                    <span>|</span>
                    <span>skipped: {kickResult.skipped_orgs.length}</span>
                  </>
                )}
              </div>
            )}

            {/* Org details */}
            {progress && (
              <>
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {showDetails ? "Ocultar" : "Ver"} detalles por org ({progress.total_orgs})
                </button>
                {showDetails && <OrgDetailsLive details={progress.org_details} />}
              </>
            )}
          </div>
        )}

        {/* ═══ DONE ═══ */}
        {phase === "done" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="font-medium">Sincronización global completada</span>
              {startTime && (
                <span className="text-xs text-muted-foreground font-mono ml-auto">
                  {formatElapsed(elapsed)}
                </span>
              )}
            </div>

            <Progress value={100} className="h-2.5" />

            {progress && <LiveStats progress={progress} />}

            {progress && (
              <>
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {showDetails ? "Ocultar" : "Ver"} detalles por org
                </button>
                {showDetails && <OrgDetailsLive details={progress.org_details} />}
              </>
            )}

            {kickResult && (
              <div className="text-[10px] text-muted-foreground font-mono bg-muted/20 px-2 py-1 rounded">
                chain: {kickResult.master_chain_id} | heartbeat: {kickResult.heartbeat_id ?? "N/A"}
              </div>
            )}

            <Button size="sm" variant="outline" onClick={reset} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Nueva ejecución
            </Button>
          </div>
        )}

        {/* ═══ ERROR ═══ */}
        {phase === "error" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">
                {kickResult?.error || "Sincronización con errores — ver detalles"}
              </span>
            </div>

            {progress && (
              <>
                <Progress value={progressPercent} className="h-2.5" />
                <LiveStats progress={progress} />
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {showDetails ? "Ocultar" : "Ver"} detalles por org
                </button>
                {showDetails && <OrgDetailsLive details={progress.org_details} />}
              </>
            )}

            <Button size="sm" variant="outline" onClick={reset} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Reiniciar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function LiveStats({ progress }: { progress: ChainProgress }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <StatCard
        label="Orgs completadas"
        value={`${progress.orgs_done}/${progress.total_orgs}`}
        icon={<CheckCircle className="h-3.5 w-3.5 text-green-500" />}
      />
      <StatCard
        label="Items exitosos"
        value={progress.total_items_succeeded}
        icon={<Zap className="h-3.5 w-3.5 text-green-500" />}
        highlight="success"
      />
      <StatCard
        label="Items fallidos"
        value={progress.total_items_failed}
        icon={<XCircle className="h-3.5 w-3.5 text-destructive" />}
        highlight={progress.total_items_failed > 0 ? "error" : undefined}
      />
      <StatCard
        label="Skipped / DL"
        value={`${progress.total_items_skipped} / ${progress.total_dead_letter}`}
        icon={<SkipForward className="h-3.5 w-3.5 text-muted-foreground" />}
      />
    </div>
  );
}

function StatCard({ label, value, icon, highlight }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  highlight?: "success" | "error";
}) {
  return (
    <div className={`p-2 rounded-lg border text-center space-y-0.5 ${
      highlight === "error" ? "border-destructive/30 bg-destructive/5" :
      highlight === "success" ? "border-green-500/20 bg-green-500/5" :
      "border-border bg-muted/20"
    }`}>
      <div className="flex items-center justify-center gap-1">
        {icon}
        <span className="text-lg font-bold tabular-nums">{value}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function OrgDetailsLive({ details }: { details: OrgProgress[] }) {
  // Sort: running first, then by status
  const sorted = [...details].sort((a, b) => {
    const order: Record<string, number> = { RUNNING: 0, PENDING: 1, PARTIAL: 2, FAILED: 3, SUCCESS: 4 };
    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
  });

  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      {sorted.map((d) => {
        const total = (d.items_succeeded || 0) + (d.items_failed || 0) + (d.items_skipped || 0);
        const isRunning = d.status === "RUNNING" || d.status === "PENDING";

        return (
          <div
            key={d.organization_id}
            className={`flex items-center gap-2 text-xs font-mono p-2 rounded-md transition-all ${
              isRunning
                ? "bg-primary/5 border border-primary/20 shadow-sm"
                : d.status === "FAILED"
                ? "bg-destructive/5 border border-destructive/15"
                : d.status === "SUCCESS"
                ? "bg-green-500/5 border border-green-500/15"
                : "bg-muted/30 border border-transparent"
            }`}
          >
            {orgStatusIcon(d.status)}

            <span className="text-muted-foreground truncate min-w-[80px] max-w-[140px]" title={d.organization_id}>
              {d.organization_id.slice(0, 8)}…
            </span>

            <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-green-600">✓{d.items_succeeded}</span>
              {d.items_failed > 0 && <span className="text-destructive">✗{d.items_failed}</span>}
              {d.items_skipped > 0 && <span className="text-muted-foreground">⏭{d.items_skipped}</span>}
              {d.dead_letter_count > 0 && <span className="text-amber-500">💀{d.dead_letter_count}</span>}
            </div>

            {d.continuation_block_reason && (
              <span
                className="text-amber-500 text-[10px] ml-auto truncate max-w-[100px]"
                title={d.continuation_block_reason}
              >
                ⚠ {d.continuation_block_reason}
              </span>
            )}

            {d.finished_at && d.started_at && (
              <span className="text-muted-foreground/60 ml-auto text-[10px]">
                {formatElapsed(new Date(d.finished_at).getTime() - new Date(d.started_at).getTime())}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
