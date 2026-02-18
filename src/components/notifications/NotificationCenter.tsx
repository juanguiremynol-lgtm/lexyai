/**
 * NotificationCenter — Single unified notification bell + panel
 *
 * Replaces: AdminNotificationBell, DataAlertBell, and the generic Bell in TopBar.
 * Content is role-adaptive: RLS on `notifications` ensures only visible items are returned.
 * Tabs inside the panel change based on role (USER / ORG_ADMIN / SUPER_ADMIN).
 */

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  CheckCheck,
  Scale,
  FileText,
  Building2,
  Wifi,
  ShieldAlert,
  Bug,
  Eye,
  Wrench,
  Gavel,
  ClipboardList,
  CalendarDays,
  Timer,
  Flag,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  useNotifications,
  type Notification,
  type NotificationCategory,
} from "@/hooks/use-notifications";
import { useNavigate } from "react-router-dom";
import { ALERT_TYPE_LABELS, type UserAlertType } from "@/lib/alerts/create-user-alert";

// ── Alert type badge color mapping ──
const ALERT_TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  ACTUACION_NUEVA: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  ESTADO_NUEVO: { bg: 'bg-cyan-500/15', text: 'text-cyan-400' },
  STAGE_CHANGE: { bg: 'bg-purple-500/15', text: 'text-purple-400' },
  TAREA_CREADA: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  TAREA_VENCIDA: { bg: 'bg-red-500/15', text: 'text-red-400' },
  AUDIENCIA_PROXIMA: { bg: 'bg-amber-500/15', text: 'text-amber-400' },
  AUDIENCIA_CREADA: { bg: 'bg-amber-500/15', text: 'text-amber-400' },
  TERMINO_CRITICO: { bg: 'bg-red-500/15', text: 'text-red-400' },
  TERMINO_VENCIDO: { bg: 'bg-red-500/15', text: 'text-red-400' },
  PETICION_CREADA: { bg: 'bg-indigo-500/15', text: 'text-indigo-400' },
  HITO_ALCANZADO: { bg: 'bg-green-500/15', text: 'text-green-400' },
};

function AlertTypeBadge({ type }: { type: string }) {
  const label = ALERT_TYPE_LABELS[type as UserAlertType] || type;
  const style = ALERT_TYPE_STYLES[type] || { bg: 'bg-muted', text: 'text-muted-foreground' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${style.bg} ${style.text}`}>
      {label}
    </span>
  );
}

// ── Severity icon mapping ──
function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case "CRITICAL":
      return <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />;
    case "WARNING":
      return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
    default:
      return <Info className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

// ── Category icon mapping ──
function CategoryIcon({ category }: { category: NotificationCategory }) {
  const iconClass = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  switch (category) {
    case "TERMS":
      return <Scale className={iconClass} />;
    case "WORK_ITEM_ALERTS":
      return <FileText className={iconClass} />;
    case "ORG_ACTIVITY":
      return <Building2 className={iconClass} />;
    case "OPS_SYNC":
      return <Wifi className={iconClass} />;
    case "OPS_INCIDENTS":
      return <ShieldAlert className={iconClass} />;
    case "OPS_E2E":
      return <Bug className={iconClass} />;
    case "OPS_WATCHDOG":
      return <Eye className={iconClass} />;
    case "OPS_REMEDIATION":
      return <Wrench className={iconClass} />;
    default:
      return <Info className={iconClass} />;
  }
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<NotificationCategory | "ALL">("ALL");
  const navigate = useNavigate();

  const {
    notifications,
    unreadCount,
    effectiveRole,
    tabs,
    markRead,
    markAllRead,
    dismiss,
  } = useNotifications({ categoryFilter: activeTab });

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read
    if (!notification.read_at) {
      markRead.mutate(notification.id);
    }
    // Navigate to deep link if available
    if (notification.deep_link) {
      setOpen(false);
      navigate(notification.deep_link);
    }
  };

  const handleDismiss = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    dismiss.mutate(id);
  };

  // Role badge for the panel header
  const roleBadgeLabel = effectiveRole === 'SUPER_ADMIN' 
    ? 'Ops' 
    : effectiveRole === 'ORG_ADMIN' 
      ? 'Admin' 
      : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative flex-shrink-0"
          aria-label="Notificaciones"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[380px] p-0" align="end" sideOffset={8}>
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">Notificaciones</h4>
            {roleBadgeLabel && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                {roleBadgeLabel}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 gap-1"
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="h-3 w-3" />
              Marcar todo leído
            </Button>
          )}
        </div>

        {/* ── Tabs (role-adaptive) ── */}
        {tabs.length > 2 && (
          <div className="px-2 pt-2">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as NotificationCategory | "ALL")}
            >
              <TabsList className="w-full h-8">
                {tabs.map((tab) => (
                  <TabsTrigger
                    key={tab.key}
                    value={tab.key}
                    className="text-xs flex-1 h-7"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}

        {/* ── Notification list ── */}
        <ScrollArea className="max-h-[360px]">
          {notifications.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Sin notificaciones pendientes
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex gap-3 group ${
                    !n.read_at ? "bg-primary/5" : ""
                  }`}
                >
                  <SeverityIcon severity={n.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <CategoryIcon category={n.category} />
                      {n.type && ALERT_TYPE_LABELS[n.type as UserAlertType] && (
                        <AlertTypeBadge type={n.type} />
                      )}
                      <span className="text-sm font-medium leading-snug line-clamp-1">
                        {n.title}
                      </span>
                      {!n.read_at && (
                        <span className="inline-block h-2 w-2 rounded-full bg-primary shrink-0" />
                      )}
                    </div>
                    {n.body && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {n.body}
                      </p>
                    )}
                    {n.metadata && typeof n.metadata === 'object' && (n.metadata as any).aggregated_count > 1 && (
                      <span className="text-[10px] text-primary/70 font-medium mt-0.5 inline-block">
                        +{(n.metadata as any).aggregated_count - 1} evento(s) más
                      </span>
                    )}
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                        locale: es,
                      })}
                    </p>
                  </div>
                  {/* Dismiss button */}
                  <button
                    onClick={(e) => handleDismiss(e, n.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded shrink-0 self-start"
                    aria-label="Descartar"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
