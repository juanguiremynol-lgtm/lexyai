import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FileText, Clock, AlertTriangle, Eye, Send, Gavel, Plus } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UnifiedPipeline, AdminPipeline } from "@/components/pipeline";
import { PeticionesPipeline } from "@/components/peticiones";
import { TutelasPipeline } from "@/components/tutelas";
import { UnifiedFilingCreator } from "@/components/filings/UnifiedFilingCreator";

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

  const handleCreationSuccess = () => {
    fetchStats();
  };

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
        <Button onClick={() => setCreateDialogOpen(true)} size="lg" className="gap-2">
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Nuevo</span>
        </Button>
      </div>

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
          <p className="text-sm text-muted-foreground">
            Radicaciones y procesos bajo Código General del Proceso. Arrastra entre etapas para reclasificar.
          </p>
          <UnifiedPipeline />
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
      <UnifiedFilingCreator
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={handleCreationSuccess}
      />
    </div>
  );
}
