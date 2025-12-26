/**
 * Terms Panel Component
 * 
 * Displays active terms, milestones, and alerts for a CGP filing or process.
 * Can be embedded in the pipeline card detail view.
 */

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Clock,
  AlertTriangle,
  Check,
  Pause,
  Play,
  Plus,
  ChevronDown,
  ChevronUp,
  Calendar,
  Gavel,
  FileText,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useCgpTermInstances,
  useCgpMilestones,
  useCgpTermsSummary,
  useSatisfyTerm,
  usePauseTerm,
  useResumeTerm,
} from "@/hooks/use-cgp-terms";
import {
  CgpTermInstance,
  CgpMilestone,
  MILESTONE_LABELS,
  TERM_STATUS_LABELS,
  getDaysRemaining,
  getTermUrgency,
} from "@/lib/cgp-terms-engine";
import { MilestoneWizard } from "./MilestoneWizard";

interface TermsPanelProps {
  filingId?: string;
  processId?: string;
  ownerId: string;
  compact?: boolean;
}

export function TermsPanel({ filingId, processId, ownerId, compact = false }: TermsPanelProps) {
  const [showMilestones, setShowMilestones] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  const { data: summary, isLoading: summaryLoading } = useCgpTermsSummary(filingId, processId);
  const { data: terms } = useCgpTermInstances(filingId, processId);
  const { data: milestones } = useCgpMilestones(filingId, processId);

  const satisfyTerm = useSatisfyTerm();
  const pauseTerm = usePauseTerm();
  const resumeTerm = useResumeTerm();

  if (summaryLoading) {
    return (
      <Card className="animate-pulse">
        <CardContent className="p-4">
          <div className="h-20 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  // Sort terms by urgency
  const sortedTerms = [...(terms || [])].sort((a, b) => {
    const statusOrder = { EXPIRED: 0, RUNNING: 1, PAUSED: 2, PENDING: 3, SATISFIED: 4, INTERRUPTED: 5, NOT_APPLICABLE: 6 };
    const orderA = statusOrder[a.status] ?? 99;
    const orderB = statusOrder[b.status] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  const runningTerms = sortedTerms.filter(t => t.status === 'RUNNING');
  const otherTerms = sortedTerms.filter(t => t.status !== 'RUNNING');

  return (
    <Card className={cn("border-l-4", {
      "border-l-red-500": summary?.urgencyLevel === 'expired' || summary?.urgencyLevel === 'critical',
      "border-l-amber-500": summary?.urgencyLevel === 'warning',
      "border-l-blue-500": summary?.urgencyLevel === 'normal',
      "border-l-muted": !summary?.urgencyLevel,
    })}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Gavel className="h-4 w-4" />
            Términos CGP
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowWizard(true)}
            className="h-7 text-xs"
          >
            <Plus className="h-3 w-3 mr-1" />
            Registrar Hito
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-2">
          <StatBadge
            label="Activos"
            value={summary?.runningTerms ?? 0}
            variant="blue"
          />
          <StatBadge
            label="Pausados"
            value={summary?.pausedTerms ?? 0}
            variant="amber"
          />
          <StatBadge
            label="Vencidos"
            value={summary?.expiredTerms ?? 0}
            variant="red"
          />
          <StatBadge
            label="Cumplidos"
            value={summary?.satisfiedTerms ?? 0}
            variant="green"
          />
        </div>

        {/* Next Due Alert */}
        {summary?.nextDueTerm && (
          <NextDueAlert
            term={summary.nextDueTerm}
            daysRemaining={summary.daysToNextDue ?? 0}
            urgency={summary.urgencyLevel ?? 'normal'}
          />
        )}

        {/* Incomplete Data Warning */}
        {summary?.hasIncompleteData && (
          <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span className="text-amber-700 dark:text-amber-400">
              Hay hitos sin fecha. Complete la información para calcular términos.
            </span>
          </div>
        )}

        {/* Running Terms List */}
        {!compact && runningTerms.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase">
              Términos Activos
            </h4>
            {runningTerms.map((term) => (
              <TermCard
                key={term.id}
                term={term}
                filingId={filingId}
                processId={processId}
                onSatisfy={(notes) =>
                  satisfyTerm.mutate({ termId: term.id, notes, filingId, processId })
                }
                onPause={(reason) =>
                  pauseTerm.mutate({ termId: term.id, reason, filingId, processId })
                }
                onResume={() =>
                  resumeTerm.mutate({ termId: term.id, filingId, processId })
                }
              />
            ))}
          </div>
        )}

        {/* Other Terms (Collapsible) */}
        {!compact && otherTerms.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span className="text-xs">
                  Otros términos ({otherTerms.length})
                </span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              {otherTerms.map((term) => (
                <TermCard
                  key={term.id}
                  term={term}
                  filingId={filingId}
                  processId={processId}
                  compact
                  onResume={() =>
                    resumeTerm.mutate({ termId: term.id, filingId, processId })
                  }
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Milestones (Collapsible) */}
        <Collapsible open={showMilestones} onOpenChange={setShowMilestones}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between">
              <span className="text-xs flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Hitos Registrados ({milestones?.length ?? 0})
              </span>
              {showMilestones ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {milestones?.map((m) => (
              <MilestoneRow key={m.id} milestone={m} />
            ))}
            {(!milestones || milestones.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-2">
                No hay hitos registrados
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>

      {/* Milestone Wizard */}
      <MilestoneWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        filingId={filingId}
        processId={processId}
        ownerId={ownerId}
      />
    </Card>
  );
}

// ============= Sub-components =============

function StatBadge({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: 'blue' | 'amber' | 'red' | 'green';
}) {
  const colors = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };

  return (
    <div className={cn("rounded-lg p-2 text-center", colors[variant])}>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] uppercase">{label}</p>
    </div>
  );
}

function NextDueAlert({
  term,
  daysRemaining,
  urgency,
}: {
  term: CgpTermInstance;
  daysRemaining: number;
  urgency: 'critical' | 'warning' | 'normal' | 'expired';
}) {
  const colors = {
    critical: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800',
    warning: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
    normal: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800',
    expired: 'bg-red-100 border-red-300 dark:bg-red-950/50 dark:border-red-700',
  };

  const textColors = {
    critical: 'text-red-700 dark:text-red-400',
    warning: 'text-amber-700 dark:text-amber-400',
    normal: 'text-blue-700 dark:text-blue-400',
    expired: 'text-red-800 dark:text-red-300',
  };

  return (
    <div className={cn("p-3 rounded-lg border", colors[urgency])}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className={cn("font-medium text-sm", textColors[urgency])}>
            {urgency === 'expired' ? '¡VENCIDO!' : urgency === 'critical' ? '¡VENCE HOY!' : 'Próximo vencimiento'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{term.term_name}</p>
        </div>
        <div className="text-right">
          <p className={cn("font-bold text-lg", textColors[urgency])}>
            {daysRemaining < 0 ? `${Math.abs(daysRemaining)}d` : `${daysRemaining}d`}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {format(new Date(term.due_date), 'dd MMM', { locale: es })}
          </p>
        </div>
      </div>
    </div>
  );
}

function TermCard({
  term,
  filingId,
  processId,
  compact = false,
  onSatisfy,
  onPause,
  onResume,
}: {
  term: CgpTermInstance;
  filingId?: string;
  processId?: string;
  compact?: boolean;
  onSatisfy?: (notes?: string) => void;
  onPause?: (reason: string) => void;
  onResume?: () => void;
}) {
  const daysRemaining = getDaysRemaining(new Date(term.due_date));
  const urgency = getTermUrgency(daysRemaining);
  const statusInfo = TERM_STATUS_LABELS[term.status];

  return (
    <div
      className={cn(
        "p-3 rounded-lg border bg-card transition-colors",
        urgency === 'expired' && term.status === 'RUNNING' && "border-red-300 bg-red-50/50 dark:bg-red-950/20",
        urgency === 'critical' && term.status === 'RUNNING' && "border-red-200 bg-red-50/30 dark:bg-red-950/10",
        urgency === 'warning' && term.status === 'RUNNING' && "border-amber-200"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm truncate">{term.term_name}</p>
            <Badge
              variant="outline"
              className={cn("text-[10px] px-1.5", {
                "border-blue-300 text-blue-600": term.status === 'RUNNING',
                "border-amber-300 text-amber-600": term.status === 'PAUSED',
                "border-red-300 text-red-600": term.status === 'EXPIRED',
                "border-green-300 text-green-600": term.status === 'SATISFIED',
              })}
            >
              {statusInfo.label}
            </Badge>
          </div>
          {!compact && (
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Vence: {format(new Date(term.due_date), 'dd/MM/yy')}
              </span>
              {term.status === 'RUNNING' && (
                <span className={cn("font-medium", {
                  "text-red-600": urgency === 'expired' || urgency === 'critical',
                  "text-amber-600": urgency === 'warning',
                })}>
                  {daysRemaining < 0
                    ? `Venció hace ${Math.abs(daysRemaining)} día(s)`
                    : daysRemaining === 0
                      ? "¡Vence hoy!"
                      : `${daysRemaining} día(s) restantes`}
                </span>
              )}
            </div>
          )}
          {term.pause_reason && (
            <p className="text-xs text-amber-600 mt-1">
              Pausado: {term.pause_reason}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {term.status === 'RUNNING' && onSatisfy && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-green-600 hover:bg-green-100"
                    onClick={() => onSatisfy()}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Marcar como cumplido</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {term.status === 'RUNNING' && onPause && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-amber-600 hover:bg-amber-100"
                    onClick={() => onPause("Expediente al despacho")}
                  >
                    <Pause className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Pausar término</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {term.status === 'PAUSED' && onResume && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-blue-600 hover:bg-blue-100"
                    onClick={onResume}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reanudar término</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}

function MilestoneRow({ milestone }: { milestone: CgpMilestone }) {
  return (
    <div className="flex items-center justify-between p-2 rounded border bg-muted/30">
      <div className="flex items-center gap-2">
        {milestone.occurred ? (
          <Check className="h-4 w-4 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm">{MILESTONE_LABELS[milestone.milestone_type]}</span>
        {milestone.in_audience && (
          <Badge variant="outline" className="text-[10px]">
            En audiencia
          </Badge>
        )}
      </div>
      {milestone.event_date && (
        <span className="text-xs text-muted-foreground">
          {format(new Date(milestone.event_date), 'dd/MM/yy')}
        </span>
      )}
    </div>
  );
}
