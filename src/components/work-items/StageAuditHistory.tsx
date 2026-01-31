/**
 * Stage Audit History Component
 * 
 * Displays a verifiable audit trail of all stage changes for a work item.
 * Shows whether changes were made by user action or system suggestion acceptance.
 * Designed for legal compliance verification.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  History, 
  User, 
  Bot, 
  ArrowRight, 
  Clock,
  CheckCircle,
  XCircle,
  Edit3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { 
  getStageAuditHistory, 
  getChangeSourceLabel,
  involvesSuggestion,
  type StageAuditRecord,
  type StageChangeSource,
} from "@/lib/stage-audit";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface StageAuditHistoryProps {
  workItemId: string;
  className?: string;
}

const SOURCE_ICONS: Record<StageChangeSource, React.ReactNode> = {
  MANUAL_USER: <User className="h-4 w-4" />,
  SUGGESTION_APPLIED: <CheckCircle className="h-4 w-4" />,
  SUGGESTION_OVERRIDE: <Edit3 className="h-4 w-4" />,
  IMPORT_INITIAL: <Bot className="h-4 w-4" />,
};

const SOURCE_COLORS: Record<StageChangeSource, string> = {
  MANUAL_USER: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  SUGGESTION_APPLIED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  SUGGESTION_OVERRIDE: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  IMPORT_INITIAL: "bg-muted text-muted-foreground border-border",
};

export function StageAuditHistory({ workItemId, className }: StageAuditHistoryProps) {
  const { data: auditRecords, isLoading } = useQuery({
    queryKey: ["stage-audit-history", workItemId],
    queryFn: () => getStageAuditHistory(workItemId),
    staleTime: 60_000, // 1 minute
  });

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            Historial de Cambios de Etapa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Cargando...</div>
        </CardContent>
      </Card>
    );
  }

  if (!auditRecords || auditRecords.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            Historial de Cambios de Etapa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            No hay cambios de etapa registrados
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" />
          Historial de Cambios de Etapa
          <Badge variant="secondary" className="ml-auto">
            {auditRecords.length} cambios
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-3">
            {auditRecords.map((record) => (
              <AuditRecordItem key={record.id} record={record} />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function AuditRecordItem({ record }: { record: StageAuditRecord }) {
  const source = record.change_source as StageChangeSource;
  const hasSuggestion = involvesSuggestion(source);

  return (
    <div className="border rounded-lg p-3 space-y-2">
      {/* Header: Source + Time */}
      <div className="flex items-center justify-between">
        <Badge 
          variant="outline" 
          className={cn("gap-1", SOURCE_COLORS[source])}
        >
          {SOURCE_ICONS[source]}
          {getChangeSourceLabel(source)}
        </Badge>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatDistanceToNow(new Date(record.created_at), { 
            addSuffix: true,
            locale: es,
          })}
        </div>
      </div>

      {/* Stage transition */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground line-through">
          {record.previous_stage || 'Sin etapa'}
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{record.new_stage}</span>
      </div>

      {/* Suggestion info */}
      {hasSuggestion && record.suggestion_confidence !== null && (
        <div className="text-xs text-muted-foreground">
          Confianza de sugerencia: {Math.round(record.suggestion_confidence * 100)}%
        </div>
      )}

      {/* Reason */}
      {record.reason && (
        <div className="text-xs text-muted-foreground border-t pt-2">
          {record.reason}
        </div>
      )}

      {/* Audit ID for verification */}
      <div className="text-[10px] font-mono text-muted-foreground/60 border-t pt-1">
        ID: {record.id}
      </div>
    </div>
  );
}

/**
 * Compact inline version for embedding in detail views
 */
export function StageAuditBadge({ workItemId }: { workItemId: string }) {
  const { data: auditRecords } = useQuery({
    queryKey: ["stage-audit-history", workItemId],
    queryFn: () => getStageAuditHistory(workItemId),
    staleTime: 60_000,
  });

  const lastChange = auditRecords?.[0];
  if (!lastChange) return null;

  const source = lastChange.change_source as StageChangeSource;

  return (
    <Badge 
      variant="outline" 
      className={cn("gap-1 text-xs", SOURCE_COLORS[source])}
      title={`Último cambio: ${getChangeSourceLabel(source)}`}
    >
      {SOURCE_ICONS[source]}
      {source === 'SUGGESTION_APPLIED' ? 'Sugerencia' : 
       source === 'MANUAL_USER' ? 'Manual' : 
       source === 'SUGGESTION_OVERRIDE' ? 'Override' : 'Auto'}
    </Badge>
  );
}
