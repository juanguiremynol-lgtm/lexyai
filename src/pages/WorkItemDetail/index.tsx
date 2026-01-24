/**
 * WorkItemDetail - Canonical unified detail page for all work items
 * 
 * Route: /work-items/:id
 * 
 * This is the SINGLE SOURCE OF TRUTH for viewing any work item.
 * Legacy routes redirect here with optional tab preselection.
 */

import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, 
  AlertCircle, 
  Scale, 
  Send, 
  Gavel, 
  Building2, 
  Landmark,
  FileText,
  Clock,
  Calendar,
  Mail,
  Bell,
  Trash2,
  Flag,
  ExternalLink,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DeleteWorkItemDialog } from "@/components/shared/DeleteWorkItemDialog";
import { useDeleteWorkItems } from "@/hooks/use-delete-work-items";

import type { WorkItem } from "@/types/work-item";
import { WORKFLOW_TYPES, getStageLabel } from "@/lib/workflow-constants";

// Tab components
import { OverviewTab } from "./tabs/OverviewTab";
import { TimelineTab } from "./tabs/TimelineTab";
import { ActsTab } from "./tabs/ActsTab";
import { DocumentsTab } from "./tabs/DocumentsTab";
import { EmailsTab } from "./tabs/EmailsTab";
import { DeadlinesTab } from "./tabs/DeadlinesTab";
import { AlertsTasksTab } from "./tabs/AlertsTasksTab";

const WORKFLOW_ICONS = {
  CGP: Scale,
  PETICION: Send,
  TUTELA: Gavel,
  GOV_PROCEDURE: Building2,
  CPACA: Landmark,
};

const WORKFLOW_COLORS = {
  CGP: "text-emerald-500",
  PETICION: "text-blue-500",
  TUTELA: "text-purple-500",
  GOV_PROCEDURE: "text-orange-500",
  CPACA: "text-indigo-500",
};

type TabValue = "overview" | "timeline" | "acts" | "documents" | "emails" | "deadlines" | "alerts";

const TAB_CONFIG: { value: TabValue; label: string; icon: React.ReactNode }[] = [
  { value: "overview", label: "Resumen", icon: <FileText className="h-4 w-4" /> },
  { value: "timeline", label: "Línea de Tiempo", icon: <Clock className="h-4 w-4" /> },
  { value: "acts", label: "Actuaciones", icon: <Scale className="h-4 w-4" /> },
  { value: "documents", label: "Documentos", icon: <FileText className="h-4 w-4" /> },
  { value: "emails", label: "Correos", icon: <Mail className="h-4 w-4" /> },
  { value: "deadlines", label: "Términos", icon: <Calendar className="h-4 w-4" /> },
  { value: "alerts", label: "Alertas/Tareas", icon: <Bell className="h-4 w-4" /> },
];

