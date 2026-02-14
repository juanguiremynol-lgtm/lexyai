import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { WorkItemPipeline, AdminPipeline, LaboralPipeline, PenalPipeline } from "@/components/pipeline";
import { PeticionesPipeline } from "@/components/peticiones";
import { TutelasPipeline } from "@/components/tutelas";
import { CpacaPipeline } from "@/components/cpaca";
import { CreateWorkItemWizard } from "@/components/workflow";
import { LexyDailyCard } from "@/components/lexy/LexyDailyCard";
import { HearingTeamsNotice } from "@/components/dashboard/HearingTeamsNotice";
import { StatsCarousel } from "@/components/dashboard/StatsCarousel";

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
  const VALID_TABS = ["cgp", "laboral", "penal", "cpaca", "administrativos", "peticiones", "tutelas"];
  const urlTab = searchParams.get("tab");
  const activeTab = urlTab && VALID_TABS.includes(urlTab) ? urlTab : "cgp";

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

      {/* Tabbed Pipelines - tabs bar scrolls if needed, content has its own scroll */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="inline-flex whitespace-nowrap">
            <TabsTrigger value="cgp">Demandas CGP</TabsTrigger>
            <TabsTrigger value="laboral">Laborales</TabsTrigger>
            <TabsTrigger value="penal">Penal</TabsTrigger>
            <TabsTrigger value="cpaca">CPACA</TabsTrigger>
            <TabsTrigger value="administrativos">Procesos Administrativos</TabsTrigger>
            <TabsTrigger value="peticiones">Peticiones</TabsTrigger>
            <TabsTrigger value="tutelas">Tutelas</TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value="cgp" className="space-y-4">
          <p className="text-sm readable-muted">
            Radicaciones y procesos bajo Código General del Proceso (civil, comercial, familia). Arrastra entre etapas para reclasificar.
          </p>
          <WorkItemPipeline />
        </TabsContent>

        <TabsContent value="laboral" className="space-y-4">
          <p className="text-sm readable-muted">
            Procesos laborales bajo Código Procesal del Trabajo (CPTSS). Audiencia única de conciliación, juzgamiento y fallo.
          </p>
          <LaboralPipeline />
        </TabsContent>

        <TabsContent value="penal" className="space-y-4">
          <p className="text-sm readable-muted">
            Procesos penales bajo Ley 906 de 2004 (Sistema Penal Acusatorio). 14 etapas desde indagación hasta ejecutoria.
          </p>
          <PenalPipeline />
        </TabsContent>

        <TabsContent value="cpaca" className="space-y-4">
          <p className="text-sm readable-muted">
            Procesos ordinarios contencioso administrativos (CPACA). Cálculo automático de términos según Art. 199.
          </p>
          <CpacaPipeline />
        </TabsContent>

        <TabsContent value="administrativos" className="space-y-4">
          <p className="text-sm readable-muted">
            Procesos ante autoridades administrativas (inspecciones, superintendencias, tránsito, disciplinarios). Arrastra entre fases.
          </p>
          <AdminPipeline />
        </TabsContent>
        
        <TabsContent value="peticiones" className="space-y-4">
          <p className="text-sm readable-muted">
            Derechos de petición con seguimiento de plazos (15 días hábiles). Las peticiones vencidas pueden escalarse a tutela.
          </p>
          <PeticionesPipeline />
        </TabsContent>

        <TabsContent value="tutelas" className="space-y-4">
          <p className="text-sm readable-muted">
            Acciones de tutela con seguimiento de fallos. Los fallos favorables permiten archivar el proceso.
          </p>
          <TutelasPipeline />
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
