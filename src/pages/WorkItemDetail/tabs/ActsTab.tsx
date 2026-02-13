/**
 * Acts Tab - Shows actuaciones for the work item from work_item_acts table
 * Unified card design regardless of data source
 *
 * CRITICAL: This tab reads ONLY from work_item_acts table (canonical)
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ensureValidSession } from "@/lib/supabase-query-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Scale, Search, Filter } from "lucide-react";
import { SyncStatusBadge } from "@/components/work-items/SyncStatusBadge";

import type { WorkItem } from "@/types/work-item";
import { WorkItemActCard, getActuacionesSummary, type WorkItemAct } from "./WorkItemActCard";

interface ActsTabProps {
  workItem: WorkItem & { _source?: string };
}

export function ActsTab({ workItem }: ActsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");

  const { data: acts, isLoading } = useQuery({
    queryKey: ["work-item-actuaciones", workItem.id],
    queryFn: async () => {
      // Guard: ensure valid auth before querying to prevent empty results from expired JWT
      await ensureValidSession();

      const { data, error } = await supabase
        .from("work_item_acts")
        .select("*")
        .eq("work_item_id", workItem.id)
        .eq("is_archived", false)
        .order("act_date", { ascending: false, nullsFirst: false });

      if (error) throw error;

      // Sort with fallback: act_date DESC, then created_at DESC
      const sorted = (data || []).sort((a, b) => {
        if (a.act_date && b.act_date) return b.act_date.localeCompare(a.act_date);
        if (a.act_date && !b.act_date) return -1;
        if (!a.act_date && b.act_date) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      return sorted as WorkItemAct[];
    },
    enabled: !!workItem.id,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
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
    );
  }

  const summary = getActuacionesSummary(acts);

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3">
          {/* Title row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-foreground" />
              <h3 className="font-semibold text-foreground">Actuaciones</h3>
              <Badge variant="secondary">{summary.total}</Badge>
              <SyncStatusBadge
                lastSyncedAt={workItem.last_synced_at ?? null}
                monitoringEnabled={workItem.monitoring_enabled}
                scrapeStatus={workItem.scrape_status}
              />
            </div>
            {summary.newestDate && (
              <span className="text-xs text-muted-foreground">
                Más reciente: {new Date(summary.newestDate + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
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
