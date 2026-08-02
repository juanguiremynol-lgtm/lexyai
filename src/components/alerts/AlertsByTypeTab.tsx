/**
 * AlertsByTypeTab — iteration 10 alert board.
 *
 * Groups actionable alerts by type with counts, defaults to severity >= WARNING,
 * exposes "Marcar todas como leídas" per group and links to the underlying object.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AlertTriangle, Bell, Check, ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { markAlertsAsRead } from "@/lib/alerts";
import { groupAlertsByType, alertTypeLabel, isActionableSeverity } from "@/lib/alerts/doctrine";

interface BoardAlert {
  id: string;
  entity_id: string;
  entity_type: string;
  alert_type: string | null;
  severity: string;
  status: string;
  title: string;
  message: string | null;
  fired_at: string;
  read_at: string | null;
  payload?: Record<string, unknown> | null;
}

export function AlertsByTypeTab() {
  const queryClient = useQueryClient();
  const [onlyActionable, setOnlyActionable] = useState(true);

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["alerts-by-type"],
    queryFn: async (): Promise<BoardAlert[]> => {
      const { data, error } = await supabase
        .from("alert_instances")
        .select(
          "id, entity_id, entity_type, alert_type, severity, status, title, message, fired_at, read_at, payload",
        )
        .in("status", ["PENDING", "SENT", "ACKNOWLEDGED"])
        .order("fired_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as BoardAlert[];
    },
    staleTime: 30_000,
  });

  const markGroupRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await markAlertsAsRead(ids);
      if (!res.success) throw new Error(res.error);
      return res.count ?? 0;
    },
    onSuccess: (count) => {
      toast.success(`${count} alerta(s) marcadas como leídas`);
      queryClient.invalidateQueries({ queryKey: ["alerts-by-type"] });
      queryClient.invalidateQueries({ queryKey: ["unread-alert-count"] });
    },
    onError: (e: Error) => toast.error(e.message || "No fue posible marcar como leídas"),
  });

  const groups = useMemo(() => {
    const visible = onlyActionable ? alerts.filter((a) => isActionableSeverity(a.severity)) : alerts;
    return groupAlertsByType(visible);
  }, [alerts, onlyActionable]);

  const totalVisible = groups.reduce((sum, g) => sum + g.count, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Alertas por tipo ({totalVisible})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Switch
              id="only-actionable"
              checked={onlyActionable}
              onCheckedChange={setOnlyActionable}
            />
            <Label htmlFor="only-actionable" className="text-sm text-muted-foreground">
              Solo accionables (WARNING y CRITICAL)
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Cargando...</div>
        ) : groups.length === 0 ? (
          <div className="py-12 text-center">
            <Check className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">Sin alertas que requieran decisión</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Las novedades ingestadas se consultan en la Línea procesal de cada expediente.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const unreadIds = group.alerts.filter((a) => !a.read_at).map((a) => a.id);
              return (
                <Collapsible key={group.type} defaultOpen>
                  <div className="rounded-lg border">
                    <div className="flex items-center justify-between gap-2 p-3">
                      <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left">
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{group.label}</span>
                        <Badge variant="secondary">{group.count}</Badge>
                        {group.criticalCount > 0 && (
                          <Badge variant="destructive">{group.criticalCount} críticas</Badge>
                        )}
                      </CollapsibleTrigger>
                      {unreadIds.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markGroupRead.mutate(unreadIds)}
                          disabled={markGroupRead.isPending}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Marcar todas como leídas
                        </Button>
                      )}
                    </div>
                    <CollapsibleContent>
                      <div className="space-y-2 border-t p-3">
                        {group.alerts.map((alert) => {
                          const radicado =
                            (alert.payload?.radicado as string | undefined) ?? null;
                          const isCritical = alert.severity?.toUpperCase() === "CRITICAL";
                          return (
                            <div
                              key={alert.id}
                              className={cn(
                                "flex items-start gap-3 rounded-md border p-3 text-sm",
                                !alert.read_at && "bg-muted/50",
                                isCritical && "border-destructive/30",
                              )}
                            >
                              {isCritical && (
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="font-medium">{alert.title}</p>
                                {alert.message && (
                                  <p className="line-clamp-2 text-xs text-muted-foreground">
                                    {alert.message}
                                  </p>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                  <Badge variant="outline" className="text-[10px]">
                                    {alertTypeLabel(alert.alert_type)}
                                  </Badge>
                                  {radicado && <span className="font-mono">{radicado}</span>}
                                  <span>
                                    {formatDistanceToNow(new Date(alert.fired_at), {
                                      addSuffix: true,
                                      locale: es,
                                    })}
                                  </span>
                                </div>
                              </div>
                              {alert.entity_type === "WORK_ITEM" && (
                                <Button variant="ghost" size="sm" asChild>
                                  <Link to={`/app/work-items/${alert.entity_id}`}>
                                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                    Ver
                                  </Link>
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
