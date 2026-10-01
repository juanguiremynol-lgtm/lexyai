/**
 * AlertsByTypeTab — main alert board.
 *
 * Groups active alerts by type. Each row offers explicit management actions
 * (Marcar leída / Resolver / Descartar / Ver); each group offers the same
 * actions over its visible rows; rows can be selected for bulk actions.
 * Rows are never hard-deleted: closing keeps the row for traceability.
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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  Eye,
  ExternalLink,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  markAlertsAsRead,
  resolveAlerts,
  dismissAlerts,
  invalidateAlertSurfaces,
  markAlertsReadInCaches,
  removeAlertsFromCaches,
  snapshotAlertLists,
  restoreAlertLists,
} from "@/lib/alerts";
import { groupAlertsByType, alertTypeLabel, isActionableSeverity } from "@/lib/alerts/doctrine";
import { AlertBulkConfirmDialog } from "./AlertBulkConfirmDialog";
import { AlertsBulkActionsBar } from "./AlertsBulkActionsBar";

export interface BoardAlert {
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
  seen_at?: string | null;
  payload?: Record<string, unknown> | null;
}

const ACTIVE = ["PENDING", "SENT", "ACKNOWLEDGED"];

/** Pure list filter: "leída" and "accionable" are independent; closed rows never show. */
export function filterBoardAlerts(
  alerts: BoardAlert[],
  opts: { onlyActionable: boolean; onlyUnread: boolean },
): BoardAlert[] {
  return alerts.filter(
    (a) =>
      ACTIVE.includes(a.status) &&
      (!opts.onlyActionable || isActionableSeverity(a.severity)) &&
      (!opts.onlyUnread || !a.read_at),
  );
}

type CloseAction = "resolve" | "dismiss";

