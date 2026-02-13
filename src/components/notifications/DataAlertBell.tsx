/**
 * DataAlertBell — User-facing notification bell for stale data alerts.
 * Capability 5C: Shows unread alerts about freshness violations.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

export function DataAlertBell() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  const queryClient = useQueryClient();

  const { data: alerts } = useQuery({
    queryKey: ["user-data-alerts", userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await (supabase
        .from("user_data_alerts") as any)
        .select("*")
        .eq("user_id", userId)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!userId,
    refetchOnWindowFocus: false,
    refetchInterval: 5 * 60 * 1000,
  });

  const markRead = useMutation({
    mutationFn: async (alertId: string) => {
      await (supabase.from("user_data_alerts") as any)
        .update({ is_read: true })
        .eq("id", alertId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-data-alerts"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      await (supabase.from("user_data_alerts") as any)
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-data-alerts"] });
    },
  });

  const unreadCount = alerts?.length ?? 0;

  if (!userId) return null;

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
        return <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />;
      case "WARNING":
        return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
      default:
        return <Info className="h-4 w-4 text-muted-foreground shrink-0" />;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px]"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="text-sm font-semibold">Alertas de Datos</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => markAllRead.mutate()}
            >
              Marcar todo leído
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {unreadCount === 0 ? (
            <div className="p-6 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Sin alertas pendientes ✅
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {(alerts ?? []).map((alert: any) => (
                <button
                  key={alert.id}
                  onClick={() => markRead.mutate(alert.id)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex gap-3"
                >
                  {severityIcon(alert.severity)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">{alert.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(alert.created_at), {
                        addSuffix: true,
                        locale: es,
                      })}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
