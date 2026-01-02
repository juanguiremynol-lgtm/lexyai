import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDateColombia } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { 
  Clock, 
  FileText, 
  Gavel, 
  Bell, 
  ArrowRight,
  FileCheck,
  MessageSquare,
  Scale,
  Inbox,
  Calendar
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProcessTimelineProps {
  filingId?: string;
  processId?: string;
}

// Map act_type_guess to icons
const ACT_TYPE_ICONS: Record<string, typeof FileText> = {
  AUTO_ADMISORIO: FileCheck,
  MANDAMIENTO_DE_PAGO: Scale,
  NOTIFICACION: Bell,
  EXPEDIENTE_AL_DESPACHO: Inbox,
  SENTENCIA: Gavel,
  AUDIENCIA: Calendar,
  RECURSO: ArrowRight,
  TRASLADO: ArrowRight,
  AUTO: FileCheck,
  MEMORIAL: MessageSquare,
};

// Map act_type_guess to colors
const ACT_TYPE_COLORS: Record<string, string> = {
  AUTO_ADMISORIO: "bg-status-confirmed/20 text-status-confirmed border-status-confirmed/30",
  MANDAMIENTO_DE_PAGO: "bg-primary/20 text-primary border-primary/30",
  NOTIFICACION: "bg-status-sent/20 text-status-sent border-status-sent/30",
  EXPEDIENTE_AL_DESPACHO: "bg-muted text-muted-foreground border-border",
  SENTENCIA: "bg-status-confirmed/20 text-status-confirmed border-status-confirmed/30",
  AUDIENCIA: "bg-primary/20 text-primary border-primary/30",
  RECURSO: "bg-status-pending/20 text-status-pending border-status-pending/30",
  TRASLADO: "bg-status-pending/20 text-status-pending border-status-pending/30",
  DEFAULT: "bg-muted text-muted-foreground border-border",
};

// Translate act_type_guess to human-readable labels
const ACT_TYPE_LABELS: Record<string, string> = {
  AUTO_ADMISORIO: "Auto Admisorio",
  MANDAMIENTO_DE_PAGO: "Mandamiento de Pago",
  NOTIFICACION: "Notificación",
  EXPEDIENTE_AL_DESPACHO: "Expediente al Despacho",
  SENTENCIA: "Sentencia",
  AUDIENCIA: "Audiencia",
  RECURSO: "Recurso",
  TRASLADO: "Traslado",
  AUTO: "Auto",
  MEMORIAL: "Memorial",
};

export function ProcessTimeline({ filingId, processId }: ProcessTimelineProps) {
  const { data: actuaciones, isLoading } = useQuery({
    queryKey: ["actuaciones-timeline", filingId, processId],
    queryFn: async () => {
      let query = supabase
        .from("actuaciones")
        .select("*")
        .order("act_date", { ascending: false, nullsFirst: false });

      if (processId) {
        query = query.eq("monitored_process_id", processId);
      } else if (filingId) {
        query = query.eq("filing_id", filingId);
      } else {
        return [];
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!filingId || !!processId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Clock className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!actuaciones || actuaciones.length === 0) {
    return (
      <div className="text-center py-8">
        <Clock className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-2 text-muted-foreground">
          No hay actuaciones registradas
        </p>
        <p className="text-sm text-muted-foreground">
          Las actuaciones aparecerán aquí después de consultar la Rama Judicial
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

      <div className="space-y-4">
        {actuaciones.map((actuacion) => {
          const actType = actuacion.act_type_guess || "DEFAULT";
          const Icon = ACT_TYPE_ICONS[actType] || FileText;
          const colorClass = ACT_TYPE_COLORS[actType] || ACT_TYPE_COLORS.DEFAULT;
          const label = ACT_TYPE_LABELS[actType] || actType;

          return (
            <div key={actuacion.id} className="relative pl-10">
              {/* Timeline dot */}
              <div className={cn(
                "absolute left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center",
                colorClass
              )}>
                <Icon className="h-3 w-3" />
              </div>

              <div className="bg-card border rounded-lg p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className={cn("text-xs", colorClass)}>
                        {label}
                      </Badge>
                      {actuacion.act_date && (
                        <span className="text-xs text-muted-foreground">
                          {formatDateColombia(actuacion.act_date)}
                        </span>
                      )}
                      {actuacion.adapter_name && (
                        <Badge variant="secondary" className="text-xs">
                          {actuacion.adapter_name === "external_api" || actuacion.adapter_name === "external-rama-judicial-api" 
                            ? "Rama Judicial" 
                            : actuacion.adapter_name}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">{actuacion.raw_text}</p>
                    {actuacion.normalized_text && actuacion.normalized_text !== actuacion.raw_text && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {actuacion.normalized_text}
                      </p>
                    )}
                    {actuacion.source_url && (
                      <a 
                        href={actuacion.source_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline mt-1 inline-block"
                      >
                        Ver fuente
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
