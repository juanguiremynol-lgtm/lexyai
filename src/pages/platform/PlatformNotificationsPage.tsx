/**
 * Platform Notifications Page
 * Real-time feed of platform events: signups, payments, subscription changes, etc.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bell,
  UserPlus,
  CreditCard,
  Building2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  RefreshCw,
  Filter,
  Inbox,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

const EVENT_CONFIG: Record<string, { icon: typeof Bell; color: string; label: string }> = {
  USER_SIGNUP: { icon: UserPlus, color: "text-emerald-400", label: "Registro" },
  PAYMENT_RECEIVED: { icon: CreditCard, color: "text-cyan-400", label: "Pago" },
  SUBSCRIPTION_CHANGED: { icon: AlertTriangle, color: "text-amber-400", label: "Suscripción" },
  ORG_CREATED: { icon: Building2, color: "text-blue-400", label: "Organización" },
  TRIAL_STARTED: { icon: Clock, color: "text-purple-400", label: "Trial" },
  TRIAL_EXPIRED: { icon: AlertTriangle, color: "text-orange-400", label: "Trial Exp." },
  VOUCHER_REDEEMED: { icon: CheckCircle2, color: "text-green-400", label: "Voucher" },
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "border-white/10 bg-white/5",
  warning: "border-amber-500/30 bg-amber-500/5",
  critical: "border-red-500/30 bg-red-500/5",
};

interface PlatformNotification {
  id: string;
  event_type: string;
  title: string;
  message: string;
  severity: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  organization_id: string | null;
  user_id: string | null;
  created_at: string;
}

export default function PlatformNotificationsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [showRead, setShowRead] = useState(false);

  // Fetch notifications
  const { data: notifications, isLoading } = useQuery({
    queryKey: ["platform-notifications", filter, showRead],
    queryFn: async () => {
      let query = supabase
        .from("platform_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (filter !== "all") {
        query = query.eq("event_type", filter);
      }
      if (!showRead) {
        query = query.eq("is_read", false);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as PlatformNotification[];
    },
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("platform-notifications-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "platform_notifications" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["platform-notifications"] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Mark as read
  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("platform_notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-notifications"] });
    },
  });

  // Mark all as read
  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("platform_notifications")
        .update({ is_read: true })
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-notifications"] });
      toast.success("Todas las notificaciones marcadas como leídas");
    },
  });

  const unreadCount = notifications?.filter((n) => !n.is_read).length || 0;

  return (
    <div className="space-y-6">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-semibold text-white">Notificaciones de Plataforma</h2>
          {unreadCount > 0 && (
            <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
              {unreadCount} sin leer
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRead(!showRead)}
            className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
          >
            {showRead ? <EyeOff className="h-3.5 w-3.5 mr-1.5" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
            {showRead ? "Ocultar leídas" : "Mostrar leídas"}
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Marcar todas
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["platform-notifications"] })}
            className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white h-8 w-8"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-white/40" />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48 border-white/10 bg-white/5 text-white/80">
            <SelectValue placeholder="Filtrar por tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los eventos</SelectItem>
            <SelectItem value="USER_SIGNUP">Registros</SelectItem>
            <SelectItem value="PAYMENT_RECEIVED">Pagos</SelectItem>
            <SelectItem value="SUBSCRIPTION_CHANGED">Suscripciones</SelectItem>
            <SelectItem value="ORG_CREATED">Organizaciones</SelectItem>
            <SelectItem value="TRIAL_STARTED">Trials</SelectItem>
            <SelectItem value="VOUCHER_REDEEMED">Vouchers</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Notifications list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full bg-white/5" />
          ))}
        </div>
      ) : notifications && notifications.length > 0 ? (
        <div className="space-y-2">
          {notifications.map((notif) => {
            const config = EVENT_CONFIG[notif.event_type] || { icon: Bell, color: "text-white/50", label: notif.event_type };
            const Icon = config.icon;
            const severityStyle = SEVERITY_STYLES[notif.severity] || SEVERITY_STYLES.info;

            return (
              <div
                key={notif.id}
                className={`flex items-start gap-4 p-4 rounded-lg border transition-all ${severityStyle} ${
                  !notif.is_read ? "ring-1 ring-cyan-500/20" : "opacity-70"
                }`}
              >
                <div className={`mt-0.5 ${config.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={`text-[10px] border-white/15 ${config.color} bg-transparent`}>
                      {config.label}
                    </Badge>
                    {notif.severity === "critical" && (
                      <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-[10px]">CRÍTICO</Badge>
                    )}
                    {notif.severity === "warning" && (
                      <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">ALERTA</Badge>
                    )}
                    {!notif.is_read && (
                      <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                    )}
                  </div>
                  <p className="text-sm font-medium text-white/90">{notif.title}</p>
                  <p className="text-xs text-white/50 mt-0.5">{notif.message}</p>
                  {notif.metadata && Object.keys(notif.metadata).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {notif.metadata.email && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/40 font-mono">
                          {String(notif.metadata.email)}
                        </span>
                      )}
                      {notif.metadata.org_name && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/40">
                          Org: {String(notif.metadata.org_name)}
                        </span>
                      )}
                      {notif.metadata.auth_provider && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/40">
                          vía {String(notif.metadata.auth_provider)}
                        </span>
                      )}
                      {notif.metadata.old_status && notif.metadata.new_status && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/40">
                          {String(notif.metadata.old_status)} → {String(notif.metadata.new_status)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className="text-[10px] text-white/30 font-mono">
                    {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: es })}
                  </span>
                  {!notif.is_read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markRead.mutate(notif.id)}
                      className="text-white/30 hover:text-white/70 h-6 px-2 text-[10px]"
                    >
                      Marcar leída
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-white/30">
          <Inbox className="h-12 w-12 mb-3 opacity-50" />
          <p className="text-sm">No hay notificaciones {!showRead ? "sin leer" : ""}</p>
          <p className="text-xs mt-1">Los eventos de plataforma aparecerán aquí en tiempo real</p>
        </div>
      )}
    </div>
  );
}
