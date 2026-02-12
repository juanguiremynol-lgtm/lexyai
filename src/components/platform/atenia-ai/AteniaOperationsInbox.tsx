/**
 * AteniaOperationsInbox — Incident conversation list with filters
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Inbox, Loader2, AlertTriangle, CheckCircle2, Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface Props {
  organizationId: string;
  onSelectConversation: (id: string) => void;
}

const SEVERITY_ICONS: Record<string, { icon: string; className: string }> = {
  CRITICAL: { icon: "🔴", className: "text-destructive" },
  WARNING: { icon: "🟡", className: "text-yellow-600" },
  INFO: { icon: "✅", className: "text-green-600" },
};

const CHANNEL_LABELS: Record<string, string> = {
  HEARTBEAT: "Heartbeat",
  DAILY_SYNC: "Sync Diario",
  USER_REPORT: "Reporte",
  SYSTEM: "Sistema",
  ADMIN_PANEL: "Admin",
  USER_CHAT: "Chat",
};

export function AteniaOperationsInbox({ organizationId, onSelectConversation }: Props) {
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [hoursBack, setHoursBack] = useState(168); // 7 days default

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["atenia-conversations", organizationId, statusFilter, severityFilter, channelFilter, hoursBack],
    queryFn: async () => {
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
      let query = (supabase.from("atenia_ai_conversations") as any)
        .select("*")
        .gte("created_at", since)
        .order("last_activity_at", { ascending: false })
        .limit(50);

      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (severityFilter !== "all") query = query.eq("severity", severityFilter);
      if (channelFilter !== "all") query = query.eq("channel", channelFilter);

      const { data } = await query;
      return data || [];
    },
    refetchInterval: 30_000,
  });

  const pendingCount = conversations?.filter(
    (c: any) => c.status === "OPEN" && c.severity === "CRITICAL"
  ).length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            Operaciones de Atenia AI
            {pendingCount > 0 && (
              <Badge variant="destructive" className="text-[10px] ml-1">
                {pendingCount} críticos
              </Badge>
            )}
          </CardTitle>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <Select value={String(hoursBack)} onValueChange={(v) => setHoursBack(Number(v))}>
            <SelectTrigger className="w-[110px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">24h</SelectItem>
              <SelectItem value="168">7 días</SelectItem>
              <SelectItem value="720">30 días</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[110px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="OPEN">Abiertos</SelectItem>
              <SelectItem value="RESOLVED">Resueltos</SelectItem>
              <SelectItem value="MUTED">Silenciados</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-[100px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Severidad</SelectItem>
              <SelectItem value="CRITICAL">Crítico</SelectItem>
              <SelectItem value="WARNING">Aviso</SelectItem>
              <SelectItem value="INFO">Info</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-[110px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Canal</SelectItem>
              <SelectItem value="HEARTBEAT">Heartbeat</SelectItem>
              <SelectItem value="DAILY_SYNC">Sync Diario</SelectItem>
              <SelectItem value="USER_REPORT">Reporte</SelectItem>
              <SelectItem value="SYSTEM">Sistema</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !conversations || conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No hay incidentes en este período.
          </p>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {conversations.map((conv: any) => {
              const sev = SEVERITY_ICONS[conv.severity] || SEVERITY_ICONS.INFO;
              return (
                <button
                  key={conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                  className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm">{sev.icon}</span>
                        <span className="text-sm font-medium truncate">{conv.title}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-[9px] px-1">
                          {CHANNEL_LABELS[conv.channel] || conv.channel}
                        </Badge>
                        {conv.observation_count > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {conv.observation_count} obs
                          </span>
                        )}
                        {conv.action_count > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {conv.action_count} acc
                          </span>
                        )}
                        {conv.message_count > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {conv.message_count} msg
                          </span>
                        )}
                        {conv.related_providers?.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {conv.related_providers.join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(conv.last_activity_at), {
                          addSuffix: true,
                          locale: es,
                        })}
                      </span>
                      <Badge
                        variant={conv.status === "OPEN" ? "secondary" : conv.status === "RESOLVED" ? "default" : "outline"}
                        className="text-[9px]"
                      >
                        {conv.status}
                      </Badge>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
