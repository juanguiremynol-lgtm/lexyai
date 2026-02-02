/**
 * WorkItemDetail - Canonical unified detail page for all work items
 * 
 * Route: /work-items/:id
 * 
 * This is the SINGLE SOURCE OF TRUTH for viewing any work item.
 * Legacy routes redirect here with optional tab preselection.
 * 
 * Features:
 * - Rich detail view with milestones checklist
 * - Electronic file (OneDrive) link management
 * - Estados/Actuaciones tab (CGP, CPACA, TUTELA only)
 * - Workflow-specific content adaptation
 */

import { useState } from "react";
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
  Bell,
  Trash2,
  Flag,
  ExternalLink,
  Users,
  Activity,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DeleteWorkItemDialog } from "@/components/shared/DeleteWorkItemDialog";
import { ClientRequiredBadge } from "@/components/shared/ClientRequiredBadge";
// REMOVED: SyncWorkItemButton - sync happens automatically on login and via daily cron
// import { SyncWorkItemButton } from "@/components/work-items/SyncWorkItemButton";
// REMOVED: SyncDebugDrawer - keeping for platform admin use only
// import { SyncDebugDrawer } from "@/components/work-items/SyncDebugDrawer";
import { StageSuggestionBannerDB } from "@/components/work-items/StageSuggestionBannerDB";
import { ScrapingStatusBanner } from "@/components/work-items/ScrapingStatusBanner";
import { useDeleteWorkItems } from "@/hooks/use-delete-work-items";

import type { WorkItem } from "@/types/work-item";
import { WORKFLOW_TYPES, getStageLabel } from "@/lib/workflow-constants";

// Tab components
import { OverviewTab } from "./tabs/OverviewTab";
import { ActsTab } from "./tabs/ActsTab";
import { DeadlinesTab } from "./tabs/DeadlinesTab";
import { AlertsTasksTab } from "./tabs/AlertsTasksTab";
import { EstadosTab } from "./tabs/EstadosTab";
import { NotesTab } from "./tabs/NotesTab";
import { HearingsTab } from "./tabs/HearingsTab";
import { PublicacionesTab } from "./tabs/PublicacionesTab";

const WORKFLOW_ICONS = {
  CGP: Scale,
  PETICION: Send,
  TUTELA: Gavel,
  GOV_PROCEDURE: Building2,
  CPACA: Landmark,
};

const WORKFLOW_COLORS = {
  CGP: "text-emerald-600",
  PETICION: "text-blue-600",
  TUTELA: "text-purple-600",
  GOV_PROCEDURE: "text-orange-600",
  CPACA: "text-indigo-600",
};

const WORKFLOW_BG_COLORS = {
  CGP: "bg-emerald-500/10",
  PETICION: "bg-blue-500/10",
  TUTELA: "bg-purple-500/10",
  GOV_PROCEDURE: "bg-orange-500/10",
  CPACA: "bg-indigo-500/10",
};

import { StickyNote, Newspaper } from "lucide-react";

type TabValue = "overview" | "notes" | "estados" | "publicaciones" | "acts" | "deadlines" | "hearings" | "alerts";

// Workflows that support Estados tab (judicial tracking)
const ESTADOS_WORKFLOWS = ["CGP", "CPACA", "TUTELA"];

// Build tabs dynamically based on workflow
// REMOVED: Documents and Emails tabs (not being used currently)
// ADDED: Notes tab for all workflows, Publicaciones for judicial workflows
const getTabsForWorkflow = (workflowType: string): { value: TabValue; label: string; icon: React.ReactNode }[] => {
  const baseTabs: { value: TabValue; label: string; icon: React.ReactNode }[] = [
    { value: "overview", label: "Resumen", icon: <FileText className="h-4 w-4" /> },
    { value: "notes", label: "Notas", icon: <StickyNote className="h-4 w-4" /> },
  ];
  
  // CONSOLIDATED: Single "Estados" tab for judicial workflows
  // This tab now shows BOTH work_item_acts AND work_item_publicaciones data
  // Estados = Court notifications (publicaciones procesales) from Rama Judicial
  if (ESTADOS_WORKFLOWS.includes(workflowType)) {
    baseTabs.push({ value: "estados", label: "Estados", icon: <Activity className="h-4 w-4" /> });
  }
  
  // REMOVED: Separate Publicaciones tab - consolidated into Estados tab above
  // The EstadosTab component now fetches from both tables
  
  baseTabs.push(
    { value: "acts", label: "Actuaciones", icon: <Scale className="h-4 w-4" /> },
    { value: "deadlines", label: "Términos", icon: <Calendar className="h-4 w-4" /> },
    { value: "hearings", label: "Audiencias", icon: <Calendar className="h-4 w-4" /> },
    { value: "alerts", label: "Alertas/Tareas", icon: <Bell className="h-4 w-4" /> },
  );
  
  return baseTabs;
};

