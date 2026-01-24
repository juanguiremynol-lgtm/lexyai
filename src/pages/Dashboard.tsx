import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FileText, Clock, AlertTriangle, Eye, Send, Gavel, Plus, Scale, Briefcase } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { WorkItemPipeline, AdminPipeline, LaboralPipeline } from "@/components/pipeline";
import { PeticionesPipeline } from "@/components/peticiones";
import { TutelasPipeline } from "@/components/tutelas";
import { CpacaPipeline } from "@/components/cpaca";
import { CreateWorkItemWizard } from "@/components/workflow";

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
  });
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

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
    });
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleCreationSuccess = () => {
    fetchStats();
  };

  return (
    <div className="space-y-6">
      {/* Header - always visible, never scrolls horizontally */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-bold text-foreground">
            Dashboard
          </h1>
          <p className="text-muted-foreground">
            Vista general de radicaciones, procesos y peticiones
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} size="icon" className="h-10 w-10 flex-shrink-0">
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Acta Pendiente</CardTitle>
            <Clock className="h-4 w-4 text-status-pending" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.actaPending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Radicado Pendiente</CardTitle>
            <FileText className="h-4 w-4 text-status-pending" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.radicadoPending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Tareas Vencidas</CardTitle>
            <AlertTriangle className="h-4 w-4 text-sla-critical" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.overdueTasks}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Alertas Críticas</CardTitle>
            <AlertTriangle className="h-4 w-4 text-sla-critical" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.criticalAlerts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">En Seguimiento</CardTitle>
            <Eye className="h-4 w-4 text-status-active" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.monitoredProcesses}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Peticiones</CardTitle>
            <Send className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingPeticiones}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Tutelas</CardTitle>
            <Gavel className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingTutelas}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">CPACA</CardTitle>
            <Scale className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingCpaca}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabbed Pipelines - tabs bar scrolls if needed, content has its own scroll */}
      <Tabs defaultValue="cgp" className="space-y-4">
        <div className="overflow-x-auto -mx-1 px-1">
          <TabsList className="inline-flex whitespace-nowrap">
            <TabsTrigger value="cgp">Demandas CGP</TabsTrigger>
            <TabsTrigger value="laboral">Laborales</TabsTrigger>
            <TabsTrigger value="cpaca">CPACA</TabsTrigger>
            <TabsTrigger value="administrativos">Procesos Administrativos</TabsTrigger>
            <TabsTrigger value="peticiones">Peticiones</TabsTrigger>
            <TabsTrigger value="tutelas">Tutelas</TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value="cgp" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Radicaciones y procesos bajo Código General del Proceso (civil, comercial, familia). Arrastra entre etapas para reclasificar.
          </p>
          <WorkItemPipeline />
        </TabsContent>

        <TabsContent value="laboral" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Procesos laborales bajo Código Procesal del Trabajo (CPTSS). Audiencia única de conciliación, juzgamiento y fallo.
          </p>
          <LaboralPipeline />
        </TabsContent>

        <TabsContent value="cpaca" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Procesos ordinarios contencioso administrativos (CPACA). Cálculo automático de términos según Art. 199.
          </p>
          <CpacaPipeline />
        </TabsContent>

        <TabsContent value="administrativos" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Procesos ante autoridades administrativas (inspecciones, superintendencias, tránsito, disciplinarios). Arrastra entre fases.
          </p>
          <AdminPipeline />
        </TabsContent>
        
        <TabsContent value="peticiones" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Derechos de petición con seguimiento de plazos (15 días hábiles). Las peticiones vencidas pueden escalarse a tutela.
          </p>
          <PeticionesPipeline />
        </TabsContent>

        <TabsContent value="tutelas" className="space-y-4">
          <p className="text-sm text-muted-foreground">
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
