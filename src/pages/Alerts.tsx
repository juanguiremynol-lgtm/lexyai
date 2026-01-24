import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  ExternalLink,
  Info,
  RefreshCw,
  Gavel,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import type { AlertSeverity } from "@/types/database";

type AlertInstanceAction = {
  label: string;
  action: string;
  params?: { path?: string };
};

interface AlertInstance {
  id: string;
  owner_id: string;
  entity_type: string;
  entity_id: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  actions?: AlertInstanceAction[];
  fired_at: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
}

export default function Alerts() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Legacy alerts from 'alerts' table
  const { data: alerts, isLoading: isLoadingAlerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select(`
          *,
          filing:filings(
            id,
            filing_type,
            matter:matters(client_name, matter_name)
          )
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // New alert instances from 'alert_instances' table
  const { data: alertInstances, isLoading: isLoadingInstances } = useQuery({
    queryKey: ["alert_instances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_instances")
        .select("*")
        .in("status", ["PENDING", "SENT", "ACKNOWLEDGED"])
        .order("fired_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map(d => ({
        ...d,
        actions: Array.isArray(d.actions) ? d.actions as AlertInstanceAction[] : [],
      })) as AlertInstance[];
    },
  });

  const markAsRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("alerts")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["unreadAlerts"] });
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const acknowledgeInstance = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("alert_instances")
        .update({ 
          status: "ACKNOWLEDGED",
          acknowledged_at: new Date().toISOString()
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert_instances"] });
      toast.success("Alerta reconocida");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const resolveInstance = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("alert_instances")
        .update({ 
          status: "RESOLVED",
          resolved_at: new Date().toISOString()
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert_instances"] });
      toast.success("Alerta resuelta");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const { error } = await supabase
        .from("alerts")
        .update({ is_read: true })
        .eq("owner_id", user.id)
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["unreadAlerts"] });
      toast.success("Todas las alertas marcadas como leídas");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
      case "error":
        return <AlertCircle className="h-5 w-5 text-destructive" />;
      case "WARN":
      case "WARNING":
        return <AlertTriangle className="h-5 w-5 text-sla-warning" />;
      default:
        return <Info className="h-5 w-5 text-primary" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
      case "error":
        return <Badge variant="destructive">Crítica</Badge>;
      case "WARN":
      case "WARNING":
        return (
          <Badge className="bg-sla-warning text-sla-warning-foreground">
            Advertencia
          </Badge>
        );
      default:
        return <Badge variant="secondary">Info</Badge>;
    }
  };

  const getEntityTypeBadge = (entityType: string) => {
    switch (entityType) {
      case "CGP_FILING":
        return <Badge variant="outline"><Gavel className="h-3 w-3 mr-1" />CGP</Badge>;
      case "CGP_CASE":
        return <Badge variant="outline"><Gavel className="h-3 w-3 mr-1" />Proceso</Badge>;
      case "PETICION":
        return <Badge variant="outline">Petición</Badge>;
      case "TUTELA":
        return <Badge variant="outline">Tutela</Badge>;
      case "ADMIN_PROCESS":
        return <Badge variant="outline">Admin</Badge>;
      default:
        return <Badge variant="outline">{entityType}</Badge>;
    }
  };

  const handleInstanceAction = (action: AlertInstanceAction) => {
    if (action.action === "navigate" && action.params?.path) {
      navigate(action.params.path);
    }
  };

  const unreadCount = alerts?.filter((a) => !a.is_read).length || 0;
  const criticalCount = alerts?.filter((a) => a.severity === "CRITICAL" && !a.is_read).length || 0;
  const pendingInstanceCount = alertInstances?.filter(a => a.status === "PENDING").length || 0;
  const processUpdateCount = alertInstances?.filter(a => 
    a.entity_type === "CGP_FILING" || a.entity_type === "CGP_CASE"
  ).length || 0;

  const isLoading = isLoadingAlerts || isLoadingInstances;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Alertas</h1>
          <p className="text-muted-foreground">
            {unreadCount + pendingInstanceCount} sin leer • {criticalCount} críticas • {processUpdateCount} actualizaciones de procesos
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["alerts"] });
              queryClient.invalidateQueries({ queryKey: ["alert_instances"] });
              toast.success("Alertas actualizadas");
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualizar
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
            >
              <Check className="h-4 w-4 mr-2" />
              Marcar todas como leídas
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sin Leer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{unreadCount + pendingInstanceCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Críticas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">{criticalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Actualizaciones Procesos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">{processUpdateCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{(alerts?.length || 0) + (alertInstances?.length || 0)}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="process_updates" className="w-full">
        <TabsList>
          <TabsTrigger value="process_updates">
            Actualizaciones de Procesos ({processUpdateCount})
          </TabsTrigger>
          <TabsTrigger value="all_instances">
            Alertas del Sistema ({alertInstances?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="legacy">
            Alertas Legacy ({alerts?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="process_updates">
          <Card>
            <CardHeader>
              <CardTitle>Actualizaciones de Procesos CGP</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Cargando...
                </div>
              ) : alertInstances?.filter(a => a.entity_type === "CGP_FILING" || a.entity_type === "CGP_CASE").length === 0 ? (
                <div className="text-center py-12">
                  <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium">No hay actualizaciones de procesos</h3>
                  <p className="text-muted-foreground">
                    Las actualizaciones se detectan automáticamente al consultar la API de Rama Judicial
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alertInstances
                    ?.filter(a => a.entity_type === "CGP_FILING" || a.entity_type === "CGP_CASE")
                    .map((instance) => (
                      <div
                        key={instance.id}
                        className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                          instance.status === "PENDING"
                            ? "bg-muted/50 border-primary/20"
                            : "bg-background"
                        }`}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {getSeverityIcon(instance.severity)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {getEntityTypeBadge(instance.entity_type)}
                            {getSeverityBadge(instance.severity)}
                            {instance.status === "PENDING" && (
                              <Badge variant="outline" className="text-xs">
                                Nueva
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium">{instance.title}</p>
                          <p className="text-sm text-muted-foreground">{instance.message}</p>
                          {instance.payload?.radicado && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Radicado: <code className="bg-muted px-1 rounded">{String(instance.payload.radicado)}</code>
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDateColombia(instance.fired_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {instance.status === "PENDING" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => acknowledgeInstance.mutate(instance.id)}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          {instance.actions?.map((action, idx) => (
                            <Button 
                              key={idx}
                              variant="ghost" 
                              size="sm" 
                              onClick={() => handleInstanceAction(action)}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all_instances">
          <Card>
            <CardHeader>
              <CardTitle>Todas las Alertas del Sistema</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Cargando...
                </div>
              ) : alertInstances?.length === 0 ? (
                <div className="text-center py-12">
                  <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium">No hay alertas del sistema</h3>
                </div>
              ) : (
                <div className="space-y-3">
                  {alertInstances?.map((instance) => (
                    <div
                      key={instance.id}
                      className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                        instance.status === "PENDING"
                          ? "bg-muted/50 border-primary/20"
                          : "bg-background"
                      }`}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {getSeverityIcon(instance.severity)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {getEntityTypeBadge(instance.entity_type)}
                          {getSeverityBadge(instance.severity)}
                        </div>
                        <p className="text-sm font-medium">{instance.title}</p>
                        <p className="text-sm text-muted-foreground">{instance.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDateColombia(instance.fired_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {instance.status !== "RESOLVED" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resolveInstance.mutate(instance.id)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="legacy">
          <Card>
            <CardHeader>
              <CardTitle>Alertas Legacy</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingAlerts ? (
                <div className="text-center py-8 text-muted-foreground">
                  Cargando...
                </div>
              ) : alerts?.length === 0 ? (
                <div className="text-center py-12">
                  <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium">No hay alertas</h3>
                  <p className="text-muted-foreground">
                    Las alertas se crean automáticamente al gestionar radicaciones
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alerts?.map((alert) => {
                    const filing = alert.filing as {
                      id: string;
                      filing_type: string;
                      matter: { client_name: string; matter_name: string } | null;
                    } | null;
                    return (
                      <div
                        key={alert.id}
                        className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
                          alert.is_read
                            ? "bg-background"
                            : "bg-muted/50 border-primary/20"
                        }`}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {getSeverityIcon(alert.severity as AlertSeverity)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getSeverityBadge(alert.severity as AlertSeverity)}
                            {!alert.is_read && (
                              <Badge variant="outline" className="text-xs">
                                Nueva
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium">{alert.message}</p>
                          {filing && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {filing.matter?.client_name} – {filing.matter?.matter_name}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDateColombia(alert.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {!alert.is_read && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => markAsRead.mutate(alert.id)}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          {filing && (
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/work-items/${filing.id}`}>
                                <ExternalLink className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
