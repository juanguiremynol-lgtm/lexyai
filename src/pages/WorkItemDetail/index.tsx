/**
 * WorkItemDetail - Unified detail page for all work items
 * 
 * Features:
 * - Overview with case setup checklist
 * - Electronic file button (OneDrive/SharePoint)
 * - Tabbed interface: Actuaciones, Estados, Notas
 * - Works with canonical work_items table
 */

import { useParams, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Loader2, ArrowLeft, ExternalLink, FileText, Calendar, AlertTriangle, CheckCircle, Clock, Scale, StickyNote, Newspaper, Flag, FlagOff, Bell, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkItemDetail } from "@/hooks/use-work-item-detail";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Import tab components
import { ActsTab } from "./tabs/ActsTab";
import { EstadosTab } from "./tabs/EstadosTab";
import { NotesTab } from "./tabs/NotesTab";
import { AlertsTasksTab } from "./tabs/AlertsTasksTab";

// Import work item components
import { MilestonesChecklist } from "@/components/work-items/MilestonesChecklist";
import { ElectronicFileButton } from "@/components/work-items/ElectronicFileButton";
import { WorkItemMonitoringBadge } from "@/components/work-items/WorkItemMonitoringBadge";
import { WorkItemMonitoringControls } from "@/components/work-items/WorkItemMonitoringControls";
import { AteniaAssistantDrawer } from "@/components/atenia/AteniaAssistantDrawer";
import { AddRadicadoInline } from "@/components/work-items/AddRadicadoInline";
import { CourthouseEmailDisplay } from "@/components/work-items/CourthouseEmailDisplay";
import { RadicadoAnalyzer } from "@/components/work-items/RadicadoAnalyzer";
import { WorkItemMonitoringToggle } from "@/components/work-items/WorkItemMonitoringToggle";

import type { WorkItem } from "@/types/work-item";

