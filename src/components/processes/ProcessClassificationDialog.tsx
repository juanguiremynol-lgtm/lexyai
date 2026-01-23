import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface UnclassifiedProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  clients: { id: string; name: string } | null;
  monitoring_enabled: boolean;
}

interface ProcessClassificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  processes: UnclassifiedProcess[];
  onClassified: () => void;
}

export function ProcessClassificationDialog({
  open,
  onOpenChange,
  processes,
  onClassified,
}: ProcessClassificationDialogProps) {
  const navigate = useNavigate();
  const [classifiedIds, setClassifiedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirmMonitoring = async (processId: string) => {
    try {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ monitoring_enabled: true })
        .eq("id", processId);

      if (error) throw error;

      setClassifiedIds((prev) => new Set([...prev, processId]));
      toast.success("Proceso confirmado en seguimiento");
    } catch (error) {
      toast.error("Error al confirmar proceso");
    }
  };

  const handleConfirmAll = async () => {
    setIsSubmitting(true);
    try {
      const unconfirmedIds = processes
        .filter((p) => !classifiedIds.has(p.id) && !p.monitoring_enabled)
        .map((p) => p.id);

      if (unconfirmedIds.length === 0) {
        onOpenChange(false);
        onClassified();
        return;
      }

      const { error } = await supabase
        .from("monitored_processes")
        .update({ monitoring_enabled: true })
        .in("id", unconfirmedIds);

      if (error) throw error;

      toast.success(`${unconfirmedIds.length} procesos confirmados en seguimiento`);
      onOpenChange(false);
      onClassified();
    } catch (error) {
      toast.error("Error al confirmar procesos");
    } finally {
      setIsSubmitting(false);
    }
  };

  const unclassifiedCount = processes.filter(
    (p) => !classifiedIds.has(p.id) && !p.monitoring_enabled
  ).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Clasificar Procesos Monitoreados</DialogTitle>
          <DialogDescription>
            Los siguientes procesos necesitan confirmación de su estado. Por defecto,
            serán clasificados como "En Seguimiento".
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[400px] pr-4">
          <div className="space-y-3">
            {processes.map((process) => {
              const isClassified =
                classifiedIds.has(process.id) || process.monitoring_enabled;

              return (
                <div
                  key={process.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    isClassified
                      ? "bg-muted/50 border-muted"
                      : "bg-background border-border"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm truncate">
                        {process.radicado}
                      </p>
                      {isClassified && (
                        <Badge variant="secondary" className="shrink-0">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          En Seguimiento
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {process.despacho_name || "Sin despacho asignado"}
                    </p>
                    {process.clients && (
                      <p className="text-xs text-muted-foreground">
                        Cliente: {process.clients.name}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/cgp/${process.id}`)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    {!isClassified && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConfirmMonitoring(process.id)}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Confirmar
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {unclassifiedCount > 0 && (
          <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {unclassifiedCount} proceso(s) pendientes de clasificar
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          {unclassifiedCount > 0 && (
            <Button onClick={handleConfirmAll} disabled={isSubmitting}>
              Confirmar Todos en Seguimiento
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