export default function WorkItemDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // REMOVED: lastTraceId state no longer needed without SyncDebugDrawer
  // const [lastTraceId, setLastTraceId] = useState<string | null>(null);
  
  // Get initial tab from URL or default to overview
  const initialTab = (searchParams.get("tab") as TabValue) || "overview";

  // Use the secure delete hook
  const { deleteSingle, isDeleting } = useDeleteWorkItems({
    onSuccess: () => {
      navigate("/dashboard");
    },
  });

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

  // Delete handler using secure edge function
  const handleDelete = async () => {
    if (!id) return;
    await deleteSingle(id);
  };

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
  const workflowBgColor = WORKFLOW_BG_COLORS[workItem.workflow_type] || "bg-primary/10";
  const stageLabel = getStageLabel(workItem.workflow_type, workItem.stage, workItem.cgp_phase || undefined);
  const displayTitle = workItem.title || workItem.radicado || workflowConfig?.label || "Asunto";
  const tabConfig = getTabsForWorkflow(workItem.workflow_type);
  const hasClient = !!workItem.client_id;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        
        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className={cn("p-2 rounded-lg", workflowBgColor)}>
              <WorkflowIcon className={cn("h-6 w-6", workflowColor)} />
            </div>
            <h1 className="text-2xl font-serif font-bold truncate">{displayTitle}</h1>
            <Badge variant="secondary" className={cn("flex-shrink-0", workflowBgColor, workflowColor)}>
              {workflowConfig?.shortLabel || workItem.workflow_type}
            </Badge>
            <Badge variant="outline" className="flex-shrink-0">
              {stageLabel}
            </Badge>
            {workItem.cgp_phase && (
              <Badge 
                variant="outline" 
                className={cn(
                  "flex-shrink-0",
                  workItem.cgp_phase === "PROCESS" 
                    ? "bg-emerald-500/10 text-emerald-700 border-emerald-300" 
                    : "bg-amber-500/10 text-amber-700 border-amber-300"
                )}
              >
                {workItem.cgp_phase === "PROCESS" ? "En Proceso" : "En Radicación"}
              </Badge>
            )}
            {workItem.is_flagged && (
              <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30 flex-shrink-0">
                <Flag className="h-3 w-3 mr-1 fill-current" />
                Marcado
              </Badge>
            )}
          </div>
          
          {/* Subtitle row with client and authority */}
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            {/* Client info with required badge */}
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              {hasClient ? (
                <span className="text-sm font-medium">{workItem.clients?.name}</span>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground italic">Sin cliente</span>
                  <ClientRequiredBadge hasClient={false} size="sm" />
                </div>
              )}
            </div>
            
            {workItem.authority_name && (
              <>
                <span className="text-muted-foreground">•</span>
                <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                  {workItem.authority_name}
                </span>
              </>
            )}
            
            {workItem.radicado && (
              <>
                <span className="text-muted-foreground">•</span>
                <code className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                  {workItem.radicado}
                </code>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* REMOVED: Manual sync button - syncing now happens automatically on login and via daily cron */}
          {/* The useLoginSync hook triggers both sync-by-work-item and sync-publicaciones-by-work-item */}
          
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

          <Button 
            variant="ghost" 
            size="icon" 
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>

          <DeleteWorkItemDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            onConfirm={handleDelete}
            isDeleting={isDeleting}
            itemInfo={{
              title: workItem.title,
              radicado: workItem.radicado,
              workflowType: workflowConfig?.label,
            }}
          />
        </div>
      </div>

      {/* Scraping Status Banner - shows when scraping is in progress */}
      {ESTADOS_WORKFLOWS.includes(workItem.workflow_type) && (
        <ScrapingStatusBanner 
          workItem={workItem as any} 
          onRetrySync={() => {
            // Trigger re-fetch by invalidating the query
            queryClient.invalidateQueries({ queryKey: ["work-item-detail", id] });
          }}
        />
      )}

      {/* Stage Suggestion Banner - shows pending inference suggestions */}
      <StageSuggestionBannerDB
        workItemId={workItem.id}
        workflowType={workItem.workflow_type}
        currentStage={workItem.stage}
        currentCgpPhase={workItem.cgp_phase}
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["work-item-detail", id] })}
      />

      {/* Tabs */}
      <Tabs value={initialTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap bg-muted/50 p-1">
          {tabConfig.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-2 whitespace-nowrap data-[state=active]:bg-background"
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
          
          {/* Notes tab - available for all workflows */}
          <TabsContent value="notes" className="mt-0">
            <NotesTab workItem={workItem} />
          </TabsContent>
          
          {/* Estados tab - only for CGP, CPACA, TUTELA */}
          {ESTADOS_WORKFLOWS.includes(workItem.workflow_type) && (
            <TabsContent value="estados" className="mt-0">
              <EstadosTab workItem={workItem} />
            </TabsContent>
          )}
          
          {/* Publicaciones tab - only for CGP, CPACA, TUTELA */}
          {ESTADOS_WORKFLOWS.includes(workItem.workflow_type) && (
            <TabsContent value="publicaciones" className="mt-0">
              <PublicacionesTab workItem={workItem} />
            </TabsContent>
          )}
          
          <TabsContent value="acts" className="mt-0">
            <ActsTab workItem={workItem} />
          </TabsContent>
          
          <TabsContent value="deadlines" className="mt-0">
            <DeadlinesTab workItem={workItem} />
          </TabsContent>
          
          <TabsContent value="hearings" className="mt-0">
            <HearingsTab workItem={workItem} />
          </TabsContent>
          
          <TabsContent value="alerts" className="mt-0">
            <AlertsTasksTab workItem={workItem} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
