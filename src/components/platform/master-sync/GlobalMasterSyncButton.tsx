/**
 * Global Master Sync — Platform Console button that invokes the
 * server-side `global-master-sync` edge function.
 * All heavy lifting (heartbeat, sync, tracing) happens server-side.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Loader2, AlertTriangle, CheckCircle, Globe } from "lucide-react";
import { toast } from "sonner";

interface SyncResult {
  ok: boolean;
  heartbeat_id: string | null;
  heartbeat_status: string | null;
  heartbeat_written_at: string | null;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  budget_exhausted: boolean;
  duration_ms: number;
  error?: string;
}

type Phase = "idle" | "running" | "done" | "error";

export function GlobalMasterSyncButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SyncResult | null>(null);

  const runGlobalSync = useCallback(async () => {
    if (phase === "running") return;
    setPhase("running");
    setResult(null);

    try {
      toast.info("Sincronización global iniciada (server-side)…");

      const { data, error } = await supabase.functions.invoke("global-master-sync", {
        body: {},
      });

      if (error) throw error;

      const res = data as SyncResult;
      setResult(res);
      setPhase(res.ok ? "done" : "error");

      if (res.ok) {
        toast.success(
          `Global sync completado: ${res.success} exitosos, ${res.failed} errores de ${res.total} (${(res.duration_ms / 1000).toFixed(1)}s)`
        );
      } else {
        toast.error("Global sync falló: " + (res.error || "desconocido"));
      }
    } catch (err: any) {
      console.error("[GlobalMasterSync] Error:", err);
      setPhase("error");
      toast.error("Error invocando global-master-sync: " + (err?.message || "desconocido"));
    }
  }, [phase]);

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-destructive" />
          <div>
            <CardTitle className="text-base">Sincronización Global (Override Manual)</CardTitle>
            <CardDescription className="text-xs">
              Sincroniza TODOS los asuntos de TODAS las organizaciones server-side con heartbeat. Solo super admin.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {phase === "idle" && (
          <div className="space-y-3">
            <div className="p-3 rounded-md border border-destructive/20 bg-destructive/5 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Acción de alto impacto
              </div>
              <p className="text-muted-foreground">
                Ejecuta la sincronización server-side con heartbeat registrado en
                platform_job_heartbeats. Use solo como override manual.
              </p>
            </div>
            <Button onClick={runGlobalSync} variant="destructive" size="sm">
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Ejecutar Sincronización Global
            </Button>
          </div>
        )}

        {phase === "running" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Sincronización en curso (server-side)… esto puede tardar varios minutos.
          </div>
        )}

        {phase === "done" && result && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Sincronización global completada ({(result.duration_ms / 1000).toFixed(1)}s)</span>
            </div>
            <div className="flex gap-3 text-xs flex-wrap">
              <Badge variant="outline" className="text-green-600">✓ {result.success} exitosos</Badge>
              {result.failed > 0 && (
                <Badge variant="destructive">✗ {result.failed} errores</Badge>
              )}
              {(result.skipped ?? 0) > 0 && (
                <Badge variant="secondary">⏭ {result.skipped} omitidos</Badge>
              )}
              <Badge variant="secondary">{result.total} total</Badge>
              {result.budget_exhausted && (
                <Badge variant="destructive">⏱ Budget agotado</Badge>
              )}
            </div>
            {result.heartbeat_id && (
              <div className="text-xs text-muted-foreground font-mono space-y-0.5">
                <div>Heartbeat: {result.heartbeat_id}</div>
                <div>Status: {result.heartbeat_status} | Written: {result.heartbeat_written_at ?? "N/A"}</div>
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setPhase("idle"); setResult(null); }}
            >
              Reiniciar
            </Button>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span>Error: {result?.error || "desconocido"}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setPhase("idle"); setResult(null); }}
            >
              Reiniciar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
