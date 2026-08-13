/**
 * "Acción requerida" card.
 *
 * Computes the single most urgent pending action for a work item:
 *  (a) nearest active deadline
 *  (b) deadlines suggested by email awaiting confirmation
 *  (c) pending stage suggestions (inline Aplicar / Descartar)
 *  (d) términos that require manual review
 * Nothing is applied automatically.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CalendarClock, CheckCircle2, Gavel, Mail, Sparkles, Check, X } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useWorkItemDeadlines, businessDaysUntil, type WorkItemDeadline } from "@/hooks/use-work-item-deadlines";
import { usePendingStageSuggestions } from "@/hooks/use-pending-stage-suggestions";
import { useStageSuggestion } from "@/hooks/useStageSuggestion";
import { useSuggestedDeadlineActions } from "@/hooks/use-suggested-deadlines";
import { useWorkflowDeadlineRules } from "@/hooks/use-workflow-deadline-rules";
import { penalTermsPendingRatification } from "@/lib/penal906/penal906-terms";
import { getStageLabel, type WorkflowType, type CGPPhase } from "@/lib/workflow-constants";
import { DERIVED_DATE_LABEL, formatDeadlineLabel, isDerivedDate } from "@/lib/deadline-labels";
import { useTermAttribution } from "@/hooks/use-term-attribution";

const ACTIVE_STATUSES = new Set(["PENDING", "PENDING_REVIEW"]);

function isHearing(d: WorkItemDeadline): boolean {
  return d.deadline_type === "AUDIENCIA" || d.deadline_type === "PREPARACION_AUDIENCIA";
}

function urgencyClass(days: number): string {
  if (days < 3) return "border-destructive/40 bg-destructive/5";
  if (days < 8) return "border-amber-500/40 bg-amber-500/5";
  return "border-border";
}

interface AccionRequeridaProps {
  workItemId: string;
  workflowType: WorkflowType;
  cgpPhase: CGPPhase | null;
}

export function AccionRequerida({ workItemId, workflowType, cgpPhase }: AccionRequeridaProps) {
  const { data: deadlines = [] } = useWorkItemDeadlines(workItemId);
  const { data: suggestions = [] } = usePendingStageSuggestions(workItemId);
  const { apply, dismiss, isApplying, isDismissing } = useStageSuggestion({ workItemId });
  const deadlineActions = useSuggestedDeadlineActions(workItemId);
  // Penal, laboral and ejecutivo terms are a specification the lawyer owns:
  // until at least one rule of that workflow is ratified the engine computes
  // nothing and we say so explicitly (iterations 31-32).
  const RULE_GATED: Record<string, string> = {
    PENAL_906: "penales (Ley 906)",
    LABORAL: "laborales",
    EJECUTIVO: "del proceso ejecutivo",
  };
  const gatedLabel = RULE_GATED[workflowType];
  const { data: workflowRules = [] } = useWorkflowDeadlineRules(gatedLabel ? workflowType : undefined);
  const penalRulesPending = !!gatedLabel && penalTermsPendingRatification(workflowRules);

  // ITER53 — ONE attribution for the whole screen. Acción requerida, the terms
  // card and the unattributed block all read this same resolution.
  const { resolve } = useTermAttribution(workItemId);
  const attributionOf = (d: WorkItemDeadline) =>
    resolve({
      boundPartyRole: d.bound_party_role ?? d.calculation_meta?.bound_party_role ?? null,
      isJudgeSide: d.is_judge_side ?? null,
      boundPartySource: d.bound_party_source ?? null,
      storedAttribution: d.calculation_meta?.attribution ?? null,
    });
  const ownAction = (d: WorkItemDeadline) => attributionOf(d).actionable;
  const relevant = deadlines.filter(
    (d) => ACTIVE_STATUSES.has(d.status) || d.status === "SUGGESTED_BY_PROVIDER",
  );
  const notOurs = relevant.filter(
    (d) => !ownAction(d) && attributionOf(d).attribution !== "DESCONOCIDO",
  );
  const unattributed = relevant.filter((d) => attributionOf(d).attribution === "DESCONOCIDO");

  const active = deadlines
    .filter((d) => ACTIVE_STATUSES.has(d.status) && d.deadline_date && ownAction(d))
    .sort((a, b) => (a.deadline_date! < b.deadline_date! ? -1 : 1));
  const suggestedByEmail = deadlines.filter((d) => d.status === "SUGGESTED_BY_EMAIL" && ownAction(d));
  const suggestedByProvider = deadlines.filter(
    (d) => d.status === "SUGGESTED_BY_PROVIDER" && ownAction(d),
  );
  const manualReview = deadlines.filter((d) => d.status === "REQUIERE_REVISION_MANUAL");

  const nearest: WorkItemDeadline | undefined = active[0];
  const hasAnything =
    !!nearest ||
    suggestedByEmail.length > 0 ||
    suggestedByProvider.length > 0 ||
    suggestions.length > 0 ||
    manualReview.length > 0 ||
    notOurs.length > 0 ||
    unattributed.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" aria-hidden />
          Acción requerida
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {penalRulesPending && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
              Reglas de términos {gatedLabel} pendientes de ratificación
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              No se calcula ningún término hasta que estas reglas sean ratificadas.
            </p>
          </div>
        )}

        {!hasAnything && !penalRulesPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            Sin acciones pendientes — al día
          </div>
        )}

        {nearest && (
          <div className={cn("rounded-md border p-3", urgencyClass(businessDaysUntil(nearest.deadline_date!)))}>
            <p className="text-sm font-medium" title={nearest.deadline_type}>
              {formatDeadlineLabel(nearest.deadline_type, nearest.label)}
            </p>
            <p className="text-xs text-muted-foreground">
              Vence el {format(new Date(nearest.deadline_date + "T00:00:00"), "d 'de' MMMM yyyy", { locale: es })} ·{" "}
              {businessDaysUntil(nearest.deadline_date!)} días hábiles restantes
              {isDerivedDate(nearest.calculation_meta) ? ` · ${DERIVED_DATE_LABEL}` : ""}
            </p>
          </div>
        )}

        {suggestedByEmail.map((d) => (
          <div key={d.id} className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Mail className="h-3.5 w-3.5 text-primary" aria-hidden />
              Confirmar término sugerido por correo
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDeadlineLabel(d.deadline_type, d.label)}
              {d.deadline_date
                ? ` · vencería el ${format(new Date(d.deadline_date + "T00:00:00"), "d MMM yyyy", { locale: es })}`
                : " · sin fecha calculable, requiere revisión"}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => deadlineActions.confirm.mutate(d.id)} disabled={deadlineActions.confirm.isPending}>
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                Confirmar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => deadlineActions.dismiss.mutate(d.id)}
                disabled={deadlineActions.dismiss.isPending}
              >
                <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                Descartar
              </Button>
            </div>
          </div>
        ))}

        {suggestedByProvider.map((d) => (
          <div key={d.id} className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Gavel className="h-3.5 w-3.5 text-primary" aria-hidden />
              {isHearing(d)
                ? "Confirmar audiencia detectada en el expediente"
                : "Confirmar término calculado con fecha derivada"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDeadlineLabel(d.deadline_type, d.label)}
              {d.deadline_date
                ? ` · ${format(new Date(d.deadline_date + "T00:00:00"), "d MMM yyyy", { locale: es })}`
                : ""}
              {typeof d.calculation_meta?.hora === "string" ? `, ${d.calculation_meta.hora}` : ""}
              {isDerivedDate(d.calculation_meta) ? ` · ${DERIVED_DATE_LABEL} (desfijación estimada)` : ""}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => deadlineActions.confirm.mutate(d.id)}
                disabled={deadlineActions.confirm.isPending}
              >
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                Confirmar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => deadlineActions.dismiss.mutate(d.id)}
                disabled={deadlineActions.dismiss.isPending}
              >
                <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                Descartar
              </Button>
            </div>
          </div>
        ))}

        {suggestions.map((s) => (
          <div key={s.id} className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
              Revisar sugerencia de etapa:{" "}
              {s.suggested_stage
                ? getStageLabel(workflowType, s.suggested_stage, cgpPhase ?? undefined)
                : "(sin etapa)"}
              <Badge variant="outline" className="ml-1 text-[10px]">
                {s.source_type === "EMAIL" ? "correo" : "actuación"} · {Math.round(Number(s.confidence) * 100)}%
              </Badge>
            </p>
            {s.reason && <p className="mt-1 text-xs text-muted-foreground">{s.reason}</p>}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={isApplying}
                onClick={() =>
                  apply({
                    suggestionId: s.id,
                    workItemId,
                    suggestedStage: s.suggested_stage,
                    suggestedCgpPhase: s.suggested_cgp_phase,
                    suggestedPipelineStage: s.suggested_pipeline_stage,
                  })}
              >
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                Aplicar
              </Button>
              <Button size="sm" variant="ghost" disabled={isDismissing} onClick={() => dismiss(s.id)}>
                <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                Descartar
              </Button>
            </div>
          </div>
        ))}

        {notOurs.length > 0 && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Términos de otras partes o del despacho — informativos
            </p>
            {notOurs.map((d) => {
              const attr = attributionOf(d);
              return (
                <div key={d.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {formatDeadlineLabel(d.deadline_type, d.label)}
                  </span>
                  {d.deadline_date
                    ? ` · ${format(new Date(d.deadline_date + "T00:00:00"), "d MMM yyyy", { locale: es })}`
                    : ""}
                  <span className="block">{attr.statement}</span>
                </div>
              );
            })}
          </div>
        )}

        {unattributed.length > 0 && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
              Términos sin parte determinada
            </p>
            <p className="text-[11px] text-muted-foreground">
              Indique la calidad en que actúa su cliente en «Términos del expediente» para
              atribuirlos.
            </p>
            {unattributed.map((d) => (
              <div key={d.id} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {formatDeadlineLabel(d.deadline_type, d.label)}
                </span>
                {d.deadline_date
                  ? ` · ${format(new Date(d.deadline_date + "T00:00:00"), "d MMM yyyy", { locale: es })}`
                  : ""}
                <span className="block">{attributionOf(d).statement}</span>
              </div>
            ))}
          </div>
        )}

        {manualReview.map((d) => (
          <div key={d.id} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
              Término requiere revisión manual
            </p>
            <p className="text-xs text-muted-foreground" title={d.deadline_type}>
              {formatDeadlineLabel(d.deadline_type, d.label)}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
