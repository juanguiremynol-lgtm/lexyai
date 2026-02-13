/**
 * AteniaActionFeed — Live action feed with PLANNED action approval buttons.
 * Enhanced: pins pending approvals, shows repeat counts, collapses E2E batches.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Bot, RefreshCw, Zap, Eye, Pause, RotateCcw, Scissors, AlertTriangle,
  Check, X, Clock, Loader2, Play, ChevronDown, ChevronRight, FlaskConical,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

interface Props {
  organizationId: string;
}

const ACTION_ICONS: Record<string, typeof Zap> = {
  RETRY_ENQUEUE: RotateCcw,
  SUSPEND_MONITORING: Pause,
  SPLIT_HEAVY_SYNC: Scissors,
  DAILY_CONTINUATION: Play,
  DEMOTE_PROVIDER_ROUTE: AlertTriangle,
  TRIGGER_CORRECTIVE_SYNC: RefreshCw,
  PROVIDER_E2E_BATCH: FlaskConical,
  heartbeat_observe: Eye,
};

function statusBadge(status: string | null, actionResult: string | null) {
  const s = status || actionResult || "unknown";
  switch (s) {
    case "EXECUTED":
    case "applied":
    case "triggered":
      return <Badge variant="default" className="text-[10px]"><Check className="h-2.5 w-2.5 mr-0.5" />Ejecutada</Badge>;
    case "PLANNED":
    case "pending_approval":
      return <Badge variant="secondary" className="text-[10px]"><Clock className="h-2.5 w-2.5 mr-0.5" />Pendiente</Badge>;
    case "SKIPPED":
      return <Badge variant="outline" className="text-[10px]">Omitida</Badge>;
    case "FAILED":
    case "failed":
      return <Badge variant="destructive" className="text-[10px]">Falló</Badge>;
    case "APPROVED":
      return <Badge variant="default" className="text-[10px]"><Check className="h-2.5 w-2.5 mr-0.5" />Aprobada</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{s}</Badge>;
  }
}

export function AteniaActionFeed({ organizationId }: Props) {
  const [hoursBack, setHoursBack] = useState(24);
  const queryClient = useQueryClient();

  const { data: actions, isLoading } = useQuery({
    queryKey: ["atenia-action-feed", organizationId, hoursBack],
    queryFn: async () => {
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
      const { data } = await (supabase
        .from("atenia_ai_actions") as any)
        .select("id, action_type, actor, reasoning, action_result, status, evidence, work_item_id, provider, created_at")
        .eq("organization_id", organizationId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const handleApprove = async (actionId: string) => {
    try {
      await (supabase
        .from("atenia_ai_actions") as any)
        .update({ action_result: "applied", status: "APPROVED" })
        .eq("id", actionId);
      toast.success("Acción aprobada");
      queryClient.invalidateQueries({ queryKey: ["atenia-action-feed"] });
    } catch {
      toast.error("Error al aprobar");
    }
  };

  const handleReject = async (actionId: string) => {
    try {
      await (supabase
        .from("atenia_ai_actions") as any)
        .update({ action_result: "rejected", status: "SKIPPED" })
        .eq("id", actionId);
      toast.info("Acción rechazada");
      queryClient.invalidateQueries({ queryKey: ["atenia-action-feed"] });
    } catch {
      toast.error("Error al rechazar");
    }
  };

  // Split actions: pending approval pinned at top, rest below
  const pendingApproval = (actions || []).filter(
    (a: any) => a.status === "PLANNED" || a.action_result === "pending_approval"
  );
  const recentActions = (actions || []).filter(
    (a: any) => a.status !== "PLANNED" && a.action_result !== "pending_approval"
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            Últimas acciones de Atenia AI
          </CardTitle>
          <Select value={String(hoursBack)} onValueChange={(v) => setHoursBack(Number(v))}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">Últimas 24h</SelectItem>
              <SelectItem value="72">Últimas 72h</SelectItem>
              <SelectItem value="168">Última semana</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !actions || actions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No hay acciones registradas en este período.
          </p>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {/* Pinned: Pending approval */}
            {pendingApproval.length > 0 && (
              <div className="border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {pendingApproval.length} acción(es) pendiente(s) de aprobación
                </div>
                {pendingApproval.map((action: any) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    isPending
                  />
                ))}
              </div>
            )}

            {/* Recent actions */}
            {recentActions.map((action: any) => (
              <ActionRow
                key={action.id}
                action={action}
                onApprove={handleApprove}
                onReject={handleReject}
                isPending={false}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActionRow({
  action,
  onApprove,
  onReject,
  isPending,
}: {
  action: any;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ACTION_ICONS[action.action_type] || Zap;
  const repeatCount = action.evidence?.repeat_count ?? 0;
  const isE2EBatch = action.action_type === 'PROVIDER_E2E_BATCH';
  const e2eTests = isE2EBatch ? (action.evidence?.tests || []) : [];
  const e2ePassed = e2eTests.filter((t: any) => t.result === 'PASSED').length;
  const e2eFailed = e2eTests.length - e2ePassed;

  return (
    <div className="flex items-start gap-2 border-b pb-2 last:border-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground mt-1 shrink-0" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
            {action.action_type}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(action.created_at), { addSuffix: true, locale: es })}
          </span>
          {statusBadge(action.status, action.action_result)}
          {repeatCount > 1 && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              ×{repeatCount} · Última: {action.evidence?.last_seen
                ? formatDistanceToNow(new Date(action.evidence.last_seen), { addSuffix: true, locale: es })
                : '—'}
            </Badge>
          )}
        </div>
        {action.provider && (
          <Badge variant="outline" className="text-[9px]">
            Proveedor: {action.provider}
          </Badge>
        )}

        {/* E2E batch: expandable summary */}
        {isE2EBatch ? (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              E2E: {e2ePassed}✅ {e2eFailed}❌ / {e2eTests.length}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 space-y-0.5 ml-4">
              {e2eTests.map((t: any, i: number) => (
                <p key={i} className={`text-[10px] font-mono ${t.result === 'PASSED' ? 'text-green-600' : 'text-destructive'}`}>
                  {t.result === 'PASSED' ? '✅' : '❌'} {t.radicado} {t.latency_ms ? `(${t.latency_ms}ms)` : ''}
                </p>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <p className="text-xs text-muted-foreground">
            {action.reasoning?.substring(0, 200)}{action.reasoning?.length > 200 ? "…" : ""}
          </p>
        )}

        {isPending && (
          <div className="flex gap-2 mt-1">
            <Button size="sm" variant="default" className="h-6 text-xs" onClick={() => onApprove(action.id)}>
              ✅ Aprobar
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => onReject(action.id)}>
              ❌ Rechazar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
