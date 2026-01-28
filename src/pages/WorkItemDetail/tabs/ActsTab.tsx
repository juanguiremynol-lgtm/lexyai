/**
 * Acts Tab - Shows actuaciones for the work item with all SAMAI fields
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Scale, 
  Calendar,
  Clock,
  FileText,
  ExternalLink,
  Paperclip,
  Hash,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

import type { WorkItem } from "@/types/work-item";

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
  FIJACION: { color: "text-amber-600", bgColor: "bg-amber-500/10" },
  AUDIENCIA: { color: "text-purple-600", bgColor: "bg-purple-500/10" },
  MEMORIAL: { color: "text-indigo-600", bgColor: "bg-indigo-500/10" },
  TRASLADO: { color: "text-cyan-600", bgColor: "bg-cyan-500/10" },
  RECURSO: { color: "text-orange-600", bgColor: "bg-orange-500/10" },
  REPARTO: { color: "text-pink-600", bgColor: "bg-pink-500/10" },
  EXPEDIENTE: { color: "text-slate-600", bgColor: "bg-slate-500/10" },
  DEFAULT: { color: "text-muted-foreground", bgColor: "bg-muted/50" },
};

// Estado badge styling
const ESTADO_CONFIG: Record<string, { variant: "default" | "secondary" | "outline"; icon: typeof CheckCircle2 }> = {
  REGISTRADA: { variant: "secondary", icon: CheckCircle2 },
  CLASIFICADA: { variant: "default", icon: CheckCircle2 },
  PENDIENTE: { variant: "outline", icon: AlertCircle },
};

interface Actuacion {
  id: string;
  owner_id: string;
  work_item_id: string | null;
  act_date: string | null;
  act_date_raw: string | null;
  raw_text: string;
  normalized_text: string;
  act_type_guess: string | null;
  source: string;
  source_url: string | null;
  adapter_name: string | null;
  hash_fingerprint: string;
  created_at: string;
  // New SAMAI fields
  fecha_registro: string | null;
  estado: string | null;
  anexos_count: number | null;
  indice: string | null;
}

export function ActsTab({ workItem }: ActsTabProps) {
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

  const getActTypeConfig = (actType: string | null, rawText: string) => {
    const searchText = (actType || rawText || '').toUpperCase();
    for (const [key, config] of Object.entries(ACT_TYPE_CONFIG)) {
      if (key !== 'DEFAULT' && searchText.includes(key)) return config;
    }
    return ACT_TYPE_CONFIG.DEFAULT;
  };

  const getEstadoConfig = (estado: string | null) => {
    if (!estado) return null;
    return ESTADO_CONFIG[estado.toUpperCase()] || ESTADO_CONFIG.PENDIENTE;
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
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Actuaciones
            <Badge variant="secondary" className="ml-auto">
              {acts.length} {acts.length === 1 ? 'actuación' : 'actuaciones'}
            </Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      <div className="space-y-3">
        {acts.map((act) => {
          const config = getActTypeConfig(act.act_type_guess, act.raw_text);
          const estadoConfig = getEstadoConfig(act.estado);
          const EstadoIcon = estadoConfig?.icon || CheckCircle2;

          return (
            <Card key={act.id} className={cn("transition-colors hover:shadow-md", config.bgColor)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Header with badges */}
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      {/* Índice */}
                      {act.indice && (
                        <Badge variant="outline" className="text-xs font-mono gap-1">
                          <Hash className="h-3 w-3" />
                          {act.indice}
                        </Badge>
                      )}
                      
                      {/* Act type */}
                      {act.act_type_guess && (
                        <Badge variant="outline" className={cn("text-xs font-medium", config.color)}>
                          {act.act_type_guess}
                        </Badge>
                      )}
                      
                      {/* Estado */}
                      {act.estado && estadoConfig && (
                        <Badge variant={estadoConfig.variant} className="text-xs gap-1">
                          <EstadoIcon className="h-3 w-3" />
                          {act.estado}
                        </Badge>
                      )}
                      
                      {/* Anexos count */}
                      {act.anexos_count !== null && act.anexos_count > 0 && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <Paperclip className="h-3 w-3" />
                          {act.anexos_count} {act.anexos_count === 1 ? 'anexo' : 'anexos'}
                        </Badge>
                      )}
                      
                      {/* Source */}
                      {act.adapter_name && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          {act.adapter_name.toUpperCase()}
                        </Badge>
                      )}
                    </div>

                    {/* Main text - raw_text is the actuacion title */}
                    <p className="font-medium text-sm mb-1">
                      {act.raw_text}
                    </p>

                    {/* Anotación - normalized_text contains the full text */}
                    {act.normalized_text && act.normalized_text !== act.raw_text && (
                      <p className="text-sm text-muted-foreground line-clamp-3">
                        {act.normalized_text.replace(act.raw_text + ' - ', '')}
                      </p>
                    )}

                    {/* Fecha de registro (when it was registered in system) */}
                    {act.fecha_registro && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>Registrado: {format(new Date(act.fecha_registro), "d MMM yyyy, HH:mm", { locale: es })}</span>
                      </div>
                    )}
                  </div>

                  {/* Date column */}
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

                    {/* Raw date if different */}
                    {act.act_date_raw && act.act_date_raw !== act.act_date && (
                      <p className="text-xs text-muted-foreground italic">
                        Original: {act.act_date_raw}
                      </p>
                    )}

                    {act.source_url && (
                      <a
                        href={act.source_url}
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
