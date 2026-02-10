/**
 * SuperAdminToolbar — Exclusive platform admin features in the header
 * 
 * 1. Lexy AI Deep Analysis — on-demand comprehensive portfolio analysis
 * 2. Master Sync — sync exclusively the admin's own work items
 */

import { useState, useCallback } from "react";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, RefreshCw, Loader2, ShieldAlert, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ─── Types ───
interface AnalysisStats {
  work_items: number;
  recent_actuaciones: number;
  recent_publicaciones: number;
  pending_alerts: number;
  active_terms: number;
  deadlines: number;
}

interface SyncProgress {
  total: number;
  completed: number;
  success: number;
  errors: number;
  isRunning: boolean;
}

// Sync-eligible workflows
const SYNC_WORKFLOWS = ['CGP', 'LABORAL', 'CPACA', 'TUTELA', 'PENAL_906'] as const;
const TERMINAL_STAGES = [
  'ARCHIVADO', 'FINALIZADO', 'EJECUTORIADO',
  'PRECLUIDO_ARCHIVADO', 'FINALIZADO_ABSUELTO', 'FINALIZADO_CONDENADO'
];

export function SuperAdminToolbar() {
  const { isPlatformAdmin, isLoading: adminLoading } = usePlatformAdmin();
  const { organization } = useOrganization();

  // Lexy Analysis state
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [analysisStats, setAnalysisStats] = useState<AnalysisStats | null>(null);

  // Master Sync state
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({
    total: 0, completed: 0, success: 0, errors: 0, isRunning: false,
  });

  // ─── Lexy Deep Analysis ───
  const runLexyAnalysis = useCallback(async () => {
    setAnalysisLoading(true);
    setAnalysisResult(null);
    setAnalysisStats(null);
    setAnalysisOpen(true);

    try {
      const { data, error } = await supabase.functions.invoke("superadmin-lexy-analysis");

      if (error) throw error;

      if (data?.ok) {
        setAnalysisResult(data.analysis);
        setAnalysisStats(data.stats);
      } else {
        throw new Error(data?.error || "Unknown error");
      }
    } catch (err: any) {
      console.error("[SuperAdminToolbar] Lexy analysis error:", err);
      setAnalysisResult(`❌ Error: ${err?.message || "No se pudo generar el análisis"}`);
      toast({
        title: "Error en análisis",
        description: err?.message || "No se pudo contactar a Lexy",
        variant: "destructive",
      });
    } finally {
      setAnalysisLoading(false);
    }
  }, []);

  // ─── Master Sync (user's own work items only) ───
  const runMasterSync = useCallback(async () => {
    if (!organization?.id || syncProgress.isRunning) return;

    setSyncProgress({ total: 0, completed: 0, success: 0, errors: 0, isRunning: true });

    try {
      // Fetch eligible work items for this org
      const { data: workItems, error: fetchError } = await supabase
        .from("work_items")
        .select("id, workflow_type, radicado, stage, total_actuaciones")
        .eq("organization_id", organization.id)
        .eq("monitoring_enabled", true)
        .in("workflow_type", SYNC_WORKFLOWS)
        .not("radicado", "is", null)
        .order("last_synced_at", { ascending: true, nullsFirst: true });

      if (fetchError) throw fetchError;

      // Filter to valid radicados and non-terminal
      const eligible = (workItems || []).filter(item =>
        item.radicado &&
        item.radicado.replace(/\D/g, '').length === 23 &&
        !TERMINAL_STAGES.includes(item.stage)
      );

      if (eligible.length === 0) {
        toast({
          title: "Sin asuntos para sincronizar",
          description: "No se encontraron asuntos elegibles para sincronización.",
        });
        setSyncProgress(prev => ({ ...prev, isRunning: false }));
        return;
      }

      setSyncProgress(prev => ({ ...prev, total: eligible.length }));

      toast({
        title: "Sincronización iniciada",
        description: `Actualizando ${eligible.length} asuntos...`,
      });

      let success = 0;
      let errors = 0;

      for (let i = 0; i < eligible.length; i++) {
        const item = eligible[i];

        try {
          const [actsResult, pubsResult] = await Promise.allSettled([
            supabase.functions.invoke("sync-by-work-item", {
              body: { work_item_id: item.id, _scheduled: true },
            }),
            supabase.functions.invoke("sync-publicaciones-by-work-item", {
              body: { work_item_id: item.id, _scheduled: true },
            }),
          ]);

          const actOk = actsResult.status === "fulfilled" && actsResult.value.data?.ok;
          const pubOk = pubsResult.status === "fulfilled" && pubsResult.value.data?.ok;

          if (actOk || pubOk) success++;
          else errors++;
        } catch {
          errors++;
        }

        setSyncProgress(prev => ({
          ...prev,
          completed: i + 1,
          success,
          errors,
        }));

        // Rate limiting
        if (i < eligible.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      setSyncProgress(prev => ({ ...prev, isRunning: false }));

      toast({
        title: "Sincronización completada",
        description: `${success} exitosos, ${errors} errores de ${eligible.length} asuntos.`,
      });
    } catch (err: any) {
      console.error("[SuperAdminToolbar] Sync error:", err);
      setSyncProgress(prev => ({ ...prev, isRunning: false }));
      toast({
        title: "Error en sincronización",
        description: err?.message || "Error inesperado",
        variant: "destructive",
      });
    }
  }, [organization?.id, syncProgress.isRunning]);

  // Don't render if not platform admin
  if (adminLoading || !isPlatformAdmin) return null;

  return (
    <>
      {/* Toolbar strip below header elements */}
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-amber-500/40 text-amber-600 dark:text-amber-400 font-medium hidden sm:flex">
          <ShieldAlert className="h-3 w-3 mr-0.5" />
          SA
        </Badge>

        {/* Lexy AI Analysis Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
          onClick={runLexyAnalysis}
          disabled={analysisLoading}
          title="Análisis Lexy AI"
        >
          {analysisLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Brain className="h-4 w-4" />
          )}
        </Button>

        {/* Master Sync Button */}
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
          onClick={runMasterSync}
          disabled={syncProgress.isRunning}
          title="Sincronizar mis asuntos"
        >
          {syncProgress.isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {syncProgress.isRunning && syncProgress.total > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white">
              {syncProgress.completed}/{syncProgress.total}
            </span>
          )}
        </Button>
      </div>

      {/* Sync Progress Toast (inline) */}
      {syncProgress.isRunning && syncProgress.total > 0 && (
        <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-300"
              style={{ width: `${(syncProgress.completed / syncProgress.total) * 100}%` }}
            />
          </div>
          <span className="tabular-nums">
            {syncProgress.completed}/{syncProgress.total}
          </span>
          {syncProgress.errors > 0 && (
            <span className="text-destructive">{syncProgress.errors} err</span>
          )}
        </div>
      )}

      {/* Lexy Analysis Dialog */}
      <Dialog open={analysisOpen} onOpenChange={setAnalysisOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-amber-500" />
              Análisis Lexy AI — Panorama Ejecutivo
            </DialogTitle>
          </DialogHeader>

          {analysisLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              <p className="text-sm text-muted-foreground">
                Lexy está analizando todos tus asuntos...
              </p>
              <p className="text-xs text-muted-foreground/60">
                Esto puede tomar 10-20 segundos
              </p>
            </div>
          ) : (
            <>
              {/* Stats bar */}
              {analysisStats && (
                <div className="flex flex-wrap gap-3 pb-3 border-b border-border">
                  <StatBadge icon={<CheckCircle className="h-3 w-3" />} label="Asuntos" value={analysisStats.work_items} />
                  <StatBadge icon={<RefreshCw className="h-3 w-3" />} label="Actuaciones (7d)" value={analysisStats.recent_actuaciones} />
                  <StatBadge icon={<RefreshCw className="h-3 w-3" />} label="Estados (7d)" value={analysisStats.recent_publicaciones} />
                  <StatBadge icon={<AlertTriangle className="h-3 w-3" />} label="Alertas" value={analysisStats.pending_alerts} color={analysisStats.pending_alerts > 0 ? "destructive" : undefined} />
                  <StatBadge icon={<XCircle className="h-3 w-3" />} label="Términos" value={analysisStats.active_terms} />
                  <StatBadge icon={<XCircle className="h-3 w-3" />} label="Vencimientos" value={analysisStats.deadlines} color={analysisStats.deadlines > 0 ? "destructive" : undefined} />
                </div>
              )}

              {/* Analysis content */}
              <ScrollArea className="max-h-[60vh]">
                <div className="prose prose-sm dark:prose-invert max-w-none pr-4 whitespace-pre-wrap">
                  {analysisResult || "Sin resultados."}
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatBadge({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: "destructive";
}) {
  return (
    <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${
      color === "destructive"
        ? "border-destructive/30 text-destructive bg-destructive/5"
        : "border-border text-muted-foreground bg-muted/30"
    }`}>
      {icon}
      <span className="font-medium">{value}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}
