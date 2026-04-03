/**
 * Overview Tab - Rich work item summary with Authority, Parties, Milestones, and Electronic File
 * Professional "lawyer cockpit" view for managing cases
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { syncCpnuPausar, syncCpnuReactivar } from "@/lib/services/cpnu-sync-service";
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
  Scale,
  FolderOpen,
  UserCircle,
  Layers,
  Info,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

import type { WorkItem } from "@/types/work-item";
import { WORKFLOW_TYPES, getStageLabel, getStagesForWorkflow, getStageOrderForWorkflow } from "@/lib/workflow-constants";
import { EntityClientLink } from "@/components/shared";
import { MilestonesChecklist } from "@/components/work-items";
import { cn } from "@/lib/utils";

// Extended WorkItem type with SAMAI fields
interface ExtendedWorkItem extends WorkItem {
  origen?: string | null;
  ponente?: string | null;
  clase_proceso?: string | null;
  etapa?: string | null;
  ubicacion_expediente?: string | null;
  formato_expediente?: string | null;
  tipo_proceso?: string | null;
  subclase_proceso?: string | null;
  tipo_recurso?: string | null;
  naturaleza_proceso?: string | null;
  asunto?: string | null;
  medida_cautelar?: string | null;
  ministerio_publico?: string | null;
  fecha_radicado?: string | null;
  fecha_presenta_demanda?: string | null;
  fecha_para_sentencia?: string | null;
  fecha_sentencia?: string | null;
  total_sujetos_procesales?: number | null;
  // New SAMAI metadata fields
  samai_guid?: string | null;
  samai_consultado_en?: string | null;
  samai_veces_en_corporacion?: number | null;
  samai_sala_conoce?: string | null;
  samai_sala_decide?: string | null;
  samai_fuente?: string | null;
}

interface OverviewTabProps {
  workItem: ExtendedWorkItem & { _source?: string };
}

// Helper to check if CPACA metadata exists
function hasCpacaMetadata(workItem: ExtendedWorkItem): boolean {
  return !!(
    workItem.ponente ||
    workItem.origen ||
    workItem.clase_proceso ||
    workItem.etapa ||
    workItem.ubicacion_expediente ||
    workItem.formato_expediente ||
    workItem.tipo_proceso ||
    workItem.subclase_proceso ||
    workItem.tipo_recurso ||
    workItem.naturaleza_proceso ||
    workItem.asunto ||
    workItem.medida_cautelar ||
    workItem.ministerio_publico ||
    workItem.fecha_radicado ||
    workItem.fecha_presenta_demanda ||
    workItem.fecha_para_sentencia ||
    workItem.fecha_sentencia
  );
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
      // All items now update work_items directly
      const { error: updateError } = await supabase
        .from("work_items")
        .update({ monitoring_enabled: enabled })
        .eq("id", workItem.id);
      
      if (updateError) throw updateError;
    },
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      toast.success(enabled ? "Monitoreo activado" : "Monitoreo desactivado");
      if (workItem.workflow_type === "CGP") {
        if (enabled) {
          void syncCpnuReactivar(workItem.id).catch(console.warn);
        } else {
          void syncCpnuPausar(workItem.id, "Desactivado desde overview").catch(console.warn);
        }
      }
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

  // Show milestones for judicial workflows (LABORAL included per requirement D)
  const showMilestones = ["CGP", "CPACA", "TUTELA", "LABORAL"].includes(workItem.workflow_type);

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



        {/* CPACA Process Metadata Card (from SAMAI) */}
        {workItem.workflow_type === "CPACA" && hasCpacaMetadata(workItem) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5" />
                Información del Proceso (SAMAI)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Row 1: Ponente & Origen */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {workItem.ponente && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <UserCircle className="h-4 w-4" />
                      <span>Ponente</span>
                    </div>
                    <p className="font-medium text-sm">{workItem.ponente}</p>
                  </div>
                )}
                {workItem.origen && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                      <span>Origen</span>
                    </div>
                    <p className="font-medium text-sm">{workItem.origen}</p>
                  </div>
                )}
              </div>

              {/* Row 2: Clasificación del Proceso */}
              {(workItem.clase_proceso || workItem.tipo_proceso || workItem.subclase_proceso) && (
                <>
                  <Separator />
                  <div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                      <Layers className="h-4 w-4" />
                      <span>Clasificación del Proceso</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {workItem.tipo_proceso && (
                        <Badge variant="outline" className="bg-primary/10">
                          {workItem.tipo_proceso}
                        </Badge>
                      )}
                      {workItem.clase_proceso && (
                        <Badge variant="secondary">
                          {workItem.clase_proceso}
                        </Badge>
                      )}
                      {workItem.subclase_proceso && workItem.subclase_proceso !== "SIN SUBCLASE DE PROCESO" && (
                        <Badge variant="outline">
                          {workItem.subclase_proceso}
                        </Badge>
                      )}
                      {workItem.tipo_recurso && workItem.tipo_recurso !== "SIN TIPO DE RECURSO" && (
                        <Badge variant="outline">
                          Recurso: {workItem.tipo_recurso}
                        </Badge>
                      )}
                      {workItem.naturaleza_proceso && workItem.naturaleza_proceso !== "SIN NATURALEZA" && (
                        <Badge variant="outline">
                          {workItem.naturaleza_proceso}
                        </Badge>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Row 3: Etapa, Ubicación, Formato */}
              {(workItem.etapa || workItem.ubicacion_expediente || workItem.formato_expediente) && (
                <>
                  <Separator />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {workItem.etapa && (
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Etapa Procesal</p>
                        <Badge variant="default">{workItem.etapa}</Badge>
                      </div>
                    )}
                    {workItem.ubicacion_expediente && (
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Ubicación</p>
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{workItem.ubicacion_expediente}</span>
                        </div>
                      </div>
                    )}
                    {workItem.formato_expediente && (
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">Formato Expediente</p>
                        <span className="text-sm font-medium">{workItem.formato_expediente}</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Row 4: Asunto */}
              {workItem.asunto && (
                <>
                  <Separator />
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Asunto</p>
                    <p className="text-sm">{workItem.asunto}</p>
                  </div>
                </>
              )}

              {/* Row 5: Medida Cautelar */}
              {workItem.medida_cautelar && (
                <>
                  <Separator />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Info className="h-4 w-4 text-amber-500" />
                      <p className="text-sm text-muted-foreground">Medida Cautelar</p>
                    </div>
                    <p className="text-sm font-medium">{workItem.medida_cautelar}</p>
                  </div>
                </>
              )}

              {/* Row 6: Ministerio Público */}
              {workItem.ministerio_publico && (
                <>
                  <Separator />
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Ministerio Público</p>
                    <p className="text-sm font-medium">{workItem.ministerio_publico}</p>
                  </div>
                </>
              )}

              {/* Row 7: Fechas Importantes */}
              {(workItem.fecha_radicado || workItem.fecha_presenta_demanda || workItem.fecha_para_sentencia || workItem.fecha_sentencia) && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Fechas del Proceso</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {workItem.fecha_radicado && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Radicado</p>
                          <p className="text-sm font-medium">{formatDate(workItem.fecha_radicado)}</p>
                        </div>
                      )}
                      {workItem.fecha_presenta_demanda && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Presenta Demanda</p>
                          <p className="text-sm font-medium">{formatDate(workItem.fecha_presenta_demanda)}</p>
                        </div>
                      )}
                      {workItem.fecha_para_sentencia && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Para Sentencia</p>
                          <p className="text-sm font-medium">{formatDate(workItem.fecha_para_sentencia)}</p>
                        </div>
                      )}
                      {workItem.fecha_sentencia && workItem.fecha_sentencia !== "SIN SENTENCIA" && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Sentencia</p>
                          <p className="text-sm font-medium">{workItem.fecha_sentencia}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Salas Information */}
              {(workItem.samai_sala_conoce || workItem.samai_sala_decide || workItem.samai_veces_en_corporacion) && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Información de Salas</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {workItem.samai_sala_conoce && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Sala que Conoce</p>
                          <p className="text-sm font-medium">{workItem.samai_sala_conoce}</p>
                        </div>
                      )}
                      {workItem.samai_sala_decide && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Estado Sala</p>
                          <Badge variant="outline">{workItem.samai_sala_decide}</Badge>
                        </div>
                      )}
                      {workItem.samai_veces_en_corporacion != null && workItem.samai_veces_en_corporacion > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Veces en Corporación</p>
                          <Badge variant="secondary">{workItem.samai_veces_en_corporacion}</Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Total Sujetos Procesales */}
              {workItem.total_sujetos_procesales != null && workItem.total_sujetos_procesales > 0 && (
                <>
                  <Separator />
                  <div className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Total Sujetos Procesales:</span>
                    <Badge variant="secondary">{workItem.total_sujetos_procesales}</Badge>
                  </div>
                </>
              )}

              {/* SAMAI Meta Information (guid, consultado_en, fuente) */}
              {(workItem.samai_guid || workItem.samai_consultado_en || workItem.samai_fuente) && (
                <>
                  <Separator />
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex flex-wrap gap-4">
                      {workItem.samai_fuente && (
                        <span>Fuente: <Badge variant="outline" className="text-xs">{workItem.samai_fuente}</Badge></span>
                      )}
                      {workItem.samai_consultado_en && (
                        <span>
                          Consultado: {format(new Date(workItem.samai_consultado_en), "d MMM yyyy, HH:mm", { locale: es })}
                        </span>
                      )}
                    </div>
                    {workItem.samai_guid && (
                      <p className="font-mono text-xs opacity-60">GUID: {workItem.samai_guid}</p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
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
        {(workItem.demandantes || workItem.demandados || workItem.ministerio_publico) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Partes del Proceso
                </div>
                {workItem.total_sujetos_procesales != null && workItem.total_sujetos_procesales > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {workItem.total_sujetos_procesales} sujetos
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Demandante / Accionante */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                      {workItem.workflow_type === "TUTELA" ? "Accionante" : "Demandante"}
                    </Badge>
                  </div>
                  <p className="text-sm">{workItem.demandantes || "Sin especificar"}</p>
                </div>
                
                {/* Demandado / Accionado */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                      {workItem.workflow_type === "TUTELA" ? "Accionado" : "Demandado"}
                    </Badge>
                  </div>
                  <p className="text-sm">{workItem.demandados || "Sin especificar"}</p>
                </div>
              </div>
              
              {/* Ministerio Público - shown for CPACA */}
              {workItem.ministerio_publico && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400">
                        Ministerio Público
                      </Badge>
                    </div>
                    <p className="text-sm">{workItem.ministerio_publico}</p>
                  </div>
                </>
              )}
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
