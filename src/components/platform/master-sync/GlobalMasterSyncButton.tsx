/**
 * Global Master Sync — Platform Console button that invokes the
 * server-side `global-master-sync` edge function (enqueue + kick pattern).
 *
 * The function returns quickly with a master_chain_id. The UI then polls
 * the auto_sync_daily_ledger for progress across all orgs in the chain.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Loader2, AlertTriangle, CheckCircle, Globe, ChevronDown, ChevronUp,
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

interface LedgerRow {
  id: string;
  organization_id: string;
  status: string;
  items_targeted: number;
  items_succeeded: number;
  items_failed: number;
  items_skipped: number;
  dead_letter_count: number;
  timeout_count: number;
  is_continuation: boolean;
  failure_reason: string | null;
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
  org_details: Array<{
    org_id: string;
    status: string;
    items_succeeded: number;
    items_failed: number;
    items_skipped: number;
    items_targeted: number;
    dead_letter_count: number;
    chain_rows: number;
  }>;
}

type Phase = "idle" | "kicking" | "polling" | "done" | "error";

// ─── Helpers ─────────────────────────────────────────────────────────

function aggregateChainProgress(rows: LedgerRow[]): ChainProgress {
  // Group by org, take the latest row per org for status
  const orgMap = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    const arr = orgMap.get(r.organization_id) || [];
    arr.push(r);
    orgMap.set(r.organization_id, arr);
  }

  const orgDetails: ChainProgress["org_details"] = [];
  let totalSucceeded = 0, totalFailed = 0, totalSkipped = 0, totalDL = 0;
  let orgsDone = 0, orgsError = 0, orgsRunning = 0;

  for (const [orgId, orgRows] of orgMap) {
    // Sort by created_at desc to get latest
    orgRows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const latest = orgRows[0];

    // Sum across all chain rows for this org
    const succeeded = orgRows.reduce((s, r) => s + (r.items_succeeded || 0), 0);
    const failed = orgRows.reduce((s, r) => s + (r.items_failed || 0), 0);
    const skipped = latest.items_skipped || 0; // only latest matters for remaining
    const dl = orgRows.reduce((s, r) => s + (r.dead_letter_count || 0), 0);
    const targeted = orgRows[orgRows.length - 1].items_targeted || 0; // first row has total

    const terminalStatuses = ["SUCCESS", "FAILED", "PARTIAL"];
    const isTerminal = terminalStatuses.includes(latest.status) && !latest.is_continuation;
    // A chain is done if latest row is terminal AND no continuation is pending
    const chainDone = terminalStatuses.includes(latest.status);

    if (chainDone && latest.status === "SUCCESS") orgsDone++;
    else if (chainDone && (latest.status === "FAILED" || latest.status === "PARTIAL")) orgsError++;
    else orgsRunning++;

    totalSucceeded += succeeded;
    totalFailed += failed;
    totalSkipped += skipped;
    totalDL += dl;

    orgDetails.push({
      org_id: orgId,
      status: latest.status,
      items_succeeded: succeeded,
      items_failed: failed,
      items_skipped: skipped,
      items_targeted: targeted,
      dead_letter_count: dl,
      chain_rows: orgRows.length,
    });
  }

  return {
    total_orgs: orgMap.size,
    orgs_done: orgsDone,
    orgs_error: orgsError,
    orgs_running: orgsRunning,
    total_items_succeeded: totalSucceeded,
    total_items_failed: totalFailed,
    total_items_skipped: totalSkipped,
    total_dead_letter: totalDL,
    all_done: orgsRunning === 0,
    org_details: orgDetails,
  };
}

// ─── Component ───────────────────────────────────────────────────────

export function GlobalMasterSyncButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [kickResult, setKickResult] = useState<KickResult | null>(null);
  const [progress, setProgress] = useState<ChainProgress | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollProgress = useCallback((chainId: string) => {
    const poll = async () => {
      try {
        const { data: rows, error } = await supabase
          .from("auto_sync_daily_ledger")
          .select(
            "id, organization_id, status, items_targeted, items_succeeded, items_failed, items_skipped, dead_letter_count, timeout_count, is_continuation, failure_reason, started_at, finished_at, created_at"
          )
          .eq("chain_id", chainId)
          .order("created_at", { ascending: true });

        if (error || !rows) return;

        const agg = aggregateChainProgress(rows as LedgerRow[]);
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
        // Non-blocking poll failure
      }
    };

    // Immediate first poll, then every 5s
    poll();
    pollRef.current = setInterval(poll, 5000);
  }, []);

  const runGlobalSync = useCallback(async () => {
    if (phase === "kicking" || phase === "polling") return;
    setPhase("kicking");
    setKickResult(null);
    setProgress(null);

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

      // Start polling
      setPhase("polling");
      pollProgress(res.master_chain_id);
    } catch (err: any) {
      console.error("[GlobalMasterSync] Error:", err);
      setPhase("error");
      toast.error("Error invocando global-master-sync: " + (err?.message || "desconocido"));
    }
  }, [phase, pollProgress]);

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setPhase("idle");
    setKickResult(null);
    setProgress(null);
    setShowDetails(false);
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-destructive" />
          <div>
            <CardTitle className="text-base">Sincronización Global (Override Manual)</CardTitle>
            <CardDescription className="text-xs">
              Sincroniza TODOS los asuntos de TODAS las organizaciones via scheduled-daily-sync. Solo super admin.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* IDLE */}
        {phase === "idle" && (
          <div className="space-y-3">
            <div className="p-3 rounded-md border border-destructive/20 bg-destructive/5 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Acción de alto impacto
              </div>
              <p className="text-muted-foreground">
                Enqueue + kick: crea ledger entries por org y dispara scheduled-daily-sync para cada una.
                Usa cursor, continuación, dead-letter y budget guard del cron path canónico.
              </p>
            </div>
            <Button onClick={runGlobalSync} variant="destructive" size="sm">
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Ejecutar Sincronización Global
            </Button>
          </div>
        )}

        {/* KICKING */}
        {phase === "kicking" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Enviando kicks a las organizaciones…
          </div>
        )}

        {/* POLLING */}
        {phase === "polling" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sincronización en curso — polling cada 5s
            </div>
            {kickResult && (
              <div className="text-xs text-muted-foreground font-mono">
                chain: {kickResult.master_chain_id.slice(0, 8)}… | orgs kicked: {kickResult.kicked_orgs.length} | skipped: {kickResult.skipped_orgs.length}
              </div>
            )}
            {progress && <ProgressSummary progress={progress} />}
            {progress && (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showDetails ? "Ocultar" : "Ver"} detalles por org
              </button>
            )}
            {showDetails && progress && <OrgDetails details={progress.org_details} />}
          </div>
        )}

        {/* DONE */}
        {phase === "done" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Sincronización global completada</span>
            </div>
            {progress && <ProgressSummary progress={progress} />}
            {progress && (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showDetails ? "Ocultar" : "Ver"} detalles por org
              </button>
            )}
            {showDetails && progress && <OrgDetails details={progress.org_details} />}
            {kickResult && (
              <div className="text-xs text-muted-foreground font-mono">
                chain: {kickResult.master_chain_id} | heartbeat: {kickResult.heartbeat_id ?? "N/A"}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={reset}>
              Reiniciar
            </Button>
          </div>
        )}

        {/* ERROR */}
        {phase === "error" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span>Error: {kickResult?.error || "parcial — ver detalles"}</span>
            </div>
            {progress && <ProgressSummary progress={progress} />}
            {progress && (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showDetails ? "Ocultar" : "Ver"} detalles por org
              </button>
            )}
            {showDetails && progress && <OrgDetails details={progress.org_details} />}
            <Button size="sm" variant="outline" onClick={reset}>
              Reiniciar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function ProgressSummary({ progress }: { progress: ChainProgress }) {
  return (
    <div className="flex gap-2 text-xs flex-wrap">
      <Badge variant="outline">
        {progress.orgs_done + progress.orgs_error}/{progress.total_orgs} orgs
      </Badge>
      <Badge variant="outline" className="text-green-600">
        ✓ {progress.total_items_succeeded}
      </Badge>
      {progress.total_items_failed > 0 && (
        <Badge variant="destructive">✗ {progress.total_items_failed}</Badge>
      )}
      {progress.total_items_skipped > 0 && (
        <Badge variant="secondary">⏭ {progress.total_items_skipped}</Badge>
      )}
      {progress.total_dead_letter > 0 && (
        <Badge variant="secondary">💀 {progress.total_dead_letter}</Badge>
      )}
      {progress.orgs_running > 0 && (
        <Badge variant="outline" className="animate-pulse">
          ⏳ {progress.orgs_running} running
        </Badge>
      )}
    </div>
  );
}

function OrgDetails({ details }: { details: ChainProgress["org_details"] }) {
  return (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {details.map((d) => (
        <div key={d.org_id} className="flex items-center gap-2 text-xs font-mono p-1.5 rounded bg-muted/30">
          <span className={
            d.status === "SUCCESS" ? "text-green-500" :
            d.status === "FAILED" ? "text-destructive" :
            d.status === "RUNNING" || d.status === "PENDING" ? "text-yellow-500" :
            "text-muted-foreground"
          }>
            {d.status}
          </span>
          <span className="text-muted-foreground truncate max-w-[120px]" title={d.org_id}>
            {d.org_id.slice(0, 8)}…
          </span>
          <span>✓{d.items_succeeded} ✗{d.items_failed} ⏭{d.items_skipped}</span>
          {d.dead_letter_count > 0 && <span>💀{d.dead_letter_count}</span>}
          {d.chain_rows > 1 && <span className="text-muted-foreground">({d.chain_rows} runs)</span>}
        </div>
      ))}
    </div>
  );
}
