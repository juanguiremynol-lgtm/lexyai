/**
 * Acts Tab - Shows actuaciones for the work item with ALL available fields
 * Displays complete information as received from the external API without summarizing
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
import { Scale, Search, Filter } from "lucide-react";

import type { WorkItem } from "@/types/work-item";
import { ActuacionCard, type Actuacion } from "./ActuacionCard";

interface ActsTabProps {
  workItem: WorkItem & { _source?: string };
}

export function ActsTab({ workItem }: ActsTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterEstado, setFilterEstado] = useState<string>("all");

  const { data: acts, isLoading } = useQuery({
    queryKey: ["work-item-actuaciones", workItem.id],
    queryFn: async () => {
      console.log("[ActsTab] Fetching actuaciones for work_item:", workItem.id);

      const { data: actuaciones, error } = await supabase
        .from("actuaciones")
        .select("*")
        .eq("work_item_id", workItem.id)
        .order("act_date", { ascending: false, nullsFirst: false });

      if (error) {
        console.error("[ActsTab] Error fetching actuaciones:", error);
        throw error;
      }

      console.log("[ActsTab] Fetched actuaciones:", actuaciones?.length);
      return (actuaciones || []) as Actuacion[];
    },
    enabled: !!workItem.id,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  // Get unique types for filter dropdown
  const uniqueTypes = [
    ...new Set(
      acts?.map((a) => a.act_type_guess).filter(Boolean) as string[]
    ),
  ];

  // Get unique estados for filter dropdown
  const uniqueEstados = [
    ...new Set(acts?.map((a) => a.estado).filter(Boolean) as string[]),
  ];

  // Filter actuaciones
  const filteredActs = acts?.filter((act) => {
    const matchesSearch =
      !searchTerm ||
      act.raw_text?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      act.normalized_text?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType =
      filterType === "all" || act.act_type_guess === filterType;

    const matchesEstado =
      filterEstado === "all" || act.estado === filterEstado;

    return matchesSearch && matchesType && matchesEstado;
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
            <h3 className="font-semibold mb-2">Sin actuaciones registradas</h3>
            <p className="text-muted-foreground text-sm">
              Las actuaciones aparecerán aquí cuando se sincronicen desde la
              Rama Judicial o se registren manualmente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
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

              {/* Estado filter */}
              {uniqueEstados.length > 0 && (
                <Select value={filterEstado} onValueChange={setFilterEstado}>
                  <SelectTrigger className="w-[140px] h-8 text-sm">
                    <SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los estados</SelectItem>
                    {uniqueEstados.map((estado) => (
                      <SelectItem key={estado} value={estado}>
                        {estado}
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
      {(searchTerm || filterType !== "all" || filterEstado !== "all") && (
        <div className="text-sm text-muted-foreground">
          Mostrando {filteredActs?.length} de {acts.length} actuaciones
        </div>
      )}

      {/* Actuaciones List */}
      <div className="space-y-3">
        {filteredActs?.map((act) => (
          <ActuacionCard key={act.id} actuacion={act} />
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
