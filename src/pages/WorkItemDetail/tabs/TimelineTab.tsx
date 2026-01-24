/**
 * Timeline Tab - Shows process_events for the work item
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Clock, 
  FileText, 
  Calendar, 
  ExternalLink,
  AlertCircle,
  CheckCircle,
  FileImage,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

import type { WorkItem } from "@/types/work-item";

interface TimelineTabProps {
  workItem: WorkItem & { _source?: string };
}

interface ProcessEvent {
  id: string;
  event_date: string | null;
  event_type: string | null;
  title: string | null;
  description: string | null;
  detail: string | null;
  source: string | null;
  source_url: string | null;
  attachments: { url: string; name: string }[] | null;
  created_at: string;
}

const EVENT_TYPE_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  AUTO: { icon: FileText, color: "text-blue-500", label: "Auto" },
  FALLO: { icon: CheckCircle, color: "text-green-500", label: "Fallo" },
  NOTIFICACION: { icon: AlertCircle, color: "text-amber-500", label: "Notificación" },
  AUDIENCIA: { icon: Calendar, color: "text-purple-500", label: "Audiencia" },
  MEMORIAL: { icon: FileText, color: "text-indigo-500", label: "Memorial" },
  DEFAULT: { icon: Clock, color: "text-muted-foreground", label: "Evento" },
};

export function TimelineTab({ workItem }: TimelineTabProps) {
  // Fetch process events
  const { data: events, isLoading } = useQuery({
    queryKey: ["work-item-events", workItem.id],
    queryFn: async () => {
      // Try to fetch from process_events using legacy IDs
      const legacyFilingId = workItem.legacy_filing_id;
      const legacyProcessId = workItem.legacy_process_id;
      
      let events: ProcessEvent[] = [];
      
      if (legacyFilingId) {
        const { data } = await supabase
          .from("process_events")
          .select("*")
          .eq("filing_id", legacyFilingId)
          .order("event_date", { ascending: false });
        
        if (data) events = data as unknown as ProcessEvent[];
      }
      
      if (events.length === 0 && legacyProcessId) {
        const { data } = await supabase
          .from("process_events")
          .select("*")
          .eq("monitored_process_id", legacyProcessId)
          .order("event_date", { ascending: false });
        
        if (data) events = data as unknown as ProcessEvent[];
      }
      
      // Also try work_items table directly for newer items
      if (events.length === 0) {
        // For new work_items, we might not have events yet
        // This would be populated by the crawler
      }
      
      return events;
    },
    enabled: !!workItem.id,
  });

  const getEventConfig = (eventType: string | null) => {
    if (!eventType) return EVENT_TYPE_CONFIG.DEFAULT;
    
    const upperType = eventType.toUpperCase();
    for (const [key, config] of Object.entries(EVENT_TYPE_CONFIG)) {
      if (upperType.includes(key)) return config;
    }
    return EVENT_TYPE_CONFIG.DEFAULT;
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">Sin eventos registrados</h3>
            <p className="text-muted-foreground text-sm">
              Los eventos aparecerán aquí cuando se detecten actuaciones o el sistema las registre automáticamente.
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
            <Clock className="h-5 w-5" />
            Línea de Tiempo
            <Badge variant="secondary" className="ml-auto">
              {events.length} eventos
            </Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" />

        {/* Events */}
        <div className="space-y-4">
          {events.map((event, index) => {
            const config = getEventConfig(event.event_type);
            const Icon = config.icon;

            return (
              <div key={event.id} className="relative flex gap-4 pl-2">
                {/* Timeline dot */}
                <div className={cn(
                  "relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 bg-background",
                  config.color.replace("text-", "border-")
                )}>
                  <Icon className={cn("h-5 w-5", config.color)} />
                </div>

                {/* Event card */}
                <Card className="flex-1">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Header */}
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className={cn("text-xs", config.color)}>
                            {config.label}
                          </Badge>
                          {event.source && (
                            <Badge variant="secondary" className="text-xs">
                              {event.source}
                            </Badge>
                          )}
                        </div>

                        {/* Title */}
                        {event.title && (
                          <h4 className="font-medium mb-1">{event.title}</h4>
                        )}

                        {/* Description */}
                        {event.description && (
                          <p className="text-sm text-muted-foreground mb-2">
                            {event.description}
                          </p>
                        )}

                        {/* Detail */}
                        {event.detail && (
                          <p className="text-sm text-muted-foreground/80 italic">
                            {event.detail}
                          </p>
                        )}

                        {/* Attachments */}
                        {event.attachments && event.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            {event.attachments.map((att, i) => (
                              <Button
                                key={i}
                                variant="outline"
                                size="sm"
                                asChild
                                className="text-xs"
                              >
                                <a href={att.url} target="_blank" rel="noopener noreferrer">
                                  <FileImage className="h-3 w-3 mr-1" />
                                  {att.name || `Anexo ${i + 1}`}
                                </a>
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Date & Links */}
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {event.event_date && (
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {format(new Date(event.event_date), "d MMM yyyy", { locale: es })}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(event.event_date), { addSuffix: true, locale: es })}
                            </p>
                          </div>
                        )}

                        {event.source_url && (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={event.source_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
