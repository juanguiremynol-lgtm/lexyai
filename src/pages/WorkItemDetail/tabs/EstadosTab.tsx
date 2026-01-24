/**
 * Estados Tab - Shows imported estados/actuaciones from ICARUS and scrapers
 * 
 * ONLY for CGP, CPACA, and TUTELA workflows
 * NOT for PETICION or GOV_PROCEDURE
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { 
  Scale, 
  Calendar,
  FileText,
  ExternalLink,
  Database,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import type { WorkItem } from "@/types/work-item";

interface EstadosTabProps {
  workItem: WorkItem & { _source?: string };
}

interface Estado {
  id: string;
  act_date: string | null;
  act_date_raw: string | null;
  description: string;
  act_type: string | null;
  source: string;
  source_reference: string | null;
  milestone_type: string | null;
  triggers_phase_change: boolean;
  created_at: string;
}

// Source labels and styling
const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: typeof Database }> = {
  ICARUS_ESTADOS_EXCEL: { label: "ICARUS", color: "text-blue-600 bg-blue-500/10", icon: FileText },
  SCRAPE: { label: "Rama Judicial", color: "text-emerald-600 bg-emerald-500/10", icon: RefreshCw },
  CPNU: { label: "CPNU", color: "text-purple-600 bg-purple-500/10", icon: Database },
  MANUAL: { label: "Manual", color: "text-amber-600 bg-amber-500/10", icon: FileText },
  DEFAULT: { label: "Sistema", color: "text-muted-foreground bg-muted/50", icon: Database },
};

// Milestone type styling
const MILESTONE_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  AUTO_ADMISORIO: { label: "Auto Admisorio", color: "text-emerald-600", icon: CheckCircle2 },
  INADMISION: { label: "Inadmisión", color: "text-amber-600", icon: AlertTriangle },
  REQUERIMIENTO: { label: "Requerimiento", color: "text-orange-600", icon: AlertTriangle },
  AUDIENCIA: { label: "Audiencia", color: "text-purple-600", icon: Calendar },
  SENTENCIA: { label: "Sentencia", color: "text-blue-600", icon: Scale },
  FALLO: { label: "Fallo", color: "text-blue-600", icon: Scale },
  NOTIFICACION: { label: "Notificación", color: "text-cyan-600", icon: Info },
};

export function EstadosTab({ workItem }: EstadosTabProps) {
  // Fetch estados from work_item_acts table
  const { data: estados, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["work-item-estados", workItem.id],
    queryFn: async () => {
      // Fetch from work_item_acts table
      const { data: acts, error } = await supabase
        .from("work_item_acts")
        .select("*")
        .eq("work_item_id", workItem.id)
        .order("act_date", { ascending: false });
      
      if (error) throw error;
      
      if (acts && acts.length > 0) {
        return acts.map((act: any) => ({
          id: act.id,
          act_date: act.act_date,
          act_date_raw: act.act_date_raw,
          description: act.description,
          act_type: act.act_type,
          source: act.source || "DEFAULT",
          source_reference: act.source_reference,
          milestone_type: act.milestone_type || null,
          triggers_phase_change: act.triggers_phase_change || false,
          created_at: act.created_at,
        })) as Estado[];
      }
      
      // Fallback to legacy actuaciones table if no work_item_acts
      const legacyFilingId = workItem.legacy_filing_id;
      const legacyProcessId = workItem.legacy_process_id;
      
      if (legacyFilingId || legacyProcessId) {
        let query = supabase
          .from("actuaciones")
          .select("*")
          .order("actuacion_date", { ascending: false });
        
        if (legacyFilingId) {
          query = query.eq("filing_id", legacyFilingId);
        } else if (legacyProcessId) {
          query = query.eq("monitored_process_id", legacyProcessId);
        }
        
        const { data: legacyActs } = await query;
        
        if (legacyActs) {
          return legacyActs.map((act: any) => ({
            id: act.id,
            act_date: act.actuacion_date,
            act_date_raw: act.fecha_actuacion_raw,
            description: act.normalized_text || act.raw_text || act.anotacion,
            act_type: act.act_type_guess,
            source: act.adapter_name || "LEGACY",
            source_reference: act.source_url,
            milestone_type: null,
            triggers_phase_change: false,
            created_at: act.created_at,
          })) as Estado[];
        }
      }
      
      return [];
    },
    enabled: !!workItem.id,
  });

  const getSourceConfig = (source: string) => {
    return SOURCE_CONFIG[source] || SOURCE_CONFIG.DEFAULT;
  };

  const getMilestoneConfig = (milestoneType: string | null) => {
    if (!milestoneType) return null;
    return MILESTONE_CONFIG[milestoneType] || null;
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Últimas Actuaciones (Estados)
              <Badge variant="secondary" className="ml-2">
                {estados?.length || 0} registros
              </Badge>
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            Historial de actuaciones importadas desde ICARUS o sincronizadas desde la Rama Judicial.
            Los hitos detectados (Auto Admisorio, Audiencias, Sentencias) se marcan automáticamente.
          </p>
        </CardContent>
      </Card>

      {/* Empty state */}
      {!estados || estados.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Scale className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">Sin estados registrados</h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Los estados aparecerán aquí cuando importes un archivo de Estados de ICARUS
                o cuando se sincronicen automáticamente desde la Rama Judicial.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Estados Timeline */
        <div className="space-y-3">
          {estados.map((estado, index) => {
            const sourceConfig = getSourceConfig(estado.source);
            const milestoneConfig = getMilestoneConfig(estado.milestone_type);
            const SourceIcon = sourceConfig.icon;

            return (
              <Card 
                key={estado.id} 
                className={cn(
                  "transition-all hover:shadow-md",
                  estado.triggers_phase_change && "border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20",
                  milestoneConfig && !estado.triggers_phase_change && "border-l-4 border-l-primary"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left side: Content */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Tags row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Source badge */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className={cn("text-xs gap-1", sourceConfig.color)}>
                                <SourceIcon className="h-3 w-3" />
                                {sourceConfig.label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Fuente: {estado.source}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {/* Milestone badge */}
                        {milestoneConfig && (
                          <Badge className={cn("text-xs gap-1", milestoneConfig.color, "bg-transparent border")}>
                            <milestoneConfig.icon className="h-3 w-3" />
                            {milestoneConfig.label}
                          </Badge>
                        )}

                        {/* Phase change indicator */}
                        {estado.triggers_phase_change && (
                          <Badge className="text-xs bg-emerald-500 text-white">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Cambio de Fase
                          </Badge>
                        )}

                        {/* Act type */}
                        {estado.act_type && !milestoneConfig && (
                          <Badge variant="secondary" className="text-xs">
                            {estado.act_type}
                          </Badge>
                        )}
                      </div>

                      {/* Description */}
                      <p className="text-sm leading-relaxed">
                        {estado.description}
                      </p>

                      {/* Raw date if different */}
                      {estado.act_date_raw && estado.act_date_raw !== estado.act_date && (
                        <p className="text-xs text-muted-foreground italic">
                          Fecha original: {estado.act_date_raw}
                        </p>
                      )}
                    </div>

                    {/* Right side: Date and actions */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {estado.act_date ? (
                        <>
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {format(new Date(estado.act_date), "d MMM yyyy", { locale: es })}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(estado.act_date), { addSuffix: true, locale: es })}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin fecha</span>
                      )}

                      {estado.source_reference && (
                        <a
                          href={estado.source_reference}
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
      )}

      {/* Info footer */}
      {estados && estados.length > 0 && (
        <Card className="bg-muted/50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p>
                  Los estados importados generan alertas y calculan términos automáticamente.
                  Los hitos como <strong>Auto Admisorio</strong> actualizan la fase del proceso.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
