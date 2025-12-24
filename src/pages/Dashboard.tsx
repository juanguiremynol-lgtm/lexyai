import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Clock, AlertTriangle, Eye } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UnifiedPipeline } from "@/components/pipeline";
import { ReviewAlerts } from "@/components/alerts";

export default function Dashboard() {
  const [stats, setStats] = useState({
    actaPending: 0,
    radicadoPending: 0,
    overdueTasks: 0,
    criticalAlerts: 0,
    monitoredProcesses: 0,
  });

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

    setStats({
      actaPending,
      radicadoPending,
      overdueTasks: overdueTasks || 0,
      criticalAlerts: criticalAlerts || 0,
      monitoredProcesses: monitoredProcesses || 0,
    });
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">
          Dashboard
        </h1>
        <p className="text-muted-foreground">
          Vista general de radicaciones y procesos
        </p>
      </div>

      {/* Review Alerts */}
      <ReviewAlerts />

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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
            <CardTitle className="text-sm font-medium">
              Radicado Pendiente
            </CardTitle>
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
            <CardTitle className="text-sm font-medium">
              Alertas Críticas
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-sla-critical" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.criticalAlerts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              En Seguimiento
            </CardTitle>
            <Eye className="h-4 w-4 text-status-active" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.monitoredProcesses}</div>
          </CardContent>
        </Card>
      </div>

      {/* Unified Pipeline */}
      <div>
        <h2 className="font-display text-xl font-semibold mb-4">
          Pipeline Unificado
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Radicaciones y procesos en un flujo único. Arrastra entre etapas para reclasificar.
        </p>
        <UnifiedPipeline />
      </div>
    </div>
  );
}