export default function WorkItemDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // Get initial tab from URL or default to overview
  const initialTab = (searchParams.get("tab") as TabValue) || "overview";

  // Fetch work item with polymorphic resolution
  const { data: workItem, isLoading, error } = useQuery({
    queryKey: ["work-item-detail", id],
    queryFn: async () => {
      // 1. Try work_items table first
      const { data: workItemData, error: workItemError } = await supabase
        .from("work_items")
        .select(`
          *,
          clients(id, name),
          matters(id, matter_name)
        `)
        .eq("id", id!)
        .maybeSingle();
      
      if (workItemData) {
        return { ...workItemData, _source: "work_items" } as WorkItem & { _source: string };
      }
      
      // 2. Try legacy cgp_items table
      const { data: cgpData } = await supabase
        .from("cgp_items")
        .select(`
          *,
          client:clients(id, name),
          matter:matters(id, matter_name)
        `)
        .eq("id", id!)
        .maybeSingle();
      
      if (cgpData) {
        // Map to work_item structure
        return {
          id: cgpData.id,
          owner_id: cgpData.owner_id,
          workflow_type: "CGP",
          stage: cgpData.filing_status || cgpData.process_phase || "DRAFTED",
          status: cgpData.status || "ACTIVE",
          cgp_phase: cgpData.phase === "PROCESS" ? "PROCESS" : "FILING",
          cgp_phase_source: cgpData.phase_source,
          source: "MIGRATION",
          source_reference: null,
          source_payload: null,
          client_id: cgpData.client_id,
          matter_id: cgpData.matter_id,
          radicado: cgpData.radicado,
          radicado_verified: !!cgpData.radicado,
          authority_name: cgpData.court_name,
          authority_email: cgpData.court_email,
          authority_city: cgpData.court_city,
          authority_department: cgpData.court_department,
          demandantes: cgpData.demandantes,
          demandados: cgpData.demandados,
          title: null,
          description: cgpData.description,
          notes: cgpData.notes,
          auto_admisorio_date: cgpData.auto_admisorio_date,
          filing_date: cgpData.sent_at,
          last_action_date: null,
          last_action_description: null,
          is_flagged: false,
          monitoring_enabled: cgpData.monitoring_enabled,
          email_linking_enabled: cgpData.email_linking_enabled,
          expediente_url: cgpData.expediente_url,
          sharepoint_url: null,
          scrape_status: cgpData.scrape_status || "NOT_ATTEMPTED",
          last_checked_at: null,
          last_crawled_at: cgpData.last_crawled_at,
          scraped_fields: null,
          total_actuaciones: cgpData.total_actuaciones || 0,
          legacy_filing_id: cgpData.legacy_filing_id,
          legacy_process_id: cgpData.legacy_process_id,
          legacy_cgp_item_id: cgpData.id,
          legacy_peticion_id: null,
          legacy_cpaca_id: null,
          legacy_admin_process_id: null,
          created_at: cgpData.created_at,
          updated_at: cgpData.updated_at,
          clients: cgpData.client,
          matters: cgpData.matter,
          _source: "cgp_items",
        } as WorkItem & { _source: string };
      }
      
      // 3. Try legacy peticiones table
      const { data: peticionData } = await supabase
        .from("peticiones")
        .select("*, clients(id, name)")
        .eq("id", id!)
        .maybeSingle();
      
      if (peticionData) {
        return {
          id: peticionData.id,
          owner_id: peticionData.owner_id,
          workflow_type: "PETICION",
          stage: peticionData.phase || "PETICION_RADICADA",
          status: "ACTIVE",
          cgp_phase: null,
          cgp_phase_source: null,
          source: "MIGRATION",
          source_reference: null,
          source_payload: null,
          client_id: peticionData.client_id,
          matter_id: null,
          radicado: peticionData.radicado,
          radicado_verified: !!peticionData.radicado,
          authority_name: peticionData.entity_name,
          authority_email: peticionData.entity_email,
          authority_city: null,
          authority_department: null,
          demandantes: null,
          demandados: null,
          title: peticionData.subject,
          description: peticionData.description,
          notes: peticionData.notes,
          auto_admisorio_date: null,
          filing_date: peticionData.filed_at,
          last_action_date: null,
          last_action_description: null,
          is_flagged: false,
          monitoring_enabled: false,
          email_linking_enabled: false,
          expediente_url: null,
          sharepoint_url: null,
          scrape_status: "NOT_ATTEMPTED",
          last_checked_at: null,
          last_crawled_at: null,
          scraped_fields: null,
          total_actuaciones: 0,
          legacy_filing_id: null,
          legacy_process_id: null,
          legacy_cgp_item_id: null,
          legacy_peticion_id: peticionData.id,
          legacy_cpaca_id: null,
          legacy_admin_process_id: null,
          created_at: peticionData.created_at,
          updated_at: peticionData.updated_at,
          clients: peticionData.clients,
          matters: null,
          _source: "peticiones",
        } as WorkItem & { _source: string };
      }
      
      // 4. Try legacy monitored_processes table
      const { data: processData } = await supabase
        .from("monitored_processes")
        .select("*, clients(id, name)")
        .eq("id", id!)
        .maybeSingle();
      
      if (processData) {
        const isAdmin = processData.process_type === "ADMINISTRATIVE";
        return {
          id: processData.id,
          owner_id: processData.owner_id,
          workflow_type: isAdmin ? "GOV_PROCEDURE" : "CGP",
          stage: processData.admin_phase || processData.phase || "AUTO_ADMISORIO",
          status: processData.monitoring_enabled ? "ACTIVE" : "INACTIVE",
          cgp_phase: isAdmin ? null : "PROCESS",
          cgp_phase_source: null,
          source: "MIGRATION",
          source_reference: null,
          source_payload: null,
          client_id: processData.client_id,
          matter_id: null,
          radicado: processData.radicado,
          radicado_verified: processData.cpnu_confirmed,
          authority_name: processData.despacho_name || processData.autoridad,
          authority_email: processData.correo_autoridad,
          authority_city: processData.municipality,
          authority_department: processData.department,
          demandantes: processData.demandantes,
          demandados: processData.demandados,
          title: null,
          description: null,
          notes: processData.notes,
          auto_admisorio_date: null,
          filing_date: null,
          last_action_date: processData.last_action_date || null,
          last_action_description: null,
          is_flagged: false,
          monitoring_enabled: processData.monitoring_enabled,
          email_linking_enabled: false,
          expediente_url: null,
          sharepoint_url: null,
          scrape_status: processData.cpnu_confirmed ? "SUCCESS" : "NOT_ATTEMPTED",
          last_checked_at: processData.last_checked_at,
          last_crawled_at: processData.last_checked_at,
          scraped_fields: null,
          total_actuaciones: processData.total_actuaciones || 0,
          legacy_filing_id: null,
          legacy_process_id: processData.id,
          legacy_cgp_item_id: null,
          legacy_peticion_id: null,
          legacy_cpaca_id: null,
          legacy_admin_process_id: isAdmin ? processData.id : null,
          created_at: processData.created_at,
          updated_at: processData.updated_at,
          clients: processData.clients,
          matters: null,
          _source: "monitored_processes",
        } as WorkItem & { _source: string };
      }
      
      // 5. Try legacy cpaca_processes table
      const { data: cpacaData } = await supabase
        .from("cpaca_processes")
        .select("*, clients(id, name)")
        .eq("id", id!)
        .maybeSingle();
      
      if (cpacaData) {
        return {
          id: cpacaData.id,
          owner_id: cpacaData.owner_id,
          workflow_type: "CPACA",
          stage: cpacaData.phase || "PRECONTENCIOSO",
          status: "ACTIVE",
          cgp_phase: null,
          cgp_phase_source: null,
          source: "MIGRATION",
          source_reference: null,
          source_payload: null,
          client_id: cpacaData.client_id,
          matter_id: null,
          radicado: cpacaData.radicado,
          radicado_verified: !!cpacaData.radicado,
          authority_name: cpacaData.despacho_nombre || null,
          authority_email: cpacaData.despacho_email || null,
          authority_city: cpacaData.despacho_ciudad || null,
          authority_department: null,
          demandantes: cpacaData.demandantes,
          demandados: cpacaData.demandados,
          title: cpacaData.titulo || null,
          description: cpacaData.descripcion || null,
          notes: cpacaData.notas || null,
          auto_admisorio_date: cpacaData.fecha_auto_admisorio || null,
          filing_date: cpacaData.fecha_radicacion_demanda || null,
          last_action_date: null,
          last_action_description: null,
          is_flagged: cpacaData.is_flagged || false,
          monitoring_enabled: false,
          email_linking_enabled: false,
          expediente_url: null,
          sharepoint_url: null,
          scrape_status: "NOT_ATTEMPTED",
          last_checked_at: null,
          last_crawled_at: null,
          scraped_fields: null,
          total_actuaciones: 0,
          legacy_filing_id: null,
          legacy_process_id: null,
          legacy_cgp_item_id: null,
          legacy_peticion_id: null,
          legacy_cpaca_id: cpacaData.id,
          legacy_admin_process_id: null,
          created_at: cpacaData.created_at,
          updated_at: cpacaData.updated_at,
          clients: cpacaData.clients,
          matters: null,
          _source: "cpaca_processes",
        } as WorkItem & { _source: string };
      }
      
      // Not found in any table
      return null;
    },
    enabled: !!id,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!workItem) return;
      
      const source = (workItem as any)._source;
      let error;
      
      switch (source) {
        case "work_items":
          ({ error } = await supabase.from("work_items").delete().eq("id", id!));
          break;
        case "cgp_items":
          ({ error } = await supabase.from("cgp_items").delete().eq("id", id!));
          break;
        case "peticiones":
          ({ error } = await supabase.from("peticiones").delete().eq("id", id!));
          break;
        case "monitored_processes":
          ({ error } = await supabase.from("monitored_processes").delete().eq("id", id!));
          break;
        case "cpaca_processes":
          ({ error } = await supabase.from("cpaca_processes").delete().eq("id", id!));
          break;
      }
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Asunto eliminado");
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      navigate("/dashboard");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  // Toggle flag mutation
  const toggleFlagMutation = useMutation({
    mutationFn: async () => {
      if (!workItem) return;
      
      const source = (workItem as any)._source;
      const newFlagged = !workItem.is_flagged;
      let error;
      
      if (source === "work_items") {
        ({ error } = await supabase.from("work_items").update({ is_flagged: newFlagged }).eq("id", id!));
      } else if (source === "cpaca_processes") {
        ({ error } = await supabase.from("cpaca_processes").update({ is_flagged: newFlagged }).eq("id", id!));
      }
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", id] });
      toast.success(workItem?.is_flagged ? "Bandera removida" : "Marcado con bandera");
    },
  });

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">Error al cargar</h2>
        <p className="text-muted-foreground">
          No se pudo cargar el asunto. {(error as Error).message}
        </p>
        <Button onClick={() => navigate(-1)}>Volver</Button>
      </div>
    );
  }

  if (!workItem) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Asunto no encontrado</h2>
        <p className="text-muted-foreground">
          El asunto con ID {id} no existe o no tienes acceso.
        </p>
        <Button asChild>
          <Link to="/dashboard">Volver al inicio</Link>
        </Button>
      </div>
    );
  }

  const workflowConfig = WORKFLOW_TYPES[workItem.workflow_type];
  const WorkflowIcon = WORKFLOW_ICONS[workItem.workflow_type] || Scale;
  const workflowColor = WORKFLOW_COLORS[workItem.workflow_type] || "text-primary";
  const stageLabel = getStageLabel(workItem.workflow_type, workItem.stage, workItem.cgp_phase || undefined);
  const displayTitle = workItem.title || workItem.radicado || workflowConfig?.label || "Asunto";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <WorkflowIcon className={cn("h-6 w-6 flex-shrink-0", workflowColor)} />
            <h1 className="text-2xl font-serif font-bold truncate">{displayTitle}</h1>
            <Badge variant="secondary" className="flex-shrink-0">
              {workflowConfig?.shortLabel || workItem.workflow_type}
            </Badge>
            <Badge variant="outline" className="flex-shrink-0">
              {stageLabel}
            </Badge>
            {workItem.is_flagged && (
              <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30 flex-shrink-0">
                <Flag className="h-3 w-3 mr-1 fill-current" />
                Marcado
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-muted-foreground">
            {workItem.clients && (
              <span className="text-sm">{workItem.clients.name}</span>
            )}
            {workItem.authority_name && (
              <span className="text-sm truncate">{workItem.authority_name}</span>
            )}
            {workItem.radicado && workItem.title && (
              <span className="font-mono text-sm">{workItem.radicado}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {workItem.expediente_url && (
            <Button variant="outline" size="sm" asChild>
              <a href={workItem.expediente_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Expediente
              </a>
            </Button>
          )}
          
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              workItem.is_flagged && "text-amber-500"
            )}
            onClick={() => toggleFlagMutation.mutate()}
          >
            <Flag className={cn("h-4 w-4", workItem.is_flagged && "fill-current")} />
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar asunto?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción eliminará permanentemente este asunto y todos sus datos asociados.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={initialTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
          {TAB_CONFIG.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-2 whitespace-nowrap"
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="overview" className="mt-0">
            <OverviewTab workItem={workItem} />
          </TabsContent>
          
          <TabsContent value="timeline" className="mt-0">
            <TimelineTab workItem={workItem} />
          </TabsContent>
          
          <TabsContent value="acts" className="mt-0">
            <ActsTab workItem={workItem} />
          </TabsContent>
          
          <TabsContent value="documents" className="mt-0">
            <DocumentsTab workItem={workItem} />
          </TabsContent>
          
          <TabsContent value="emails" className="mt-0">
            <EmailsTab workItem={workItem} />
          </TabsContent>
          
          <TabsContent value="deadlines" className="mt-0">
            <DeadlinesTab workItem={workItem} />
          </TabsContent>
          
          <TabsContent value="alerts" className="mt-0">
            <AlertsTasksTab workItem={workItem} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
