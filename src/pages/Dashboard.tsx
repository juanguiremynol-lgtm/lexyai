import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FileText, Clock, AlertTriangle, Eye, Send, Gavel, Building2, Plus } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UnifiedPipeline, AdminPipeline } from "@/components/pipeline";
import { PeticionesPipeline } from "@/components/peticiones";
import { TutelasPipeline } from "@/components/tutelas";
import { ReviewAlerts } from "@/components/alerts";
import { UnifiedFilingCreator, FilingCategory } from "@/components/filings";

export default function Dashboard() {
  const [stats, setStats] = useState({
    actaPending: 0,
    radicadoPending: 0,
    overdueTasks: 0,
    criticalAlerts: 0,
    monitoredProcesses: 0,
    pendingPeticiones: 0,
    pendingTutelas: 0,
  });
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createType, setCreateType] = useState<FilingCategory | undefined>(undefined);

  const openCreateDialog = (type: FilingCategory) => {
    setCreateType(type);
    setCreateDialogOpen(true);
  };

  const fetchStats = useCallback(async () => {
    const { data: filingsData } = await supabase
      .from("filings")
      .select("status")
      .neq("status", "CLOSED");

    const actaPending =
      filingsData?.filter((f) => f.status === "ACTA_PENDING").length || 0;
    const radicadoPending =
      filingsData?.filter((f) => f.status === "RADICADO_PENDING").length || 0;

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

    const { count: monitoredProcesses } = await supabase
      .from("monitored_processes")
      .select("*", { count: "exact", head: true })
      .eq("monitoring_enabled", true);

    const { count: pendingPeticiones } = await supabase
      .from("peticiones")
      .select("*", { count: "exact", head: true })
      .neq("phase", "RESPUESTA");

    const { count: pendingTutelas } = await supabase
      .from("filings")
      .select("*", { count: "exact", head: true })
      .eq("filing_type", "TUTELA")
      .neq("status", "CLOSED");

    setStats({
      actaPending,
      radicadoPending,
      overdueTasks: overdueTasks || 0,
      criticalAlerts: criticalAlerts || 0,
      monitoredProcesses: monitoredProcesses || 0,
      pendingPeticiones: pendingPeticiones || 0,
      pendingTutelas: pendingTutelas || 0,
    });
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">
            Dashboard
          </h1>
          <p className="text-muted-foreground">
            Vista general de radicaciones, procesos y peticiones
          </p>
        </div>
        <Button onClick={() => { setCreateType(undefined); setCreateDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          + Radicado
        </Button>
      </div>

      <ReviewAlerts />

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
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
      </div>

      {/* Tabbed Pipelines */}
      <Tabs defaultValue="cgp" className="space-y-4">
        <TabsList>
          <TabsTrigger value="cgp">Demandas CGP</TabsTrigger>
          <TabsTrigger value="administrativos">Procesos Administrativos</TabsTrigger>
          <TabsTrigger value="peticiones">Peticiones</TabsTrigger>
          <TabsTrigger value="tutelas">Tutelas</TabsTrigger>
        </TabsList>
        
        <TabsContent value="cgp" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Radicaciones y procesos bajo Código General del Proceso. Arrastra entre etapas para reclasificar.
            </p>
            <Button size="sm" variant="outline" onClick={() => openCreateDialog("CGP")}>
              <Plus className="h-4 w-4 mr-1" />
              Nueva Demanda CGP
            </Button>
          </div>
          <UnifiedPipeline />
        </TabsContent>

        <TabsContent value="administrativos" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Procesos ante autoridades administrativas (inspecciones, superintendencias, tránsito, disciplinarios). Arrastra entre fases.
            </p>
            <Button size="sm" variant="outline" onClick={() => openCreateDialog("ADMINISTRATIVO")}>
              <Plus className="h-4 w-4 mr-1" />
              Nuevo Proceso Administrativo
            </Button>
          </div>
          <AdminPipeline />
        </TabsContent>
        
        <TabsContent value="peticiones" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Derechos de petición con seguimiento de plazos (15 días hábiles). Las peticiones vencidas pueden escalarse a tutela.
            </p>
            <Button size="sm" variant="outline" onClick={() => openCreateDialog("PETICION")}>
              <Plus className="h-4 w-4 mr-1" />
              Nueva Petición
            </Button>
          </div>
          <PeticionesPipeline />
        </TabsContent>

        <TabsContent value="tutelas" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Acciones de tutela con seguimiento de fallos. Los fallos favorables permiten archivar el proceso.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => openCreateDialog("TUTELA")}>
                <Plus className="h-4 w-4 mr-1" />
                Nueva Tutela
              </Button>
              <Button size="sm" variant="outline" className="border-red-500/50 text-red-500 hover:bg-red-500/10" onClick={() => openCreateDialog("HABEAS_CORPUS")}>
                <Plus className="h-4 w-4 mr-1" />
                Habeas Corpus
              </Button>
            </div>
          </div>
          <TutelasPipeline />
        </TabsContent>
      </Tabs>

      {/* Unified Filing Creator */}
      <UnifiedFilingCreator
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        initialType={createType}
        onSuccess={() => {
          fetchStats();
        }}
      />
    </div>
  );
}
