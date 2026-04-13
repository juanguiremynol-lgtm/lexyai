/**
 * Acts Tab - Shows actuaciones for the work item
 * CGP workflow: reads from Google Cloud CPNU API
 * CPACA workflow: reads from Google Cloud SAMAI + SAMAI_ESTADOS APIs
 * Other workflows: reads from work_item_acts table (Supabase)
 *
 * CRITICAL: CGP → CPNU API, CPACA → SAMAI API, everything else → Supabase
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ensureValidSession } from "@/lib/supabase-query-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Scale, Search, Filter, RefreshCw } from "lucide-react";
import { SyncStatusBadge } from "@/components/work-items/SyncStatusBadge";
import { ActuacionDiffView } from "@/components/work-items/ActuacionDiffView";
import { toast } from "sonner";

import type { WorkItem } from "@/types/work-item";
import { WorkItemActCard, getActuacionesSummary, type WorkItemAct } from "./WorkItemActCard";
import { useCpnuActuaciones, resyncCpnuActuaciones } from "@/hooks/use-cpnu-actuaciones";
import { useSamaiActuaciones, resyncSamaiActuaciones } from "@/hooks/use-samai-actuaciones";

interface ActsTabProps {
  workItem: WorkItem & { _source?: string };
}

// ─── Supabase query hook (non-CGP, non-CPACA) ──────────────────────────────

function useSupabaseActs(workItemId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["work-item-actuaciones", workItemId],
    queryFn: async () => {
      await ensureValidSession();

      const { data, error } = await supabase
        .from("work_item_acts")
        .select("*")
        .eq("work_item_id", workItemId)
        .eq("is_archived", false)
        .order("act_date", { ascending: false, nullsFirst: false });

      if (error) throw error;

      const sorted = (data || []).sort((a, b) => {
        if (a.act_date && b.act_date && a.act_date !== b.act_date) return b.act_date.localeCompare(a.act_date);
        if (a.act_date && !b.act_date) return -1;
        if (!a.act_date && b.act_date) return 1;
        const regA = (a as any).fecha_registro_source || '';
        const regB = (b as any).fecha_registro_source || '';
        if (regA !== regB) return regB.localeCompare(regA);
        return (a.hash_fingerprint || '').localeCompare(b.hash_fingerprint || '');
      });

      return sorted as WorkItemAct[];
    },
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function ActsTab({ workItem }: ActsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const queryClient = useQueryClient();

  const isCGP = workItem.workflow_type === "CGP";
  const isCPACA = workItem.workflow_type === "CPACA";
  const useExternalApi = isCGP || isCPACA;

  // ─── Data source branching ──────────────────────────────────────────────
  // CGP → Google Cloud CPNU API
  // CPACA → Google Cloud SAMAI + SAMAI_ESTADOS APIs
  // Other workflows → Supabase work_item_acts
  const cpnuQuery = useCpnuActuaciones(workItem.id, isCGP);
  const samaiQuery = useSamaiActuaciones(workItem.id, workItem.radicado || "", isCPACA);
  const supabaseQuery = useSupabaseActs(workItem.id, !useExternalApi);

  const acts = isCGP ? cpnuQuery.data : isCPACA ? samaiQuery.data : supabaseQuery.data;
  const isLoading = isCGP ? cpnuQuery.isLoading : isCPACA ? samaiQuery.isLoading : supabaseQuery.isLoading;

  // ─── API label for badges ───────────────────────────────────────────────
  const apiLabel = isCGP ? "CPNU API" : isCPACA ? "SAMAI API" : null;

  // ─── Resync mutation ────────────────────────────────────────────────────
  const resyncMutation = useMutation({
    mutationFn: async () => {
      if (isCGP) {
        return resyncCpnuActuaciones(workItem.id);
      }
      if (isCPACA) {
        return resyncSamaiActuaciones(workItem.radicado || "");
      }
      // Non-CGP/CPACA: use Supabase edge function
      const { data, error } = await supabase.functions.invoke("resync-actuaciones", {
        body: { work_item_id: workItem.id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Error en resync");
      return data;
    },
    onSuccess: (data) => {
      if (isCGP) {
        toast.success("Re-sincronización CPNU iniciada", {
          description: "Las actuaciones se actualizarán en unos momentos.",
          duration: 5000,
        });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["cpnu-actuaciones", workItem.id] });
        }, 3000);
        return;
      }

      if (isCPACA) {
        toast.success("Re-sincronización SAMAI iniciada", {
          description: "Las actuaciones se actualizarán en unos momentos.",
          duration: 5000,
        });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["samai-actuaciones", workItem.id] });
        }, 3000);
        return;
      }

      const inserted = data.inserted_count || 0;
      const skipped = data.skipped_count || 0;

      if (inserted > 0) {
        toast.success(`${inserted} nueva${inserted > 1 ? 's' : ''} actuaci${inserted > 1 ? 'ones' : 'ón'} insertada${inserted > 1 ? 's' : ''}`, {
          description: `${skipped} existentes. Backfill histórico — sin notificaciones por email.`,
          duration: 8000,
        });
      } else {
        toast.info("No se encontraron actuaciones nuevas", {
          description: `${skipped} existentes ya en el sistema. No se enviaron notificaciones.`,
          duration: 6000,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["work-item-actuaciones", workItem.id] });
    },
    onError: (err) => {
      toast.error("Error al resincronizar", {
        description: err instanceof Error ? err.message : "Error desconocido",
      });
    },
  });

  // Get unique sources for filter
  const uniqueSources = [
    ...new Set(acts?.map((a) => a.source).filter(Boolean) as string[]),
  ];

  // Filter
  const filteredActs = acts?.filter((act) => {
    const matchesSearch =
      !searchTerm ||
      act.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      act.event_summary?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesSource =
      filterSource === "all" || act.source === filterSource;

    return matchesSearch && matchesSource;
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border border-l-4 border-l-slate-300 bg-slate-50 dark:bg-slate-900/30 p-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-px w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3 mt-2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!acts || acts.length === 0) {
    return (
      <div className="space-y-4">
        <ActuacionDiffView workItemId={workItem.id} dataKind="actuaciones" />
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <div className="text-4xl mb-4">📭</div>
              <h3 className="font-semibold mb-2">No se han encontrado actuaciones para este asunto</h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Las actuaciones aparecerán automáticamente cuando los sistemas judiciales
                registren movimientos en este proceso.
              </p>
              {workItem.last_synced_at && (
                <p className="text-xs text-muted-foreground mt-4">
                  Última búsqueda: {new Date(workItem.last_synced_at).toLocaleDateString("es-CO", {
                    timeZone: "America/Bogota",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const summary = getActuacionesSummary(acts);

  return (
    <div className="space-y-4">
      {/* Diff view for recent changes */}
      <ActuacionDiffView workItemId={workItem.id} dataKind="actuaciones" />

      {/* Summary header */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3">
          {/* Title row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-foreground" />
              <h3 className="font-semibold text-foreground">Actuaciones</h3>
              <Badge variant="secondary">{summary.total}</Badge>
              {apiLabel && (
                <Badge variant="outline" className="text-xs">
                  {apiLabel}
                </Badge>
              )}
              <SyncStatusBadge
                lastSyncedAt={workItem.last_synced_at ?? null}
                monitoringEnabled={workItem.monitoring_enabled}
                scrapeStatus={workItem.scrape_status}
              />
            </div>
            <div className="flex items-center gap-2">
              {summary.newestDate && (
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  Más reciente: {new Date(summary.newestDate + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => resyncMutation.mutate()}
                disabled={resyncMutation.isPending}
                className="h-7 text-xs gap-1.5"
                title={isCGP ? "Re-sincronizar actuaciones desde CPNU API" : isCPACA ? "Re-sincronizar actuaciones desde SAMAI API" : "Re-sincronizar actuaciones desde CPNU"}
              >
                <RefreshCw className={`h-3 w-3 ${resyncMutation.isPending ? 'animate-spin' : ''}`} />
                {resyncMutation.isPending ? "Sincronizando..." : "Re-sync"}
              </Button>
            </div>
          </div>

          {/* Category summary chips */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {summary.categories.map((cat) => (
              <span key={cat.icon} className="inline-flex items-center gap-1">
                {cat.icon} {cat.count} {cat.label}
                <span className="mx-0.5">·</span>
              </span>
            ))}
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar actuaciones..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-[200px] h-8 text-sm"
              />
            </div>

            {uniqueSources.length > 1 && (
              <Select value={filterSource} onValueChange={setFilterSource}>
                <SelectTrigger className="w-[140px] h-8 text-sm">
                  <Filter className="h-3 w-3 mr-1" />
                  <SelectValue placeholder="Fuente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las fuentes</SelectItem>
                  {uniqueSources.map((source) => (
                    <SelectItem key={source} value={source}>
                      {source.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      {/* Filtered results count */}
      {(searchTerm || filterSource !== "all") && filteredActs && (
        <div className="text-sm text-muted-foreground">
          Mostrando {filteredActs.length} de {acts.length} actuaciones
        </div>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {filteredActs?.map((act) => (
          <WorkItemActCard key={act.id} act={act} despacho={workItem.authority_name} />
        ))}
      </div>

      {/* No filter results */}
      {filteredActs?.length === 0 && (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              No se encontraron actuaciones con los filtros aplicados.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
