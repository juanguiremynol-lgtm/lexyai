/**
 * Acts Tab - Shows actuaciones for the work item from work_item_acts table
 * Displays complete information as received from CPNU/SAMAI APIs
 * Includes parties info (demandantes/demandados) and sorting with fallbacks
 * 
 * CRITICAL: This tab reads ONLY from work_item_acts table (canonical)
 * NOT from legacy 'actuaciones' table
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Scale, Search, Filter, Users, Building2 } from "lucide-react";

import type { WorkItem } from "@/types/work-item";
import { WorkItemActCard, type WorkItemAct } from "./WorkItemActCard";

interface ActsTabProps {
  workItem: WorkItem & { _source?: string };
}

export function ActsTab({ workItem }: ActsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");

  // CANONICAL QUERY: Fetch from work_item_acts table ONLY
  const { data: acts, isLoading } = useQuery({
    queryKey: ["work-item-actuaciones", workItem.id],
    queryFn: async () => {
      console.log("[ActsTab] Fetching actuaciones from work_item_acts for work_item:", workItem.id);

      const { data: actuaciones, error } = await supabase
        .from("work_item_acts")
        .select("*")
        .eq("work_item_id", workItem.id)
        .order("act_date", { ascending: false, nullsFirst: false });

      if (error) {
        console.error("[ActsTab] Error fetching work_item_acts:", error);
        throw error;
      }

      console.log("[ActsTab] Fetched actuaciones:", actuaciones?.length);
      
      // Sort with fallback: act_date DESC, then event_date DESC, then created_at DESC
      const sortedActuaciones = (actuaciones || []).sort((a, b) => {
        // Try act_date first
        if (a.act_date && b.act_date) {
          return new Date(b.act_date).getTime() - new Date(a.act_date).getTime();
        }
        if (a.act_date && !b.act_date) return -1;
        if (!a.act_date && b.act_date) return 1;
        
        // Fallback to event_date
        if (a.event_date && b.event_date) {
          return new Date(b.event_date).getTime() - new Date(a.event_date).getTime();
        }
        if (a.event_date && !b.event_date) return -1;
        if (!a.event_date && b.event_date) return 1;
        
        // Final fallback to created_at
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      
      return sortedActuaciones as WorkItemAct[];
    },
    enabled: !!workItem.id,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  // Get unique types for filter dropdown
  const uniqueTypes = [
    ...new Set(
      acts?.map((a) => a.act_type).filter(Boolean) as string[]
    ),
  ];

  // Get unique sources for filter dropdown
  const uniqueSources = [
    ...new Set(acts?.map((a) => a.source_platform).filter(Boolean) as string[]),
  ];

  // Filter actuaciones
  const filteredActs = acts?.filter((act) => {
    const matchesSearch =
      !searchTerm ||
      act.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      act.event_summary?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType =
      filterType === "all" || act.act_type === filterType;

    const matchesSource =
      filterSource === "all" || act.source_platform === filterSource;

    return matchesSearch && matchesType && matchesSource;
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!acts || acts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <Scale className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">No se encontraron actuaciones para este proceso</h3>
            <p className="text-muted-foreground text-sm">
              Las actuaciones se sincronizan automáticamente al iniciar sesión y cada día a las 7:00 AM
              desde la Rama Judicial (CPNU/SAMAI).
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Parties Info Card - Demandantes/Demandados */}
      {(workItem.demandantes || workItem.demandados) && (
        <Card className="bg-muted/30">
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-3">
              <Users className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 text-sm">
                {workItem.demandantes && (
                  <div>
                    <span className="text-muted-foreground font-medium">Demandante(s): </span>
                    <span>{workItem.demandantes}</span>
                  </div>
                )}
                {workItem.demandados && (
                  <div>
                    <span className="text-muted-foreground font-medium">Demandado(s): </span>
                    <span>{workItem.demandados}</span>
                  </div>
                )}
              </div>
            </div>
            {workItem.authority_name && (
              <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/50">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {workItem.authority_name}
                  {workItem.authority_department && ` - ${workItem.authority_department}`}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Header Card with count and filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Actuaciones
              <Badge variant="secondary" className="ml-2">
                {acts.length} {acts.length === 1 ? "actuación" : "actuaciones"}
              </Badge>
            </CardTitle>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-[180px] h-8 text-sm"
                />
              </div>

              {/* Type filter */}
              {uniqueTypes.length > 0 && (
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-[150px] h-8 text-sm">
                    <Filter className="h-3 w-3 mr-1" />
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los tipos</SelectItem>
                    {uniqueTypes.map((tipo) => (
                      <SelectItem key={tipo} value={tipo}>
                        {tipo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Source filter */}
              {uniqueSources.length > 0 && (
                <Select value={filterSource} onValueChange={setFilterSource}>
                  <SelectTrigger className="w-[140px] h-8 text-sm">
                    <SelectValue placeholder="Fuente" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las fuentes</SelectItem>
                    {uniqueSources.map((source) => (
                      <SelectItem key={source} value={source}>
                        {source}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Filtered results count */}
      {(searchTerm || filterType !== "all" || filterSource !== "all") && (
        <div className="text-sm text-muted-foreground">
          Mostrando {filteredActs?.length} de {acts.length} actuaciones
        </div>
      )}

      {/* Actuaciones List */}
      <div className="space-y-3">
        {filteredActs?.map((act) => (
          <WorkItemActCard 
            key={act.id} 
            act={act} 
            despacho={workItem.authority_name}
          />
        ))}
      </div>

      {/* No results message */}
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
