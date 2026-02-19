/**
 * Global Master Sync — Platform Console button that invokes the
 * server-side `global-master-sync` edge function (enqueue + kick pattern).
 *
 * The function returns quickly with a master_chain_id. The UI then polls
 * via get_chain_progress RPC (server-side DISTINCT ON per org) for progress.
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

type Phase = "idle" | "kicking" | "polling" | "done" | "error";

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
        // Server-side DISTINCT ON (organization_id) — no client aggregation needed
        const { data: rows, error } = await supabase.rpc("get_chain_progress", {
          p_chain_id: chainId,
        });

        if (error || !rows || rows.length === 0) return;

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

function OrgDetails({ details }: { details: OrgProgress[] }) {
  return (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {details.map((d) => (
        <div key={d.organization_id} className="flex items-center gap-2 text-xs font-mono p-1.5 rounded bg-muted/30">
          <span className={
            d.status === "SUCCESS" ? "text-green-500" :
            d.status === "FAILED" ? "text-destructive" :
            d.status === "RUNNING" || d.status === "PENDING" ? "text-yellow-500" :
            "text-muted-foreground"
          }>
            {d.status}
          </span>
          <span className="text-muted-foreground truncate max-w-[120px]" title={d.organization_id}>
            {d.organization_id.slice(0, 8)}…
          </span>
          <span>✓{d.items_succeeded} ✗{d.items_failed} ⏭{d.items_skipped}</span>
          {d.dead_letter_count > 0 && <span>💀{d.dead_letter_count}</span>}
          {d.continuation_block_reason && (
            <span className="text-muted-foreground text-[10px]" title={d.continuation_block_reason}>⚠️</span>
          )}
        </div>
      ))}
    </div>
  );
}
