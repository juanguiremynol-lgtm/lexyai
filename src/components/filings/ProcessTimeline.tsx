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
  MessageSquare
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProcessTimelineProps {
  filingId: string;
}

const EVENT_ICONS: Record<string, typeof FileText> = {
  AUDIENCIA: Gavel,
  AUTO: FileCheck,
  SENTENCIA: Gavel,
  NOTIFICACION: Bell,
  TRASLADO: ArrowRight,
  MEMORIAL: MessageSquare,
  ACTUACION: FileText,
};

const EVENT_COLORS: Record<string, string> = {
  AUDIENCIA: "bg-primary/20 text-primary border-primary/30",
  AUTO: "bg-status-received/20 text-status-received border-status-received/30",
  SENTENCIA: "bg-status-confirmed/20 text-status-confirmed border-status-confirmed/30",
  NOTIFICACION: "bg-status-sent/20 text-status-sent border-status-sent/30",
  TRASLADO: "bg-status-pending/20 text-status-pending border-status-pending/30",
  MEMORIAL: "bg-muted text-muted-foreground border-border",
  ACTUACION: "bg-muted text-muted-foreground border-border",
};

export function ProcessTimeline({ filingId }: ProcessTimelineProps) {
  const { data: events, isLoading } = useQuery({
    queryKey: ["process-events", filingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("process_events")
        .select("*")
        .eq("filing_id", filingId)
        .order("event_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Clock className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="text-center py-8">
        <Clock className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-2 text-muted-foreground">
          No hay actuaciones registradas
        </p>
        <p className="text-sm text-muted-foreground">
          Las actuaciones aparecerán aquí después de activar el rastreador
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

      <div className="space-y-4">
        {events.map((event, index) => {
          const Icon = EVENT_ICONS[event.event_type] || FileText;
          const colorClass = EVENT_COLORS[event.event_type] || EVENT_COLORS.ACTUACION;

          return (
            <div key={event.id} className="relative pl-10">
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
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className={cn("text-xs", colorClass)}>
                        {event.event_type}
                      </Badge>
                      {event.event_date && (
                        <span className="text-xs text-muted-foreground">
                          {formatDateColombia(event.event_date)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{event.description}</p>
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