export default function WorkItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const {
    workItem,
    isLoading,
    error,
    actuaciones,
    refetch,
  } = useWorkItemDetail(id);

  // Assistant drawer state
  const [assistantOpen, setAssistantOpen] = useState(false);

  // Toggle flag mutation
  const toggleFlagMutation = useMutation({
    mutationFn: async () => {
      if (!workItem) return;
      const { error } = await supabase
        .from("work_items")
        .update({ 
          is_flagged: !workItem.is_flagged,
          updated_at: new Date().toISOString() 
        })
        .eq("id", workItem.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(workItem?.is_flagged ? "Desmarcado" : "Marcado como prioritario");
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", id] });
    },
    onError: () => {
      toast.error("Error al actualizar");
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !workItem) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">No se encontró el item de trabajo</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
      </div>
    );
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "d MMM yyyy", { locale: es });
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      ACTIVE: "default",
      CLOSED: "secondary",
      ARCHIVED: "outline",
    };
    return <Badge variant={variants[status] || "default"}>{status}</Badge>;
  };

  // Extended workItem type for new fields
  const extendedWorkItem = workItem as unknown as WorkItem & { 
    _source?: string;
    onedrive_url?: string | null;
    acta_radicacion_url?: string | null;
    auto_admisorio_url?: string | null;
  };

  // Count publicaciones from cache (if available) or default to showing "—"
  const publicacionesCount = "—"; // Will be loaded by EstadosTab

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-semibold">
              {workItem.title || workItem.radicado || "Sin radicado"}
            </h1>
            {getStatusBadge(workItem.status)}
            {workItem.is_flagged && (
              <Badge variant="destructive" className="gap-1">
                <Flag className="h-3 w-3" />
                Prioritario
              </Badge>
            )}
            <WorkItemMonitoringBadge workItem={extendedWorkItem} onUpdate={refetch} />
          </div>
          <div className="ml-10 space-y-1">
            <p className="text-muted-foreground">
              {workItem.workflow_type} • {workItem.stage}
              {workItem.last_synced_at && (
                <span className="text-xs ml-3">
                  Última sync: {formatDistanceToNow(new Date(workItem.last_synced_at), { addSuffix: true, locale: es })}
                </span>
              )}
            </p>
            {workItem.radicado && workItem.title && (
              <p className="text-sm text-muted-foreground font-mono">
                Rad: {workItem.radicado}
              </p>
            )}

            {/* TUTELA-specific: Corte Constitucional info */}
            {workItem.workflow_type === 'TUTELA' && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
                {(workItem as any).ponente && (
                  <span>Magistrado Ponente: <span className="font-medium text-foreground">{(workItem as any).ponente}</span></span>
                )}
                {workItem.corte_status && (
                  <span className="flex items-center gap-1">
                    Corte: 
                    <Badge variant={workItem.corte_status === 'SELECCIONADA' ? 'default' : 'secondary'} className="text-xs ml-1">
                      {workItem.corte_status === 'SELECCIONADA' ? '🟢 Seleccionada' :
                       workItem.corte_status === 'NO_SELECCIONADA' ? '🔴 No seleccionada' :
                       workItem.corte_status === 'SENTENCIA_EMITIDA' ? '⚖️ Sentencia emitida' :
                       workItem.corte_status}
                    </Badge>
                  </span>
                )}
                {workItem.sentencia_ref && (
                  <span>Sentencia: <span className="font-medium text-foreground">{workItem.sentencia_ref}</span></span>
                )}
              </div>
            )}

            {/* Provider sources row */}
            {workItem.workflow_type === 'TUTELA' && workItem.provider_sources && (
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground">Fuentes:</span>
                {(() => {
                  const sources = workItem.provider_sources as Record<string, { found?: boolean; actuaciones_count?: number; publicaciones_count?: number }>;
                  return Object.entries(sources).map(([key, val]) => (
                    <Badge key={key} variant="outline" className={`text-xs ${val?.found ? 'border-emerald-500/50 text-emerald-600' : 'border-muted text-muted-foreground'}`}>
                      {val?.found ? '✅' : '❌'} {key.toUpperCase()}
                      {val?.found && val?.actuaciones_count ? ` (${val.actuaciones_count})` : ''}
                      {val?.found && val?.publicaciones_count ? ` (${val.publicaciones_count} est.)` : ''}
                    </Badge>
                  ));
                })()}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {/* Flag button */}
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => toggleFlagMutation.mutate()}
            disabled={toggleFlagMutation.isPending}
            title={workItem.is_flagged ? "Quitar prioridad" : "Marcar como prioritario"}
          >
            {workItem.is_flagged ? (
              <FlagOff className="h-4 w-4" />
            ) : (
              <Flag className="h-4 w-4" />
            )}
          </Button>
          
          {/* Atenia AI — Unified assistant + report */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setAssistantOpen(true)}
          >
            <Bot className="h-4 w-4" />
            Atenia AI
          </Button>

          {/* Electronic File Button - single source of truth for expediente link */}
          <ElectronicFileButton workItem={extendedWorkItem} />
        </div>
      </div>

      {/* Milestones Checklist - replaces legacy CaseSetupChecklist */}
      <MilestonesChecklist workItem={extendedWorkItem} />

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Tabs */}
        <div className="lg:col-span-2 space-y-6">
          {/* Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>Información General</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Radicado</p>
                <AddRadicadoInline
                  workItemId={workItem.id}
                  currentRadicado={workItem.radicado}
                  onUpdate={refetch}
                />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Autoridad</p>
                <p className="font-medium">{workItem.authority_name || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Ciudad</p>
                <p className="font-medium">{workItem.authority_city || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Departamento</p>
                <p className="font-medium">{workItem.authority_department || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Demandantes</p>
                <p className="font-medium">{workItem.demandantes || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Demandados</p>
                <p className="font-medium">{workItem.demandados || "—"}</p>
              </div>
              {workItem.clients && (
                <div>
                  <p className="text-sm text-muted-foreground">Cliente</p>
                  <p className="font-medium">{workItem.clients.name}</p>
                </div>
              )}
              {workItem.matters && (
                <div>
                  <p className="text-sm text-muted-foreground">Asunto</p>
                  <p className="font-medium">{workItem.matters.matter_name}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Radicado Analysis */}
          {workItem.radicado && (
            <RadicadoAnalyzer radicado={workItem.radicado} />
          )}

          {/* Courthouse Email Resolution */}
          <CourthouseEmailDisplay workItem={extendedWorkItem as any} />

          {/* Tabs for Actuaciones, Estados, Notas */}
          <Tabs defaultValue="actuaciones" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="actuaciones" className="gap-2">
                <Scale className="h-4 w-4" />
                Actuaciones
                <Badge variant="secondary" className="ml-1 text-xs">
                  {actuaciones.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="estados" className="gap-2">
                <Newspaper className="h-4 w-4" />
                Estados
              </TabsTrigger>
              <TabsTrigger value="alertas" className="gap-2">
                <Bell className="h-4 w-4" />
                Alertas
              </TabsTrigger>
              <TabsTrigger value="notas" className="gap-2">
                <StickyNote className="h-4 w-4" />
                Notas
              </TabsTrigger>
            </TabsList>

            <TabsContent value="actuaciones" className="mt-4">
              <ActsTab workItem={extendedWorkItem} />
            </TabsContent>

            <TabsContent value="estados" className="mt-4">
              <EstadosTab workItem={extendedWorkItem} />
            </TabsContent>

            <TabsContent value="alertas" className="mt-4">
              <AlertsTasksTab workItem={extendedWorkItem} />
            </TabsContent>

            <TabsContent value="notas" className="mt-4">
              <NotesTab workItem={extendedWorkItem} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column - Key Dates & Quick Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Fechas Clave
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Creado</p>
                <p className="font-medium">{formatDate(workItem.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Última actualización</p>
                <p className="font-medium">{formatDate(workItem.updated_at)}</p>
              </div>
              {workItem.filing_date && (
                <div>
                  <p className="text-sm text-muted-foreground">Fecha de radicación</p>
                  <p className="font-medium">{formatDate(workItem.filing_date)}</p>
                </div>
              )}
              {workItem.auto_admisorio_date && (
                <div>
                  <p className="text-sm text-muted-foreground">Auto admisorio</p>
                  <p className="font-medium">{formatDate(workItem.auto_admisorio_date)}</p>
                </div>
              )}
              {workItem.last_action_date && (
                <div>
                  <p className="text-sm text-muted-foreground">Última actuación</p>
                  <p className="font-medium">{formatDate(workItem.last_action_date)}</p>
                </div>
              )}
              {workItem.last_checked_at && (
                <div>
                  <p className="text-sm text-muted-foreground">Última revisión</p>
                  <p className="font-medium">{formatDate(workItem.last_checked_at)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Description if present */}
          {workItem.description && (
            <Card>
              <CardHeader>
                <CardTitle>Descripción</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{workItem.description}</p>
              </CardContent>
            </Card>
          )}

          {/* Sync Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Estado de Sincronización</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estado scrape:</span>
                <Badge variant="outline" className="text-xs">
                  {workItem.scrape_status || "NOT_ATTEMPTED"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total actuaciones:</span>
                <span className="font-medium">{workItem.total_actuaciones || 0}</span>
              </div>
              {workItem.last_crawled_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Última sync:</span>
                  <span className="text-xs">
                    {formatDistanceToNow(new Date(workItem.last_crawled_at), { addSuffix: true, locale: es })}
                  </span>
                </div>
              )}
              <p className="text-xs text-muted-foreground pt-2 border-t">
                Los datos se sincronizan automáticamente al iniciar sesión y cada día a las 7:00 AM.
              </p>
            </CardContent>
          </Card>

          {/* Monitoring Status & Controls */}
          <WorkItemMonitoringControls
            workItem={{
              id: workItem.id,
              radicado: workItem.radicado || undefined,
              monitoring_enabled: workItem.monitoring_enabled,
              monitoring_suspended_at: (workItem as any).monitoring_suspended_at || null,
              monitoring_suspended_reason: (workItem as any).monitoring_suspended_reason || null,
              consecutive_failures: (workItem as any).consecutive_failures || 0,
              consecutive_not_found: (workItem as any).consecutive_not_found || 0,
              last_error_code: (workItem as any).last_error_code || null,
              last_attempted_sync_at: (workItem as any).last_attempted_sync_at || null,
            }}
            onUpdate={refetch}
          />
        </div>
      </div>

      {/* Atenia AI Assistant Drawer */}
      <AteniaAssistantDrawer
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        scope="WORK_ITEM"
        workItemId={workItem.id}
        workItemRadicado={workItem.radicado || undefined}
      />
    </div>
  );
}
