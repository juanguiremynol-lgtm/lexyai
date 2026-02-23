/**
 * PlatformNotificationDispatchTab — Admin monitoring panel for notification email dispatch
 * Shows last 20 cron runs, pending alerts, and "Run Now" trigger.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Play, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Mail, Bell } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function PlatformNotificationDispatchTab() {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);

  // Fetch last 20 dispatch runs
  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ["notification-dispatch-runs"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("notification_dispatch_runs") as any)
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 30_000,
  });

  // Fetch pending alert counts
  const { data: pendingStats } = useQuery({
    queryKey: ["pending-alert-stats"],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { count, error } = await (supabase.from("alert_instances") as any)
        .select("id", { count: "exact", head: true })
        .in("alert_type", ["ACTUACION_NEW", "ACTUACION_MODIFIED", "PUBLICACION_NEW", "PUBLICACION_MODIFIED"])
        .eq("is_notified_email", false)
        .gte("fired_at", cutoff);
      if (error) throw error;
      return { pending: count ?? 0 };
    },
    refetchInterval: 15_000,
  });

  // Run Now mutation
  const runNow = useMutation({
    mutationFn: async () => {
      setIsRunning(true);
      const { data, error } = await supabase.functions.invoke("dispatch-update-emails", {
        body: { source: "manual_admin" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      setIsRunning(false);
      queryClient.invalidateQueries({ queryKey: ["notification-dispatch-runs"] });
      queryClient.invalidateQueries({ queryKey: ["pending-alert-stats"] });
      if (data?.emailsEnqueued > 0) {
        toast.success(`✅ ${data.emailsEnqueued} email(s) enqueued, ${data.processed} alerts processed`);
      } else {
        toast.info("No pending alerts to dispatch");
      }
    },
    onError: (err) => {
      setIsRunning(false);
      toast.error("Error: " + (err as Error).message);
    },
  });

  // Send test email mutation
  const sendTest = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      // Create a test alert_instance, then run dispatch
      const { error: insertErr } = await (supabase.from("alert_instances") as any).insert({
        owner_id: user.id,
        entity_id: "00000000-0000-0000-0000-000000000000",
        entity_type: "work_item",
        alert_type: "ACTUACION_NEW",
        title: "🧪 Alerta de prueba",
        message: "Esta es una alerta de prueba generada desde la consola de administración",
        severity: "info",
        payload: { description: "Test alert from admin console", source: "admin_test", act_date: new Date().toISOString().split('T')[0] },
        fired_at: new Date().toISOString(),
        is_notified_email: false,
        status: "active",
      });
      if (insertErr) throw insertErr;
      // Trigger dispatch
      const { data, error } = await supabase.functions.invoke("dispatch-update-emails", {
        body: { source: "test_email" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-dispatch-runs"] });
      queryClient.invalidateQueries({ queryKey: ["pending-alert-stats"] });
      toast.success("✅ Test alert email sent to your registered email");
    },
    onError: (err) => {
      toast.error("Error: " + (err as Error).message);
    },
  });

  const statusBadge = (status: string) => {
    switch (status) {
      case "SUCCESS": return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30"><CheckCircle className="h-3 w-3 mr-1" /> Éxito</Badge>;
      case "FAILED": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="h-3 w-3 mr-1" /> Error</Badge>;
      case "NO_ALERTS": return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30"><Clock className="h-3 w-3 mr-1" /> Sin alertas</Badge>;
      case "RUNNING": return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30"><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> En curso</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-black/40 border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/50">Alertas pendientes</p>
                <p className="text-3xl font-bold text-white">{pendingStats?.pending ?? "—"}</p>
              </div>
              <AlertTriangle className={`h-8 w-8 ${(pendingStats?.pending ?? 0) > 0 ? 'text-amber-400' : 'text-white/20'}`} />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-black/40 border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/50">Última ejecución</p>
                <p className="text-lg font-medium text-white">
                  {runs?.[0]?.started_at
                    ? format(new Date(runs[0].started_at), "dd MMM HH:mm", { locale: es })
                    : "Nunca"}
                </p>
              </div>
              <Clock className="h-8 w-8 text-white/20" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-black/40 border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/50">Total emails hoy</p>
                <p className="text-3xl font-bold text-white">
                  {runs?.filter(r => {
                    const d = new Date(r.started_at);
                    const now = new Date();
                    return d.toDateString() === now.toDateString();
                  }).reduce((sum: number, r: any) => sum + (r.emails_enqueued || 0), 0) ?? 0}
                </p>
              </div>
              <Mail className="h-8 w-8 text-white/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Bell className="h-5 w-5 text-cyan-400" />
            Acciones
          </CardTitle>
          <CardDescription className="text-white/50">
            Ejecutar manualmente el dispatch de emails o enviar un email de prueba
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3 flex-wrap">
          <Button
            onClick={() => runNow.mutate()}
            disabled={isRunning || runNow.isPending}
            className="bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            <Play className="h-4 w-4 mr-2" />
            {isRunning ? "Ejecutando..." : "Run Now"}
          </Button>
          <Button
            variant="outline"
            onClick={() => sendTest.mutate()}
            disabled={sendTest.isPending}
            className="border-white/20 text-white/80 hover:bg-white/10"
          >
            <Mail className="h-4 w-4 mr-2" />
            {sendTest.isPending ? "Enviando..." : "Test Alert Email"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["notification-dispatch-runs"] });
              queryClient.invalidateQueries({ queryKey: ["pending-alert-stats"] });
            }}
            className="text-white/50 hover:text-white hover:bg-white/5"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refrescar
          </Button>
        </CardContent>
      </Card>

      <Separator className="bg-white/10" />

      {/* Run History Table */}
      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Historial de ejecuciones</CardTitle>
          <CardDescription className="text-white/50">
            Últimas 20 ejecuciones del dispatch de notificaciones por email
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <p className="text-white/50 text-center py-8">Cargando...</p>
          ) : !runs?.length ? (
            <p className="text-white/50 text-center py-8">No hay ejecuciones registradas aún</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-white/50">Inicio</TableHead>
                    <TableHead className="text-white/50">Estado</TableHead>
                    <TableHead className="text-white/50">Fuente</TableHead>
                    <TableHead className="text-white/50 text-right">Alertas</TableHead>
                    <TableHead className="text-white/50 text-right">Emails</TableHead>
                    <TableHead className="text-white/50 text-right">Procesos</TableHead>
                    <TableHead className="text-white/50 text-right">Duración</TableHead>
                    <TableHead className="text-white/50">Errores</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run: any) => (
                    <TableRow key={run.id} className="border-white/5 hover:bg-white/5">
                      <TableCell className="text-white/70 text-sm">
                        {format(new Date(run.started_at), "dd MMM HH:mm:ss", { locale: es })}
                      </TableCell>
                      <TableCell>{statusBadge(run.status)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-white/50 border-white/20 text-xs">
                          {run.trigger_source}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-white/70">{run.alerts_found}</TableCell>
                      <TableCell className="text-right font-medium text-white">{run.emails_enqueued}</TableCell>
                      <TableCell className="text-right text-white/70">{run.work_items_count}</TableCell>
                      <TableCell className="text-right text-white/50 text-sm">
                        {run.duration_ms != null ? `${run.duration_ms}ms` : "—"}
                      </TableCell>
                      <TableCell>
                        {run.error_summary ? (
                          <span className="text-red-400 text-xs truncate max-w-[200px] block" title={run.error_summary}>
                            {run.error_summary.substring(0, 60)}...
                          </span>
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
