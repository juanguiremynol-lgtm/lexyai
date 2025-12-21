import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  ExternalLink,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import type { AlertSeverity } from "@/types/database";

export default function Alerts() {
  const queryClient = useQueryClient();

  const { data: alerts, isLoading } = useQuery({
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

  const getSeverityIcon = (severity: AlertSeverity) => {
    switch (severity) {
      case "CRITICAL":
        return <AlertCircle className="h-5 w-5 text-destructive" />;
      case "WARN":
        return <AlertTriangle className="h-5 w-5 text-sla-warning" />;
      default:
        return <Info className="h-5 w-5 text-primary" />;
    }
  };

  const getSeverityBadge = (severity: AlertSeverity) => {
    switch (severity) {
      case "CRITICAL":
        return <Badge variant="destructive">Crítica</Badge>;
      case "WARN":
        return (
          <Badge className="bg-sla-warning text-sla-warning-foreground">
            Advertencia
          </Badge>
        );
      default:
        return <Badge variant="secondary">Info</Badge>;
    }
  };

  const unreadCount = alerts?.filter((a) => !a.is_read).length || 0;
  const criticalCount =
    alerts?.filter((a) => a.severity === "CRITICAL" && !a.is_read).length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Alertas</h1>
          <p className="text-muted-foreground">
            {unreadCount} sin leer • {criticalCount} críticas
          </p>
        </div>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sin Leer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{unreadCount}</p>
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
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{alerts?.length || 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Todas las Alertas</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
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
                          <Link to={`/filings/${filing.id}`}>
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
    </div>
  );
}
