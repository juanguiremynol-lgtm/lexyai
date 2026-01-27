import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Eye,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Settings,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { ProcessClassificationDialog } from "./ProcessClassificationDialog";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface MonitoredProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  last_change_at: string | null;
  clients: { id: string; name: string } | null;
}

export function MonitoredProcessesSection() {
  const navigate = useNavigate();
  const [showClassificationDialog, setShowClassificationDialog] =
    useState(false);

  const { data: processes, isLoading, refetch } = useQuery({
    queryKey: ["dashboard-monitored-processes"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("monitored_processes")
        .select("id, radicado, despacho_name, monitoring_enabled, last_checked_at, last_change_at, clients(id, name)")
        .eq("owner_id", user.user.id)
        .order("last_change_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      return data as MonitoredProcess[];
    },
  });

  const unclassifiedProcesses =
    processes?.filter((p) => !p.monitoring_enabled) || [];
  const activeProcesses = processes?.filter((p) => p.monitoring_enabled) || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Procesos en Seguimiento
            <Badge variant="secondary">{activeProcesses.length}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            {unclassifiedProcesses.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowClassificationDialog(true)}
              >
                <AlertCircle className="h-4 w-4 mr-2 text-warning" />
                {unclassifiedProcesses.length} sin clasificar
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/process-status")}
            >
              <Settings className="h-4 w-4 mr-1" />
              Gestionar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {activeProcesses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay procesos en seguimiento activo</p>
              <Button
                variant="link"
                className="mt-2"
                onClick={() => navigate("/process-status")}
              >
                Agregar procesos a monitorear
              </Button>
            </div>
          ) : (
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-3">
                {activeProcesses.map((process) => (
                  <div
                    key={process.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/app/work-items/${process.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm truncate">
                          {process.radicado}
                        </p>
                        <Badge
                          variant="outline"
                          className="shrink-0 text-xs bg-status-active/10 text-status-active border-status-active/30"
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />
                          En Seguimiento
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        {process.despacho_name || "Sin despacho asignado"}
                      </p>
                      <div className="flex items-center gap-4 mt-1">
                        {process.clients && (
                          <p className="text-xs text-muted-foreground">
                            {process.clients.name}
                          </p>
                        )}
                        {process.last_checked_at && (
                          <p className="text-xs text-muted-foreground">
                            Revisado{" "}
                            {formatDistanceToNow(
                              new Date(process.last_checked_at),
                              { addSuffix: true, locale: es }
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/app/work-items/${process.id}`);
                      }}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <ProcessClassificationDialog
        open={showClassificationDialog}
        onOpenChange={setShowClassificationDialog}
        processes={unclassifiedProcesses}
        onClassified={refetch}
      />
    </>
  );
}
