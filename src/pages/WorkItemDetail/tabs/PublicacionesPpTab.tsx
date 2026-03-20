/**
 * PublicacionesPpTab - Shows actuaciones from Portal Publicaciones Procesales
 * Available for ALL work items. Each actuación may have PDF links (Auto / Tabla).
 * Uses numeric pp_id to call the PP API.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Newspaper, Search, RefreshCw, FileText, Table2 } from "lucide-react";
import { toast } from "sonner";

import type { WorkItem } from "@/types/work-item";
import { WorkItemActCard, getActuacionesSummary, type WorkItemAct } from "./WorkItemActCard";
import { usePpActuaciones, resyncPpActuaciones } from "@/hooks/use-pp-actuaciones";

interface Props {
  workItem: WorkItem;
}

/** Renders PDF action buttons for a PP actuación */
function PpPdfButtons({ act }: { act: WorkItemAct }) {
  const rawData = act.raw_data as Record<string, unknown> | null;
  const autoUrl = rawData?.gcs_url_auto as string | undefined;
  const tablaUrl = rawData?.gcs_url_tabla as string | undefined;

  if (!autoUrl && !tablaUrl) return null;

  return (
    <div className="flex items-center gap-1.5 mt-2">
      {autoUrl && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => window.open(autoUrl, "_blank")}
        >
          <FileText className="h-3 w-3" />
          Ver Auto
        </Button>
      )}
      {tablaUrl && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => window.open(tablaUrl, "_blank")}
        >
          <Table2 className="h-3 w-3" />
          Ver Tabla
        </Button>
      )}
    </div>
  );
}

export function PublicacionesPpTab({ workItem }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const queryClient = useQueryClient();
  const ppId = workItem.pp_id ?? null;

  console.log("[PublicacionesPpTab] ppId:", ppId, "radicado:", workItem.radicado);

  const { data: acts, isLoading, error } = usePpActuaciones(ppId, !!workItem.radicado);

  console.log("[PublicacionesPpTab] acts:", acts?.length, "isLoading:", isLoading, "error:", error);

  const resyncMutation = useMutation({
    mutationFn: () => {
      if (ppId == null) throw new Error("No PP ID disponible");
      return resyncPpActuaciones(ppId);
    },
    onSuccess: () => {
      toast.success("Re-sincronización PP iniciada", {
        description: "Las publicaciones se actualizarán en unos momentos.",
        duration: 5000,
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["pp-actuaciones", ppId] });
      }, 3000);
    },
    onError: (err) => {
      toast.error("Error al resincronizar PP", {
        description: err instanceof Error ? err.message : "Error desconocido",
      });
    },
  });

  const filteredActs = acts?.filter((act) => {
    if (!searchTerm) return true;
    return (
      act.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      act.event_summary?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  if (!workItem.radicado) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <div className="text-4xl mb-4">📋</div>
            <h3 className="font-semibold mb-2">Sin radicado asignado</h3>
            <p className="text-muted-foreground text-sm">
              Agrega un radicado al asunto para consultar publicaciones procesales.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (ppId == null) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <div className="text-4xl mb-4">⏳</div>
            <h3 className="font-semibold mb-2">Registrando en PP...</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Este asunto se está registrando en el Portal de Publicaciones Procesales.
              Recarga la página en unos momentos.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-l-4 border-l-muted bg-muted/20 p-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-px w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-1/3 mt-2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!acts || acts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <div className="text-4xl mb-4">📭</div>
            <h3 className="font-semibold mb-2">Sin publicaciones procesales</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Las publicaciones aparecerán automáticamente cuando el Portal de Publicaciones
              Procesales registre movimientos en este proceso.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const summary = getActuacionesSummary(acts);

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-foreground" />
              <h3 className="font-semibold text-foreground">Publicaciones Procesales</h3>
              <Badge variant="secondary">{summary.total}</Badge>
              <Badge variant="outline" className="text-xs">PP API</Badge>
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
                title="Re-sincronizar publicaciones desde PP API"
              >
                <RefreshCw className={`h-3 w-3 ${resyncMutation.isPending ? 'animate-spin' : ''}`} />
                {resyncMutation.isPending ? "Sincronizando..." : "Re-sync"}
              </Button>
            </div>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 pt-1">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar publicaciones..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-[200px] h-8 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Filtered count */}
      {searchTerm && filteredActs && (
        <div className="text-sm text-muted-foreground">
          Mostrando {filteredActs.length} de {acts.length} publicaciones
        </div>
      )}

      {/* Cards with PDF buttons */}
      <div className="space-y-3">
        {filteredActs?.map((act) => (
          <div key={act.id}>
            <WorkItemActCard act={act} despacho={workItem.authority_name} />
            <PpPdfButtons act={act} />
          </div>
        ))}
      </div>

      {filteredActs?.length === 0 && (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              No se encontraron publicaciones con los filtros aplicados.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
