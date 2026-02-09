/**
 * AteniaActionsLog — Shows the atenia_ai_actions audit log with filters
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Eye, Lightbulb, Zap, Check, X, Clock, Loader2 } from "lucide-react";
import { fetchActions, approveAction, rejectAction, type AteniaAction } from "@/lib/services/atenia-ai-engine";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  organizationId: string;
}

function tierIcon(tier: string) {
  switch (tier) {
    case 'OBSERVE': return <Eye className="h-3.5 w-3.5 text-blue-500" />;
    case 'SUGGEST': return <Lightbulb className="h-3.5 w-3.5 text-amber-500" />;
    case 'ACT': return <Zap className="h-3.5 w-3.5 text-purple-500" />;
    default: return <Bot className="h-3.5 w-3.5" />;
  }
}

function tierLabel(tier: string) {
  switch (tier) {
    case 'OBSERVE': return 'OBSERVACIÓN';
    case 'SUGGEST': return 'SUGERENCIA';
    case 'ACT': return 'ACCIÓN';
    default: return tier;
  }
}

function resultBadge(result: string | null) {
  if (!result) return null;
  switch (result) {
    case 'applied': return <Badge variant="default" className="text-[10px]"><Check className="h-2.5 w-2.5 mr-0.5" />Aplicado</Badge>;
    case 'pending_approval': return <Badge variant="outline" className="text-[10px]"><Clock className="h-2.5 w-2.5 mr-0.5" />Pendiente</Badge>;
    case 'rejected': return <Badge variant="secondary" className="text-[10px]"><X className="h-2.5 w-2.5 mr-0.5" />Rechazado</Badge>;
    case 'failed': return <Badge variant="destructive" className="text-[10px]">Falló</Badge>;
    default: return <Badge variant="outline" className="text-[10px]">{result}</Badge>;
  }
}

export function AteniaActionsLog({ organizationId }: Props) {
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [hoursBack, setHoursBack] = useState(24);
  const queryClient = useQueryClient();

  const { data: actions, isLoading } = useQuery({
    queryKey: ['atenia-actions', organizationId, tierFilter, hoursBack],
    queryFn: () => fetchActions(organizationId, {
      tier: tierFilter === 'all' ? undefined : tierFilter,
      hoursBack,
    }),
    staleTime: 1000 * 60,
  });

  const handleApprove = async (action: AteniaAction) => {
    try {
      // If it's a stage suggestion, we need to apply the stage change
      // For now, just mark the action as approved
      await approveAction(action.id, 'current-user');
      toast.success('Acción aprobada');
      queryClient.invalidateQueries({ queryKey: ['atenia-actions'] });
    } catch {
      toast.error('Error al aprobar');
    }
  };

  const handleReject = async (action: AteniaAction) => {
    try {
      await rejectAction(action.id);
      toast.info('Acción rechazada');
      queryClient.invalidateQueries({ queryKey: ['atenia-actions'] });
    } catch {
      toast.error('Error al rechazar');
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            Acciones Autónomas de Atenia AI
          </CardTitle>
          <div className="flex gap-2">
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="OBSERVE">Observaciones</SelectItem>
                <SelectItem value="SUGGEST">Sugerencias</SelectItem>
                <SelectItem value="ACT">Acciones</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(hoursBack)} onValueChange={v => setHoursBack(Number(v))}>
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
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {actions.map((action) => (
              <div key={action.id} className="flex items-start gap-2 border-b pb-2 last:border-0">
                {tierIcon(action.autonomy_tier)}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {tierLabel(action.autonomy_tier)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(action.created_at), { addSuffix: true, locale: es })}
                    </span>
                    {resultBadge(action.action_result)}
                  </div>
                  <p className="text-sm">{action.reasoning.substring(0, 200)}{action.reasoning.length > 200 ? '...' : ''}</p>
                  {action.action_result === 'pending_approval' && (
                    <div className="flex gap-2 mt-1">
                      <Button size="sm" variant="default" className="h-6 text-xs" onClick={() => handleApprove(action)}>
                        Aprobar
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleReject(action)}>
                        Rechazar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
