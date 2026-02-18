/**
 * TodayAlertsPanel — Dashboard card showing today's user notifications
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, ChevronRight, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { ALERT_TYPE_LABELS, type UserAlertType } from "@/lib/alerts/create-user-alert";
import { cn } from "@/lib/utils";

export function TodayAlertsPanel() {
  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["today-notifications"],
    queryFn: async () => {
      // Today at 00:00 COT (UTC-5)
      const now = new Date();
      const cotOffset = -5 * 60;
      const cotNow = new Date(now.getTime() + (cotOffset + now.getTimezoneOffset()) * 60000);
      const todayStart = new Date(cotNow.getFullYear(), cotNow.getMonth(), cotNow.getDate());
      const todayStartUTC = new Date(todayStart.getTime() - cotOffset * 60000);

      const { data, error } = await (supabase.from("notifications") as any)
        .select("id, type, title, severity, created_at, read_at, deep_link")
        .in("category", ["WORK_ITEM_ALERTS", "TERMS"])
        .is("dismissed_at", null)
        .gte("created_at", todayStartUTC.toISOString())
        .order("severity", { ascending: true }) // CRITICAL first (alphabetically before INFO)
        .order("created_at", { ascending: false })
        .limit(8);

      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const unreadCount = alerts.filter((a: any) => !a.read_at).length;
  const criticalCount = alerts.filter((a: any) => a.severity === "CRITICAL").length;

  if (isLoading) return null;
  if (alerts.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Alertas de hoy
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {unreadCount} nuevas
              </Badge>
            )}
            {criticalCount > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {criticalCount} críticas
              </Badge>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/app/alerts" className="text-xs gap-1">
              Ver todas <ChevronRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {alerts.slice(0, 5).map((alert: any) => {
            const typeLabel = ALERT_TYPE_LABELS[alert.type as UserAlertType] || alert.type;
            const isCritical = alert.severity === "CRITICAL";

            return (
              <div
                key={alert.id}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-md text-sm",
                  !alert.read_at ? "bg-primary/5" : "",
                  isCritical && "border border-destructive/20"
                )}
              >
                {isCritical && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                {!alert.read_at && !isCritical && (
                  <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                )}
                <Badge variant="outline" className="text-[10px] shrink-0">{typeLabel}</Badge>
                <span className="truncate flex-1 text-xs">{alert.title}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: es })}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
