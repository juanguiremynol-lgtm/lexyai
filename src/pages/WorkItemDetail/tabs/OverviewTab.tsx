/**
 * Overview Tab - Rich work item summary with Authority, Parties, Milestones, and Electronic File
 * Professional "lawyer cockpit" view for managing cases
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
  Link2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Copy,
  ExternalLink,
  Mail,
  CheckCircle2,
  Bot,
  Clock,
  Gavel,
  Target,
  Circle,
  Eye,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

import type { WorkItem } from "@/types/work-item";
import { WORKFLOW_TYPES, getStageLabel, getStagesForWorkflow, getStageOrderForWorkflow } from "@/lib/workflow-constants";
import { EntityClientLink } from "@/components/shared";
import { MilestonesChecklist, ElectronicFileCard } from "@/components/work-items";
import { cn } from "@/lib/utils";

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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  // Show milestones for judicial workflows
  const showMilestones = ["CGP", "CPACA", "TUTELA"].includes(workItem.workflow_type);
  // Show electronic file card for judicial workflows  
  const showElectronicFile = ["CGP", "CPACA", "TUTELA"].includes(workItem.workflow_type);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main content - 2 columns */}
      <div className="lg:col-span-2 space-y-6">
        {/* Client Link Card */}
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

        {/* Milestones Checklist (for CGP/CPACA/TUTELA) */}
        {showMilestones && (
          <MilestonesChecklist workItem={workItem} />
        )}

        {/* Electronic File Card (for CGP/CPACA/TUTELA) */}
        {showElectronicFile && (
          <ElectronicFileCard workItem={workItem} />
        )}
        {/* Authority Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {workItem.workflow_type === "PETICION" ? "Entidad" : "Juzgado / Autoridad"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="col-span-2">
                <p className="text-sm text-muted-foreground">Nombre</p>
                <p className="font-medium">{workItem.authority_name || "Sin especificar"}</p>
              </div>

              {workItem.authority_email && (
                <div className="col-span-2 flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a 
                    href={`mailto:${workItem.authority_email}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {workItem.authority_email}
                  </a>
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

            {/* Radicado with copy */}
            {workItem.radicado && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Radicado</p>
                    <code className="font-mono font-medium text-lg">{workItem.radicado}</code>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => copyToClipboard(workItem.radicado!)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}

            {/* Expediente URL */}
            {workItem.expediente_url && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Expediente Electrónico</span>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a href={workItem.expediente_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Abrir
                    </a>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Parties Card - for CGP, CPACA, Tutela */}
        {(workItem.demandantes || workItem.demandados) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Partes del Proceso
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300">
                      {workItem.workflow_type === "TUTELA" ? "Accionante" : "Demandante"}
                    </Badge>
                  </div>
                  <p className="text-sm">{workItem.demandantes || "Sin especificar"}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300">
                      {workItem.workflow_type === "TUTELA" ? "Accionado" : "Demandado"}
                    </Badge>
                  </div>
                  <p className="text-sm">{workItem.demandados || "Sin especificar"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Case Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Información del Caso
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Description */}
            {workItem.description && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Descripción</p>
                <p className="text-sm">{workItem.description}</p>
              </div>
            )}

            {/* Notes */}
            {workItem.notes && (
              <>
                {workItem.description && <Separator />}
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Notas</p>
                  <p className="text-sm">{workItem.notes}</p>
                </div>
              </>
            )}

            {!workItem.description && !workItem.notes && (
              <p className="text-sm text-muted-foreground italic">
                Sin descripción ni notas registradas
              </p>
            )}
          </CardContent>
        </Card>

        {/* Monitoring Settings - for CGP, CPACA */}
        {(workItem.workflow_type === "CGP" || workItem.workflow_type === "CPACA") && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Rastreador Rama Judicial
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
                  disabled={toggleMonitoringMutation.isPending || !workItem.radicado}
                />
              </div>

              {!workItem.radicado && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  ⚠️ Ingrese el número de radicado para habilitar el monitoreo automático
                </p>
              )}

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

              {workItem.monitoring_enabled && (
                <Badge variant="outline" className="text-xs">
                  <Clock className="h-3 w-3 mr-1" />
                  Se ejecuta automáticamente cada día
                </Badge>
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
              <p className="text-sm text-muted-foreground">Creado en ATENIA</p>
              <p className="font-medium">{formatDate(workItem.created_at)}</p>
            </div>

            {workItem.updated_at && workItem.updated_at !== workItem.created_at && (
              <div>
                <p className="text-sm text-muted-foreground">Última Actualización</p>
                <p className="font-medium">{formatDate(workItem.updated_at)}</p>
              </div>
            )}
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
            {workItem.monitoring_enabled && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Monitoreo</span>
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30">
                  <Eye className="h-3 w-3 mr-1" />
                  Activo
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
