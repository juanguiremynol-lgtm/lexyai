/**
 * Timeline Tab - Shows process_events for the work item
 * Displays normalized events with source attribution (CPNU/PUBLICACIONES/ICARUS/MANUAL)
 * Shows detected milestone chips with pattern match explanations
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  Clock, 
  FileText, 
  Calendar, 
  ExternalLink,
  AlertCircle,
  CheckCircle,
  FileImage,
  Camera,
  Database,
  Globe,
  User,
  Milestone,
  Sparkles,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getMilestoneDisplayName } from "@/lib/scraping/milestone-mapper";

import type { WorkItem } from "@/types/work-item";

interface TimelineTabProps {
  workItem: WorkItem & { _source?: string };
}

interface DetectedMilestone {
  milestone_type: string;
  confidence: number;
  pattern_id: string;
  matched_text: string;
  keywords_matched?: string[];
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
  hash_fingerprint: string | null;
  attachments: Array<{ url: string; name?: string; label?: string }> | null;
  detected_milestones: DetectedMilestone[] | null;
  created_at: string;
}

interface EvidenceSnapshot {
  id: string;
  process_event_id: string;
  screenshot_path: string | null;
  source_url: string | null;
  raw_html: string | null;
  raw_markdown: string | null;
  created_at: string;
}

// Event type configuration with icons and colors
const EVENT_TYPE_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  AUTO_ADMISORIO: { icon: CheckCircle, color: "text-emerald-500", label: "Auto Admisorio" },
  AUTO: { icon: FileText, color: "text-blue-500", label: "Auto" },
  SENTENCIA: { icon: CheckCircle, color: "text-green-600", label: "Sentencia" },
  FALLO: { icon: CheckCircle, color: "text-green-500", label: "Fallo" },
  NOTIFICACION: { icon: AlertCircle, color: "text-amber-500", label: "Notificación" },
  AUDIENCIA: { icon: Calendar, color: "text-purple-500", label: "Audiencia" },
  MEMORIAL: { icon: FileText, color: "text-indigo-500", label: "Memorial" },
  TRASLADO: { icon: FileText, color: "text-cyan-500", label: "Traslado" },
  PROVIDENCIA: { icon: FileText, color: "text-violet-500", label: "Providencia" },
  RADICACION: { icon: FileText, color: "text-teal-500", label: "Radicación" },
  EMPLAZAMIENTO: { icon: AlertCircle, color: "text-orange-500", label: "Emplazamiento" },
  IMPULSO: { icon: Clock, color: "text-slate-500", label: "Impulso" },
  ESTADO: { icon: FileText, color: "text-gray-500", label: "Estado" },
  ACTUACION: { icon: Clock, color: "text-muted-foreground", label: "Actuación" },
  DEFAULT: { icon: Clock, color: "text-muted-foreground", label: "Evento" },
};

// Source configuration with icons and colors
const SOURCE_CONFIG: Record<string, { icon: typeof Globe; color: string; bgColor: string; label: string }> = {
  CPNU: { icon: Database, color: "text-blue-700 dark:text-blue-400", bgColor: "bg-blue-100 dark:bg-blue-900/30", label: "CPNU" },
  PUBLICACIONES: { icon: Globe, color: "text-green-700 dark:text-green-400", bgColor: "bg-green-100 dark:bg-green-900/30", label: "Publicaciones" },
  ICARUS: { icon: Database, color: "text-purple-700 dark:text-purple-400", bgColor: "bg-purple-100 dark:bg-purple-900/30", label: "ICARUS" },
  HISTORICO: { icon: Globe, color: "text-amber-700 dark:text-amber-400", bgColor: "bg-amber-100 dark:bg-amber-900/30", label: "Histórico" },
  MANUAL: { icon: User, color: "text-gray-700 dark:text-gray-400", bgColor: "bg-gray-100 dark:bg-gray-900/30", label: "Manual" },
  RAMA_JUDICIAL: { icon: Database, color: "text-blue-700 dark:text-blue-400", bgColor: "bg-blue-100 dark:bg-blue-900/30", label: "Rama Judicial" },
  UNKNOWN: { icon: Globe, color: "text-gray-500", bgColor: "bg-gray-100 dark:bg-gray-900/30", label: "Desconocido" },
};

export function TimelineTab({ workItem }: TimelineTabProps) {
  // Fetch process events
  const { data: events, isLoading } = useQuery({
    queryKey: ["work-item-events", workItem.id],
    queryFn: async () => {
      // Fetch events using work_item_id
      const { data } = await supabase
        .from("process_events")
        .select("*")
        .eq("work_item_id", workItem.id)
        .order("event_date", { ascending: false, nullsFirst: false });
      
      return (data || []) as unknown as ProcessEvent[];
    },
    enabled: !!workItem.id,
  });

  // Fetch evidence snapshots for events that have them
  const eventIds = events?.map(e => e.id) || [];
  const { data: evidenceSnapshots } = useQuery({
    queryKey: ["evidence-snapshots", eventIds],
    queryFn: async () => {
      if (eventIds.length === 0) return {};
      
      const { data } = await supabase
        .from("evidence_snapshots")
        .select("*")
        .in("process_event_id", eventIds);
      
      // Map by process_event_id for easy lookup
      const snapshotMap: Record<string, EvidenceSnapshot> = {};
      if (data) {
        for (const snapshot of data) {
          snapshotMap[snapshot.process_event_id] = snapshot as EvidenceSnapshot;
        }
      }
      return snapshotMap;
    },
    enabled: eventIds.length > 0,
  });

  const getEventConfig = (eventType: string | null) => {
    if (!eventType) return EVENT_TYPE_CONFIG.DEFAULT;
    
    const upperType = eventType.toUpperCase();
    // Check for exact match first
    if (EVENT_TYPE_CONFIG[upperType]) return EVENT_TYPE_CONFIG[upperType];
    
    // Then check for partial matches
    for (const [key, config] of Object.entries(EVENT_TYPE_CONFIG)) {
      if (key !== 'DEFAULT' && upperType.includes(key)) return config;
    }
    return EVENT_TYPE_CONFIG.DEFAULT;
  };

  const getSourceConfig = (source: string | null) => {
    if (!source) return SOURCE_CONFIG.UNKNOWN;
    
    const upperSource = source.toUpperCase();
    if (SOURCE_CONFIG[upperSource]) return SOURCE_CONFIG[upperSource];
    
    // Check for partial matches
    if (upperSource.includes('CPNU') || upperSource.includes('RAMA')) return SOURCE_CONFIG.CPNU;
    if (upperSource.includes('PUBLICACIONES')) return SOURCE_CONFIG.PUBLICACIONES;
    if (upperSource.includes('ICARUS')) return SOURCE_CONFIG.ICARUS;
    if (upperSource.includes('HISTORICO')) return SOURCE_CONFIG.HISTORICO;
    if (upperSource.includes('MANUAL')) return SOURCE_CONFIG.MANUAL;
    
    return SOURCE_CONFIG.UNKNOWN;
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
    <TooltipProvider>
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
            {events.map((event) => {
              const eventConfig = getEventConfig(event.event_type);
              const sourceConfig = getSourceConfig(event.source);
              const Icon = eventConfig.icon;
              const SourceIcon = sourceConfig.icon;
              const snapshot = evidenceSnapshots?.[event.id];

              return (
                <div key={event.id} className="relative flex gap-4 pl-2">
                  {/* Timeline dot */}
                  <div className={cn(
                    "relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 bg-background",
                    eventConfig.color.replace("text-", "border-")
                  )}>
                    <Icon className={cn("h-5 w-5", eventConfig.color)} />
                  </div>

                  {/* Event card */}
                  <Card className="flex-1">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          {/* Header with type and source badges */}
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Badge variant="outline" className={cn("text-xs", eventConfig.color)}>
                              {eventConfig.label}
                            </Badge>
                            
                            {/* Source badge with icon */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge 
                                  variant="secondary" 
                                  className={cn(
                                    "text-xs gap-1",
                                    sourceConfig.bgColor,
                                    sourceConfig.color
                                  )}
                                >
                                  <SourceIcon className="h-3 w-3" />
                                  {sourceConfig.label}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Fuente: {sourceConfig.label}</p>
                                {event.hash_fingerprint && (
                                  <p className="text-xs text-muted-foreground font-mono">
                                    ID: {event.hash_fingerprint.substring(0, 8)}...
                                  </p>
                                )}
                              </TooltipContent>
                            </Tooltip>

                            {/* Evidence snapshot indicator */}
                            {snapshot && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="text-xs gap-1 border-muted-foreground/30">
                                    <Camera className="h-3 w-3 text-muted-foreground" />
                                    <span className="text-muted-foreground">Evidencia</span>
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Snapshot disponible</p>
                                  {snapshot.screenshot_path && <p className="text-xs">• Captura de pantalla</p>}
                                  {snapshot.raw_html && <p className="text-xs">• HTML crudo</p>}
                                  {snapshot.raw_markdown && <p className="text-xs">• Markdown</p>}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>

                          {/* Detected Milestones */}
                          {event.detected_milestones && event.detected_milestones.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2">
                              {event.detected_milestones.map((milestone, idx) => (
                                <Tooltip key={idx}>
                                  <TooltipTrigger asChild>
                                    <Badge 
                                      variant="default"
                                      className="text-xs gap-1 cursor-help bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
                                    >
                                      <Sparkles className="h-3 w-3" />
                                      {getMilestoneDisplayName(milestone.milestone_type)}
                                      <span className="text-[10px] opacity-70">
                                        {(milestone.confidence * 100).toFixed(0)}%
                                      </span>
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">
                                    <div className="space-y-1">
                                      <p className="font-medium flex items-center gap-1">
                                        <Milestone className="h-3 w-3" />
                                        Hito Detectado
                                      </p>
                                      <p className="text-xs">
                                        <span className="text-muted-foreground">Patrón: </span>
                                        <code className="bg-muted px-1 rounded text-[10px]">
                                          {milestone.pattern_id.substring(0, 8)}...
                                        </code>
                                      </p>
                                      <p className="text-xs">
                                        <span className="text-muted-foreground">Coincidencia: </span>
                                        <mark className="bg-accent px-1 rounded text-[10px]">
                                          {milestone.matched_text}
                                        </mark>
                                      </p>
                                      {milestone.keywords_matched && milestone.keywords_matched.length > 0 && (
                                        <p className="text-xs">
                                          <span className="text-muted-foreground">Keywords: </span>
                                          {milestone.keywords_matched.join(", ")}
                                        </p>
                                      )}
                                      <p className="text-xs text-muted-foreground">
                                        Confianza: {(milestone.confidence * 100).toFixed(0)}%
                                      </p>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              ))}
                            </div>
                          )}

                          {/* Title */}
                          {event.title && (
                            <h4 className="font-medium mb-1">{event.title}</h4>
                          )}

                          {/* Description */}
                          {event.description && event.description !== event.title && (
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
                                    {att.label || att.name || `Anexo ${i + 1}`}
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

                          <div className="flex gap-1">
                            {snapshot?.screenshot_path && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="sm" asChild>
                                    <a href={snapshot.screenshot_path} target="_blank" rel="noopener noreferrer">
                                      <Camera className="h-4 w-4" />
                                    </a>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Ver captura de pantalla</TooltipContent>
                              </Tooltip>
                            )}

                            {event.source_url && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="sm" asChild>
                                    <a href={event.source_url} target="_blank" rel="noopener noreferrer">
                                      <ExternalLink className="h-4 w-4" />
                                    </a>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Ver fuente original</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
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
    </TooltipProvider>
  );
}