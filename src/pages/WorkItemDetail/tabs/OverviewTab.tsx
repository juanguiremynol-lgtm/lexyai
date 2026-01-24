/**
 * Overview Tab - Shows work item summary information
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Building2, 
  MapPin, 
  Users, 
  Calendar, 
  FileText, 
  Activity,
  Eye,
  Link2,
  RefreshCw,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

import type { WorkItem } from "@/types/work-item";
import { WORKFLOW_TYPES, getStageLabel, getStagesForWorkflow, getStageOrderForWorkflow } from "@/lib/workflow-constants";
import { EntityClientLink, SharepointHub } from "@/components/shared";

interface OverviewTabProps {
  workItem: WorkItem & { _source?: string };
}

export function OverviewTab({ workItem }: OverviewTabProps) {
  const queryClient = useQueryClient();
  
  const workflowConfig = WORKFLOW_TYPES[workItem.workflow_type];
  const stageOrder = getStageOrderForWorkflow(workItem.workflow_type, workItem.cgp_phase || undefined);
  const stages = getStagesForWorkflow(workItem.workflow_type, workItem.cgp_phase || undefined);
  const currentStageIndex = stageOrder.indexOf(workItem.stage);

  // Toggle monitoring mutation
  const toggleMonitoringMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const source = workItem._source;
      let error;
      
      if (source === "work_items") {
        ({ error } = await supabase.from("work_items").update({ monitoring_enabled: enabled }).eq("id", workItem.id));
      } else if (source === "cgp_items") {
        ({ error } = await supabase.from("cgp_items").update({ monitoring_enabled: enabled }).eq("id", workItem.id));
      } else if (source === "monitored_processes") {
        ({ error } = await supabase.from("monitored_processes").update({ monitoring_enabled: enabled }).eq("id", workItem.id));
      }
      
      if (error) throw error;
    },
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      toast.success(enabled ? "Monitoreo activado" : "Monitoreo desactivado");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "No especificada";
    return format(new Date(dateStr), "d 'de' MMMM, yyyy", { locale: es });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main content - 2 columns */}
      <div className="lg:col-span-2 space-y-6">
        {/* Client Link */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <Label className="text-sm font-medium">Cliente:</Label>
              <EntityClientLink
                entityType="cgp_item"
                entityId={workItem.id}
                entityLabel={workItem.title || workItem.radicado || "Asunto"}
                currentClientId={workItem.client_id || undefined}
                currentClientName={workItem.clients?.name}
                onLinked={() => queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Case Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Información del Caso
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {workItem.radicado && (
                <div>
                  <p className="text-sm text-muted-foreground">Radicado</p>
                  <p className="font-mono font-medium">{workItem.radicado}</p>
                </div>
              )}
              
              {workItem.authority_name && (
                <div>
                  <p className="text-sm text-muted-foreground">
                    {workItem.workflow_type === "CGP" || workItem.workflow_type === "CPACA" 
                      ? "Juzgado/Tribunal" 
                      : workItem.workflow_type === "PETICION" 
                        ? "Entidad" 
                        : "Autoridad"}
                  </p>
                  <p className="font-medium">{workItem.authority_name}</p>
                </div>
              )}

              {(workItem.authority_city || workItem.authority_department) && (
                <div className="col-span-2 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {[workItem.authority_city, workItem.authority_department].filter(Boolean).join(", ")}
                  </span>
                </div>
              )}
            </div>

            {/* Parties - for CGP, CPACA, Tutela */}
            {(workItem.demandantes || workItem.demandados) && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="font-medium flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Partes
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    {workItem.demandantes && (
                      <div>
                        <p className="text-sm text-muted-foreground">Demandante(s)</p>
                        <p>{workItem.demandantes}</p>
                      </div>
                    )}
                    {workItem.demandados && (
                      <div>
                        <p className="text-sm text-muted-foreground">Demandado(s)</p>
                        <p>{workItem.demandados}</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Description */}
            {workItem.description && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Descripción</p>
                  <p className="text-sm">{workItem.description}</p>
                </div>
              </>
            )}

            {/* Notes */}
            {workItem.notes && (
              <>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Notas</p>
                  <p className="text-sm">{workItem.notes}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Monitoring Settings */}
        {(workItem.workflow_type === "CGP" || workItem.workflow_type === "CPACA") && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Monitoreo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>Monitoreo Automático</Label>
                  <p className="text-sm text-muted-foreground">
                    Consultar automáticamente la Rama Judicial para nuevas actuaciones
                  </p>
                </div>
                <Switch
                  checked={workItem.monitoring_enabled}
                  onCheckedChange={(checked) => toggleMonitoringMutation.mutate(checked)}
                  disabled={toggleMonitoringMutation.isPending}
                />
              </div>

              {workItem.last_crawled_at && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4" />
                  Última consulta: {formatDistanceToNow(new Date(workItem.last_crawled_at), { addSuffix: true, locale: es })}
                </div>
              )}

              {workItem.scrape_status && (
                <div className="flex items-center gap-2">
                  {workItem.scrape_status === "SUCCESS" ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : workItem.scrape_status === "FAILED" ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm">
                    {workItem.scrape_status === "SUCCESS" 
                      ? "Sincronizado correctamente" 
                      : workItem.scrape_status === "FAILED" 
                        ? "Error en última sincronización"
                        : workItem.scrape_status === "IN_PROGRESS"
                          ? "Sincronizando..."
                          : "Pendiente"}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Sidebar - 1 column */}
      <div className="space-y-6">
        {/* Stage Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Progreso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stageOrder.map((stageKey, index) => {
              const isCurrentStage = workItem.stage === stageKey;
              const isPastStage = index < currentStageIndex;
              const stageConfig = stages[stageKey];

              return (
                <div
                  key={stageKey}
                  className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                    isCurrentStage
                      ? "bg-primary/10 border border-primary/30"
                      : isPastStage
                        ? "bg-muted/50"
                        : ""
                  }`}
                >
                  <div className={`${isCurrentStage ? "text-primary" : isPastStage ? "text-green-600" : "text-muted-foreground"}`}>
                    {isPastStage ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <div className={`w-4 h-4 rounded-full border-2 ${isCurrentStage ? "border-primary bg-primary/20" : "border-muted-foreground/30"}`} />
                    )}
                  </div>
                  <span className={`text-sm ${isCurrentStage ? "font-medium text-primary" : ""}`}>
                    {stageConfig?.label || stageKey}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Key Dates */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Fechas Clave
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {workItem.filing_date && (
              <div>
                <p className="text-sm text-muted-foreground">Fecha de Radicación</p>
                <p className="font-medium">{formatDate(workItem.filing_date)}</p>
              </div>
            )}
            
            {workItem.auto_admisorio_date && (
              <div>
                <p className="text-sm text-muted-foreground">Auto Admisorio</p>
                <p className="font-medium">{formatDate(workItem.auto_admisorio_date)}</p>
              </div>
            )}

            {workItem.last_action_date && (
              <div>
                <p className="text-sm text-muted-foreground">Última Actuación</p>
                <p className="font-medium">{formatDate(workItem.last_action_date)}</p>
              </div>
            )}

            <div>
              <p className="text-sm text-muted-foreground">Creado</p>
              <p className="font-medium">{formatDate(workItem.created_at)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Estadísticas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Actuaciones</span>
              <Badge variant="secondary">{workItem.total_actuaciones || 0}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Estado</span>
              <Badge variant={workItem.status === "ACTIVE" ? "default" : "secondary"}>
                {workItem.status === "ACTIVE" ? "Activo" : workItem.status === "CLOSED" ? "Cerrado" : "Inactivo"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
