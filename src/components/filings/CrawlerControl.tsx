import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bot,
  RefreshCw,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";

interface CrawlerControlProps {
  filingId: string;
  radicado: string | null;
  crawlerEnabled: boolean | null;
  lastCrawledAt: string | null;
  ramaJudicialUrl: string | null;
}

export function CrawlerControl({
  filingId,
  radicado,
  crawlerEnabled,
  lastCrawledAt,
  ramaJudicialUrl,
}: CrawlerControlProps) {
  const queryClient = useQueryClient();
  const [isEnabled, setIsEnabled] = useState(crawlerEnabled ?? false);

  const toggleCrawler = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from("filings")
        .update({ crawler_enabled: enabled })
        .eq("id", filingId);
      if (error) throw error;
    },
    onSuccess: (_, enabled) => {
      setIsEnabled(enabled);
      queryClient.invalidateQueries({ queryKey: ["filing", filingId] });
      toast.success(enabled ? "Rastreador activado" : "Rastreador desactivado");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const runCrawler = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { data, error } = await supabase.functions.invoke("crawl-rama-judicial", {
        body: {
          filing_id: filingId,
          radicado,
          owner_id: user.id,
          manual_trigger: true,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["filing", filingId] });
      queryClient.invalidateQueries({ queryKey: ["process-events", filingId] });
      queryClient.invalidateQueries({ queryKey: ["hearings", filingId] });
      
      if (data.new_events > 0 || data.new_hearings > 0) {
        toast.success(
          `Encontradas ${data.new_events} nuevas actuaciones y ${data.new_hearings} audiencias`
        );
      } else {
        toast.info("No se encontraron nuevas actuaciones");
      }
    },
    onError: (error) => {
      toast.error("Error al rastrear: " + error.message);
    },
  });

  if (!radicado) {
    return (
      <div className="flex items-center gap-2 p-4 bg-muted rounded-lg">
        <AlertCircle className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Rastreador no disponible</p>
          <p className="text-xs text-muted-foreground">
            Ingrese el número de radicado para habilitar el rastreo automático
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 bg-card border rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h4 className="font-medium">Rastreador Rama Judicial</h4>
            <p className="text-xs text-muted-foreground">
              Monitoreo automático del proceso
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="crawler-toggle" className="text-sm">
            {isEnabled ? "Activo" : "Inactivo"}
          </Label>
          <Switch
            id="crawler-toggle"
            checked={isEnabled}
            onCheckedChange={(checked) => toggleCrawler.mutate(checked)}
            disabled={toggleCrawler.isPending}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runCrawler.mutate()}
                disabled={runCrawler.isPending}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${runCrawler.isPending ? "animate-spin" : ""}`} />
                {runCrawler.isPending ? "Rastreando..." : "Rastrear ahora"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Buscar actuaciones manualmente
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {ramaJudicialUrl && (
          <Button
            variant="ghost"
            size="sm"
            asChild
          >
            <a href={ramaJudicialUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Ver en Rama Judicial
            </a>
          </Button>
        )}
      </div>

      {lastCrawledAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3 w-3" />
          Último rastreo: {formatDateColombia(lastCrawledAt)}
          {" a las "}
          {new Date(lastCrawledAt).toLocaleTimeString("es-CO", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )}

      {isEnabled && (
        <Badge variant="outline" className="text-xs">
          <Clock className="h-3 w-3 mr-1" />
          Se ejecuta automáticamente cada día
        </Badge>
      )}
    </div>
  );
}
