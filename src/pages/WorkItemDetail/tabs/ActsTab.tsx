/**
 * Acts Tab - Shows work_item_acts (actuaciones) for the work item
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Scale, 
  Calendar,
  FileText,
  ExternalLink,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

import type { WorkItem, WorkItemAct } from "@/types/work-item";

interface ActsTabProps {
  workItem: WorkItem & { _source?: string };
}

// Act type styling based on common patterns
const ACT_TYPE_CONFIG: Record<string, { color: string; bgColor: string }> = {
  AUTO_ADMISORIO: { color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  ADMITE: { color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  FALLO: { color: "text-blue-600", bgColor: "bg-blue-500/10" },
  SENTENCIA: { color: "text-blue-600", bgColor: "bg-blue-500/10" },
  NOTIFICACION: { color: "text-amber-600", bgColor: "bg-amber-500/10" },
  AUDIENCIA: { color: "text-purple-600", bgColor: "bg-purple-500/10" },
  MEMORIAL: { color: "text-indigo-600", bgColor: "bg-indigo-500/10" },
  TRASLADO: { color: "text-cyan-600", bgColor: "bg-cyan-500/10" },
  RECURSO: { color: "text-orange-600", bgColor: "bg-orange-500/10" },
  DEFAULT: { color: "text-muted-foreground", bgColor: "bg-muted/50" },
};

export function ActsTab({ workItem }: ActsTabProps) {
  // Fetch acts from actuaciones table using work_item_id (canonical source)
  const { data: acts, isLoading } = useQuery({
    queryKey: ["work-item-actuaciones", workItem.id],
    queryFn: async () => {
      console.log("[ActsTab] Fetching actuaciones for work_item:", workItem.id);
      
      // Query actuaciones directly using work_item_id (canonical approach)
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
      
      if (actuaciones && actuaciones.length > 0) {
        // Map actuaciones to WorkItemAct structure
        return actuaciones.map((act: any) => ({
          id: act.id,
          owner_id: act.owner_id,
          work_item_id: act.work_item_id,
          act_date: act.act_date,
          act_date_raw: act.act_date_raw,
          description: act.normalized_text || act.raw_text,
          act_type: act.act_type_guess,
          source: act.adapter_name || act.source || "sync",
          source_reference: act.source_url,
          raw_data: act.raw_data,
          hash_fingerprint: act.hash_fingerprint,
          created_at: act.created_at,
        })) as WorkItemAct[];
      }
      
      return [];
    },
    enabled: !!workItem.id,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  const getActTypeConfig = (actType: string | null) => {
    if (!actType) return ACT_TYPE_CONFIG.DEFAULT;
    
    const upperType = actType.toUpperCase();
    for (const [key, config] of Object.entries(ACT_TYPE_CONFIG)) {
      if (upperType.includes(key)) return config;
    }
    return ACT_TYPE_CONFIG.DEFAULT;
  };

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
              Las actuaciones aparecerán aquí cuando se sincronicen desde la Rama Judicial
              o se registren manualmente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Actuaciones
            <Badge variant="secondary" className="ml-auto">
              {acts.length} actuaciones
            </Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      <div className="space-y-3">
        {acts.map((act) => {
          const config = getActTypeConfig(act.act_type);

          return (
            <Card key={act.id} className={cn("transition-colors hover:shadow-md", config.bgColor)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-2">
                      {act.act_type && (
                        <Badge variant="outline" className={cn("text-xs font-medium", config.color)}>
                          {act.act_type}
                        </Badge>
                      )}
                      {act.source && (
                        <Badge variant="secondary" className="text-xs">
                          {act.source}
                        </Badge>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-sm">
                      {act.description}
                    </p>

                    {/* Raw date if different */}
                    {act.act_date_raw && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        Fecha original: {act.act_date_raw}
                      </p>
                    )}
                  </div>

                  {/* Date */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {act.act_date && (
                      <>
                        <div className="flex items-center gap-1 text-sm font-medium">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          {format(new Date(act.act_date), "d MMM yyyy", { locale: es })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(act.act_date), { addSuffix: true, locale: es })}
                        </p>
                      </>
                    )}

                    {act.source_reference && (
                      <a
                        href={act.source_reference}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline text-xs flex items-center gap-1 mt-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Ver fuente
                      </a>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
