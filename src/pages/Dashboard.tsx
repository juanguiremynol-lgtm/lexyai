import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Clock, AlertTriangle, CheckCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { KANBAN_COLUMNS, FILING_STATUSES } from "@/lib/constants";
import { StatusBadge } from "@/components/ui/status-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { useNavigate } from "react-router-dom";
import type { FilingStatus } from "@/lib/constants";

interface Filing {
  id: string;
  status: FilingStatus;
  filing_type: string;
  sla_acta_due_at: string | null;
  sla_court_reply_due_at: string | null;
  matter: { client_name: string; matter_name: string } | null;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [filings, setFilings] = useState<Filing[]>([]);
  const [stats, setStats] = useState({ actaPending: 0, radicadoPending: 0, overdueTasks: 0, criticalAlerts: 0 });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: filingsData } = await supabase
      .from('filings')
      .select('id, status, filing_type, sla_acta_due_at, sla_court_reply_due_at, matter:matters(client_name, matter_name)')
      .neq('status', 'CLOSED');

    setFilings((filingsData as unknown as Filing[]) || []);

    const actaPending = filingsData?.filter(f => f.status === 'ACTA_PENDING').length || 0;
    const radicadoPending = filingsData?.filter(f => f.status === 'RADICADO_PENDING').length || 0;

    const { count: overdueTasks } = await supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'OPEN')
      .lt('due_at', new Date().toISOString());

    const { count: criticalAlerts } = await supabase
      .from('alerts')
      .select('*', { count: 'exact', head: true })
      .eq('severity', 'CRITICAL')
      .eq('is_read', false);

    setStats({ actaPending, radicadoPending, overdueTasks: overdueTasks || 0, criticalAlerts: criticalAlerts || 0 });
  };

  const getFilingsByStatus = (status: FilingStatus) => filings.filter(f => f.status === status);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Vista general de tus radicaciones</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
      </div>

      {/* Kanban Board */}
      <div>
        <h2 className="font-display text-xl font-semibold mb-4">Pipeline de Radicaciones</h2>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((status) => (
            <div key={status} className="flex-shrink-0 w-72">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-3">
                  <StatusBadge status={status} size="sm" />
                  <span className="text-xs text-muted-foreground">{getFilingsByStatus(status).length}</span>
                </div>
                <div className="space-y-2">
                  {getFilingsByStatus(status).map((filing) => (
                    <Card 
                      key={filing.id} 
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => navigate(`/filings/${filing.id}`)}
                    >
                      <CardContent className="p-3">
                        <p className="font-medium text-sm truncate">{filing.matter?.client_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{filing.matter?.matter_name}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-muted-foreground">{filing.filing_type}</span>
                          {filing.sla_acta_due_at && <SlaBadge dueDate={filing.sla_acta_due_at} size="sm" />}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {getFilingsByStatus(status).length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">Sin radicaciones</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