export function AlertsByTypeTab() {
  const queryClient = useQueryClient();
  const [onlyActionable, setOnlyActionable] = useState(true);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ action: CloseAction | "markRead"; ids: string[] } | null>(null);

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["alerts-by-type"],
    queryFn: async (): Promise<BoardAlert[]> => {
      const { data, error } = await supabase
        .from("alert_instances")
        .select(
          "id, entity_id, entity_type, alert_type, severity, status, title, message, fired_at, read_at, seen_at, payload",
        )
        .in("status", ACTIVE)
        .order("fired_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as BoardAlert[];
    },
    staleTime: 30_000,
  });

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await markAlertsAsRead(ids);
      if (!res.success) throw new Error(res.error);
      return res.count ?? 0;
    },
    onMutate: (ids) => markAlertsReadInCaches(queryClient, ids),
    onSuccess: (count) => {
      toast.success(`${count} alerta(s) marcada(s) como leída(s)`);
      setSelected(new Set());
      setConfirm(null);
    },
    onError: (e: Error) => toast.error(e.message || "No fue posible marcar como leídas"),
    onSettled: () => invalidateAlertSurfaces(queryClient),
  });

  const close = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: CloseAction }) => {
      const res = action === "resolve" ? await resolveAlerts(ids) : await dismissAlerts(ids);
      if (!res.success) throw new Error(res.error);
      return { count: res.count ?? 0, action };
    },
    onMutate: async ({ ids }) => {
      const snap = await snapshotAlertLists(queryClient);
      removeAlertsFromCaches(queryClient, ids);
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      return { snap };
    },
    onSuccess: ({ count, action }) => {
      toast.success(
        action === "resolve"
          ? `${count} alerta(s) resuelta(s)`
          : `${count} alerta(s) descartada(s)`,
      );
      setConfirm(null);
    },
    onError: (e: Error, _v, ctx) => {
      restoreAlertLists(queryClient, ctx?.snap);
      toast.error(e.message || "No fue posible actualizar las alertas");
    },
    onSettled: () => invalidateAlertSurfaces(queryClient),
  });

  const visible = useMemo(
    () => filterBoardAlerts(alerts, { onlyActionable, onlyUnread }),
    [alerts, onlyActionable, onlyUnread],
  );
  const groups = useMemo(() => groupAlertsByType(visible), [visible]);
  const unreadTotal = visible.filter((a) => !a.read_at).length;
  const visibleIds = visible.map((a) => a.id);
  const selectedIds = visibleIds.filter((id) => selected.has(id));
  const busy = markRead.isPending || close.isPending;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Single rows act immediately; several rows ask for confirmation. */
  const requestClose = (action: CloseAction, ids: string[]) => {
    if (ids.length === 0) return;
    if (ids.length === 1) close.mutate({ ids, action });
    else setConfirm({ action, ids });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Bell className="h-5 w-5" />
            Alertas por tipo ({visible.length})
            {unreadTotal > 0 && (
              <Badge variant="secondary" className="font-normal">
                {unreadTotal} sin leer
              </Badge>
            )}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <Switch id="only-unread" checked={onlyUnread} onCheckedChange={setOnlyUnread} />
              <Label htmlFor="only-unread" className="text-sm text-muted-foreground">
                Solo sin leer
              </Label>
            </div>
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
        </div>
        {visible.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Marque las casillas para gestionar varias alertas a la vez. <strong>Resolver</strong>: ya
            fue atendida. <strong>Descartar</strong>: no requiere atención. Ambas conservan el
            historial.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Cargando...</div>
        ) : groups.length === 0 ? (
          <div className="py-12 text-center">
            <Check className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">
              {onlyUnread ? "No hay alertas sin leer" : "Sin alertas que requieran decisión"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Las novedades ingestadas se consultan en la Línea procesal de cada expediente.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const groupAlerts = group.alerts as BoardAlert[];
              const ids = groupAlerts.map((a) => a.id);
              const unreadIds = groupAlerts.filter((a) => !a.read_at).map((a) => a.id);
              const allSelected = ids.every((id) => selected.has(id));
              return (
                <Collapsible key={group.type} defaultOpen>
                  <div className="rounded-lg border" data-testid={`alert-group-${group.type}`}>
                    <div className="flex min-w-0 flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
                              return next;
                            })
                          }
                          aria-label={`Seleccionar grupo ${group.label}`}
                        />
                        <CollapsibleTrigger className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="break-words font-medium">{group.label}</span>
                          <Badge variant="secondary">{group.count}</Badge>
                          {group.criticalCount > 0 && (
                            <Badge variant="destructive">{group.criticalCount} críticas</Badge>
                          )}
                        </CollapsibleTrigger>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {unreadIds.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markRead.mutate(unreadIds)}
                            disabled={busy}
                          >
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            Marcar grupo como leído
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => requestClose("resolve", ids)}
                          disabled={busy}
                        >
                          <CheckCheck className="mr-1 h-3.5 w-3.5" />
                          Resolver grupo
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => requestClose("dismiss", ids)}
                          disabled={busy}
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
                          Descartar grupo
                        </Button>
                      </div>
                    </div>
                    <CollapsibleContent>
                      <div className="space-y-2 border-t p-3">
                        {groupAlerts.map((alert) => {
                          const radicado =
                            (alert.payload?.radicado as string | undefined) ?? null;
                          const isCritical = alert.severity?.toUpperCase() === "CRITICAL";
                          const isRead = !!alert.read_at;
                          return (
                            <div
                              key={alert.id}
                              data-testid="alert-row"
                              className={cn(
                                "flex min-w-0 flex-col gap-2 rounded-md border p-3 text-sm md:flex-row md:items-start",
                                !isRead && "bg-muted/50",
                                isCritical && "border-destructive/30",
                                selected.has(alert.id) && "ring-2 ring-primary",
                              )}
                            >
                              <div className="flex min-w-0 flex-1 items-start gap-3">
                                <Checkbox
                                  className="mt-0.5"
                                  checked={selected.has(alert.id)}
                                  onCheckedChange={() => toggle(alert.id)}
                                  aria-label={`Seleccionar alerta: ${alert.title}`}
                                />
                                {isCritical && (
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="break-words font-medium">{alert.title}</p>
                                  {alert.message && (
                                    <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                                      {alert.message}
                                    </p>
                                  )}
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                    <Badge variant="outline" className="text-[10px]">
                                      {alertTypeLabel(alert.alert_type)}
                                    </Badge>
                                    {isRead ? (
                                      <Badge variant="secondary" className="gap-1 text-[10px]">
                                        <Check className="h-3 w-3" /> Leída
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-[10px]">
                                        Sin leer
                                      </Badge>
                                    )}
                                    {radicado && <span className="break-all font-mono">{radicado}</span>}
                                    <span>
                                      {formatDistanceToNow(new Date(alert.fired_at), {
                                        addSuffix: true,
                                        locale: es,
                                      })}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-1 pl-7 md:shrink-0 md:pl-0">
                                {!isRead && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => markRead.mutate([alert.id])}
                                    disabled={busy}
                                  >
                                    <Eye className="mr-1 h-3.5 w-3.5" />
                                    Marcar leída
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8"
                                  onClick={() => requestClose("resolve", [alert.id])}
                                  disabled={busy}
                                >
                                  <CheckCheck className="mr-1 h-3.5 w-3.5" />
                                  Resolver
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-destructive hover:text-destructive"
                                  onClick={() => requestClose("dismiss", [alert.id])}
                                  disabled={busy}
                                >
                                  <X className="mr-1 h-3.5 w-3.5" />
                                  Descartar
                                </Button>
                                {alert.entity_type === "WORK_ITEM" && (
                                  <Button variant="ghost" size="sm" className="h-8" asChild>
                                    <Link to={`/app/work-items/${alert.entity_id}`}>
                                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                                      Ver
                                    </Link>
                                  </Button>
                                )}
                              </div>
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

      <AlertsBulkActionsBar
        selectedCount={selectedIds.length}
        onSelectAll={() => setSelected(new Set(visibleIds))}
        onClearSelection={() => setSelected(new Set())}
        onBulkMarkRead={() => setConfirm({ action: "markRead", ids: selectedIds })}
        onBulkResolve={() => requestClose("resolve", selectedIds)}
        onBulkDismiss={() => requestClose("dismiss", selectedIds)}
        isMarkingRead={markRead.isPending}
        isResolving={close.isPending}
        isDismissing={close.isPending}
      />

      {confirm && (
        <AlertBulkConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          count={confirm.ids.length}
          action={confirm.action}
          isProcessing={busy}
          onConfirm={() =>
            confirm.action === "markRead"
              ? markRead.mutate(confirm.ids)
              : close.mutate({ ids: confirm.ids, action: confirm.action })
          }
        />
      )}
    </Card>
  );
}
