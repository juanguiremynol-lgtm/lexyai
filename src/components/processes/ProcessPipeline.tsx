import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, ExternalLink, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { PROCESS_STAGES } from "@/lib/constants";

interface MonitoredProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  last_change_at: string | null;
  clients: { id: string; name: string } | null;
}

export function ProcessPipeline() {
  const navigate = useNavigate();

  const { data: processes, isLoading } = useQuery({
    queryKey: ["process-pipeline"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("monitored_processes")
        .select(
          "id, radicado, despacho_name, monitoring_enabled, last_checked_at, last_change_at, clients(id, name)"
        )
        .eq("owner_id", user.user.id)
        .eq("monitoring_enabled", true)
        .order("last_change_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      return data as MonitoredProcess[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex gap-4">
        <Skeleton className="h-[400px] w-72 flex-shrink-0" />
      </div>
    );
  }

  const activeProcesses = processes || [];

  return (
    <ScrollArea className="w-full whitespace-nowrap">
      <div className="flex gap-4 pb-4">
        {/* En Seguimiento Column */}
        <div className="flex-shrink-0 w-80">
          <div className="bg-status-active/10 rounded-lg p-3 min-h-[400px] border border-status-active/20">
            <div className="flex items-center justify-between mb-3">
              <Badge
                variant="outline"
                className="bg-status-active/20 text-status-active border-status-active/30"
              >
                <Eye className="h-3 w-3 mr-1" />
                {PROCESS_STAGES.EN_SEGUIMIENTO.label}
              </Badge>
              <span className="text-xs text-muted-foreground font-medium">
                {activeProcesses.length}
              </span>
            </div>
            <div className="space-y-2">
              {activeProcesses.map((process) => (
                <Card
                  key={process.id}
                  className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
                  onClick={() => navigate(`/process-status/${process.id}`)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm truncate">
                          {process.radicado}
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-1">
                          {process.despacho_name || "Sin despacho"}
                        </p>
                        {process.clients && (
                          <div className="flex items-center gap-1 mt-2">
                            <User className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                              {process.clients.name}
                            </span>
                          </div>
                        )}
                        {process.last_checked_at && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Revisado{" "}
                            {formatDistanceToNow(
                              new Date(process.last_checked_at),
                              { addSuffix: true, locale: es }
                            )}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/process-status/${process.id}`);
                        }}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {activeProcesses.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Eye className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">
                    Procesos con radicado y auto admisorio aparecerán aquí
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Future stages can be added here */}
        <div className="flex-shrink-0 w-72 opacity-50">
          <div className="bg-muted/30 rounded-lg p-3 min-h-[400px] border border-dashed border-muted-foreground/30">
            <div className="flex items-center justify-between mb-3">
              <Badge variant="outline" className="opacity-50">
                Próxima etapa
              </Badge>
            </div>
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-xs">Próximamente: más etapas del proceso</p>
            </div>
          </div>
        </div>
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
