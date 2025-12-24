import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, User, GripVertical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { PROCESS_PHASES, PROCESS_PHASES_ORDER, type ProcessPhase } from "@/lib/constants";
import { toast } from "sonner";

interface MonitoredProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  last_change_at: string | null;
  phase: ProcessPhase | null;
  clients: { id: string; name: string } | null;
}

const PHASE_COLORS: Record<string, string> = {
  amber: "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400",
  orange: "bg-orange-500/10 border-orange-500/20 text-orange-700 dark:text-orange-400",
  rose: "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400",
  violet: "bg-violet-500/10 border-violet-500/20 text-violet-700 dark:text-violet-400",
  purple: "bg-purple-500/10 border-purple-500/20 text-purple-700 dark:text-purple-400",
  blue: "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400",
  cyan: "bg-cyan-500/10 border-cyan-500/20 text-cyan-700 dark:text-cyan-400",
  teal: "bg-teal-500/10 border-teal-500/20 text-teal-700 dark:text-teal-400",
  emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400",
};

const BADGE_COLORS: Record<string, string> = {
  amber: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30",
  orange: "bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30",
  rose: "bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-500/30",
  violet: "bg-violet-500/20 text-violet-700 dark:text-violet-400 border-violet-500/30",
  purple: "bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/30",
  blue: "bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30",
  cyan: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-400 border-cyan-500/30",
  teal: "bg-teal-500/20 text-teal-700 dark:text-teal-400 border-teal-500/30",
  emerald: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};

export function ProcessPipeline() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: processes, isLoading } = useQuery({
    queryKey: ["process-pipeline"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("monitored_processes")
        .select(
          "id, radicado, despacho_name, monitoring_enabled, last_checked_at, last_change_at, phase, clients(id, name)"
        )
        .eq("owner_id", user.user.id)
        .eq("monitoring_enabled", true)
        .order("last_change_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      return data as unknown as MonitoredProcess[];
    },
  });

  const updatePhaseMutation = useMutation({
    mutationFn: async ({ processId, newPhase }: { processId: string; newPhase: ProcessPhase }) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ phase: newPhase })
        .eq("id", processId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["process-pipeline"] });
      toast.success("Fase actualizada");
    },
    onError: () => {
      toast.error("Error al actualizar la fase");
    },
  });

  if (isLoading) {
    return (
      <div className="flex gap-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-[400px] w-64 flex-shrink-0" />
        ))}
      </div>
    );
  }

  const allProcesses = processes || [];

  // Group processes by phase
  const processesByPhase: Record<ProcessPhase, MonitoredProcess[]> = {} as Record<ProcessPhase, MonitoredProcess[]>;
  PROCESS_PHASES_ORDER.forEach((phase) => {
    processesByPhase[phase] = [];
  });

  allProcesses.forEach((process) => {
    const phase = process.phase || "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR";
    if (processesByPhase[phase]) {
      processesByPhase[phase].push(process);
    }
  });

  const handleMoveProcess = (processId: string, currentPhase: ProcessPhase, direction: "prev" | "next") => {
    const currentIndex = PROCESS_PHASES_ORDER.indexOf(currentPhase);
    let newIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;
    
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= PROCESS_PHASES_ORDER.length) newIndex = PROCESS_PHASES_ORDER.length - 1;
    
    if (newIndex !== currentIndex) {
      updatePhaseMutation.mutate({ processId, newPhase: PROCESS_PHASES_ORDER[newIndex] });
    }
  };

  return (
    <ScrollArea className="w-full whitespace-nowrap">
      <div className="flex gap-3 pb-4">
        {PROCESS_PHASES_ORDER.map((phase) => {
          const phaseConfig = PROCESS_PHASES[phase];
          const phaseProcesses = processesByPhase[phase];
          const colorClass = PHASE_COLORS[phaseConfig.color] || PHASE_COLORS.blue;
          const badgeClass = BADGE_COLORS[phaseConfig.color] || BADGE_COLORS.blue;

          return (
            <div key={phase} className="flex-shrink-0 w-64">
              <div className={`rounded-lg p-3 min-h-[400px] border ${colorClass}`}>
                <div className="flex items-center justify-between mb-3">
                  <Badge variant="outline" className={`text-xs ${badgeClass}`}>
                    {phaseConfig.shortLabel}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-medium">
                    {phaseProcesses.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {phaseProcesses.map((process) => (
                    <Card
                      key={process.id}
                      className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all group"
                      onClick={() => navigate(`/process-status/${process.id}`)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-xs truncate">
                              {process.radicado}
                            </p>
                            <p className="text-xs text-muted-foreground truncate mt-1">
                              {process.despacho_name || "Sin despacho"}
                            </p>
                            {process.clients && (
                              <div className="flex items-center gap-1 mt-2">
                                <User className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground truncate">
                                  {process.clients.name}
                                </span>
                              </div>
                            )}
                            {process.last_checked_at && (
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {formatDistanceToNow(
                                  new Date(process.last_checked_at),
                                  { addSuffix: true, locale: es }
                                )}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/process-status/${process.id}`);
                              }}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                disabled={PROCESS_PHASES_ORDER.indexOf(phase) === 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveProcess(process.id, phase, "prev");
                                }}
                              >
                                <GripVertical className="h-3 w-3 rotate-90" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                disabled={PROCESS_PHASES_ORDER.indexOf(phase) === PROCESS_PHASES_ORDER.length - 1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveProcess(process.id, phase, "next");
                                }}
                              >
                                <GripVertical className="h-3 w-3 -rotate-90" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {phaseProcesses.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="text-[10px]">Sin procesos</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
