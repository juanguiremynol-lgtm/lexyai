import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { WorkItemPipeline, AdminPipeline, LaboralPipeline, PenalPipeline, UnclassifiedTray, WorkflowPhaseBoard } from "@/components/pipeline";
import { UNCLASSIFIED_TAB, visibleBoards } from "@/lib/dashboard-boards";
import type { WorkflowType } from "@/lib/workflow-constants";
import { usePracticeAreas } from "@/hooks/use-practice-areas";
import { PeticionesPipeline } from "@/components/peticiones";
import { TutelasPipeline } from "@/components/tutelas";
import { CpacaPipeline } from "@/components/cpaca";
import { CreateWorkItemWizard } from "@/components/workflow";
import { LexyDailyCard } from "@/components/lexy/LexyDailyCard";
import { HearingTeamsNotice } from "@/components/dashboard/HearingTeamsNotice";
import { StatsCarousel } from "@/components/dashboard/StatsCarousel";
import { TodayAlertsPanel } from "@/components/dashboard/TodayAlertsPanel";

export default function Dashboard() {
  const [stats, setStats] = useState({
    actaPending: 0,
    radicadoPending: 0,
    overdueTasks: 0,
    criticalAlerts: 0,
    monitoredProcesses: 0,
    pendingPeticiones: 0,
    pendingTutelas: 0,
    pendingCpaca: 0,
    pendingPenal: 0,
    pendingGovProcedure: 0,
  });
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Dashboard tab persistence via URL
  const { isPracticed } = usePracticeAreas();

  // ITER37 — boards are DERIVED: practice_areas ∩ workflows with a phase
  // catalogue. Adding an area is sufficient; no per-workflow code change.
  const boards = visibleBoards(isPracticed);
  const VALID_TABS = [...boards.map((b) => b.tab), UNCLASSIFIED_TAB];
  const urlTab = searchParams.get("tab");
  const activeTab = urlTab && VALID_TABS.includes(urlTab) ? urlTab : VALID_TABS[0] ?? UNCLASSIFIED_TAB;

  const handleTabChange = useCallback((value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  }, [setSearchParams]);

  const fetchStats = useCallback(async () => {
    // Query unified work_items table for stats
    const { data: workItemsData } = await supabase
      .from("work_items")
      .select("workflow_type, stage, cgp_phase, status")
      .eq("status", "ACTIVE");

    // CGP Filing stage stats
    const cgpFilings = workItemsData?.filter(
      (w) => w.workflow_type === "CGP" && w.cgp_phase === "FILING"
    ) || [];
    const actaPending = cgpFilings.filter((f) => f.stage === "ACTA_PENDING").length;
    const radicadoPending = cgpFilings.filter((f) => f.stage === "RADICADO_PENDING").length;

    // CGP Process count (monitoring)
    const monitoredProcesses = workItemsData?.filter(
      (w) => w.workflow_type === "CGP" && w.cgp_phase === "PROCESS"
    ).length || 0;

    // Peticiones pending
    const pendingPeticiones = workItemsData?.filter(
      (w) => w.workflow_type === "PETICION" && w.stage !== "RESPUESTA"
    ).length || 0;

    // Tutelas pending
    const pendingTutelas = workItemsData?.filter(
      (w) => w.workflow_type === "TUTELA" && w.stage !== "ARCHIVADO"
    ).length || 0;

    // CPACA pending
    const pendingCpaca = workItemsData?.filter(
      (w) => w.workflow_type === "CPACA" && w.stage !== "ARCHIVADO"
    ).length || 0;

    // PENAL_906 pending (non-terminal phases)
    const pendingPenal = workItemsData?.filter(
      (w) => w.workflow_type === "PENAL_906"
    ).length || 0;

    // GOV_PROCEDURE (administrative) pending
    const pendingGovProcedure = workItemsData?.filter(
      (w) => w.workflow_type === "GOV_PROCEDURE" && w.stage !== "ARCHIVADO"
    ).length || 0;

    // Tasks and alerts still from their own tables
    const { count: overdueTasks } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("status", "OPEN")
      .lt("due_at", new Date().toISOString());

    const { count: criticalAlerts } = await supabase
      .from("alerts")
      .select("*", { count: "exact", head: true })
      .eq("severity", "CRITICAL")
      .eq("is_read", false);

    setStats({
      actaPending,
      radicadoPending,
      overdueTasks: overdueTasks || 0,
      criticalAlerts: criticalAlerts || 0,
      monitoredProcesses,
      pendingPeticiones,
      pendingTutelas,
      pendingCpaca,
      pendingPenal,
      pendingGovProcedure,
    });
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleCreationSuccess = () => {
    fetchStats();
  };

  return (
    <div className="space-y-6 main-content-glass">
      {/* Hearing Teams Notice — shows when a hearing with Teams link is today */}
      <HearingTeamsNotice />
      {/* Lexy Daily Message */}
      <LexyDailyCard />
      {/* Header - always visible, never scrolls horizontally */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-bold readable-text-strong">
            Dashboard
          </h1>
          <p className="readable-muted">
            Vista general de radicaciones, procesos y peticiones
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} size="icon" className="h-10 w-10 flex-shrink-0">
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      {/* Stats Carousel + Atenia AI Commentary */}
      <StatsCarousel
        stats={{
          actaPending: stats.actaPending,
          radicadoPending: stats.radicadoPending,
          overdueTasks: stats.overdueTasks,
          criticalAlerts: stats.criticalAlerts,
          monitoredProcesses: stats.monitoredProcesses,
          pendingPeticiones: stats.pendingPeticiones,
          pendingTutelas: stats.pendingTutelas,
          pendingCpaca: stats.pendingCpaca,
        }}
        onRefresh={fetchStats}
      />

      {/* Today's Alerts Panel */}
      <TodayAlertsPanel />

      {/* Provider clase de proceso disagreeing with the filed área (ITER42) */}
      <WorkflowSuggestionsPanel />

      {/* Tabbed Pipelines - tabs bar scrolls if needed, content has its own scroll */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="inline-flex whitespace-nowrap">
            {boards.map((b) => (
              <TabsTrigger key={b.tab} value={b.tab}>
                {b.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value={UNCLASSIFIED_TAB}>Por clasificar</TabsTrigger>
          </TabsList>
        </div>

        {boards.map((b) => (
          <TabsContent key={b.tab} value={b.tab} className="space-y-4">
            <p className="text-sm readable-muted">{b.description}</p>
            <BoardBody workflow={b.workflow} />
          </TabsContent>
        ))}

        <TabsContent value={UNCLASSIFIED_TAB} className="space-y-4">
          <p className="text-sm readable-muted">
            Asuntos en despachos de competencia mixta o sin clase de proceso conocida. La materia
            no se deduce del radicado: defínela manualmente. El monitoreo continúa activo.
          </p>
          <UnclassifiedTray />
        </TabsContent>
      </Tabs>

      {/* Universal Creation Dialog */}
      <CreateWorkItemWizard
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={handleCreationSuccess}
      />
    </div>
  );
}

/**
 * Bespoke pipelines where they exist; the generic phase board otherwise, so a
 * newly enabled practice area always renders.
 */
function BoardBody({ workflow }: { workflow: WorkflowType }) {
  switch (workflow) {
    case "CGP":
      return <WorkItemPipeline />;
    case "LABORAL":
      return <LaboralPipeline />;
    case "PENAL_906":
      return <PenalPipeline />;
    case "CPACA":
      return <CpacaPipeline />;
    case "GOV_PROCEDURE":
      return <AdminPipeline />;
    case "PETICION":
      return <PeticionesPipeline />;
    case "TUTELA":
      return <TutelasPipeline />;
    default:
      return <WorkflowPhaseBoard workflowType={workflow} />;
  }
}
