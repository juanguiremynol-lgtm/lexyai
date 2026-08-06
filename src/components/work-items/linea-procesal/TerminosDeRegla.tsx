/**
 * TerminosDeRegla — terms derived from RATIFIED workflow deadline rules
 * (iteration 38).
 *
 * Ratified rules compute; DRAFT rules never do. Every computed term is shown as
 * a SUGGESTION with its anchor and legal citation, and is only written to the
 * deadlines table when the user confirms. Ratified rules whose anchor date is
 * unknown are listed as awaiting the anchor — never computed from a guess.
 */
import { useMemo } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarClock, Check, Clock, Gavel, HelpCircle, PauseCircle, Scale } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useWorkflowDeadlineRules } from "@/hooks/use-workflow-deadline-rules";
import { useMissingRules } from "@/hooks/use-missing-rules";
import {
  deriveAlDespachoSuspensions,
  filterRulesToRegimen,
  resolveLaboralRegimenForMatter,
} from "@/lib/laboral/laboral-terms";
import {
  buildRuleTermSuggestions,
  type SuggestedRuleTerm,
  type TermEvent,
} from "@/lib/workflow-terms/rule-term-suggestions";

interface TerminosDeReglaProps {
  workItemId: string;
  /** Workflow whose ratified catalogue applies (the ACTIVE track's workflow). */
  ruleWorkflowType: string;
  /**
   * True for a declarative matter at sentencia stage: the art. 306 rules of the
   * executive track are relevant even before the track is opened.
   */
  includeArt306Only?: boolean;
  events: TermEvent[];
  /** Anchor events to list as "awaiting the anchor date" when unresolved. */
  awaitingAnchorEvents?: string[];
}

export function TerminosDeRegla({
  workItemId,
  ruleWorkflowType,
  includeArt306Only,
  events,
  awaitingAnchorEvents = [],
}: TerminosDeReglaProps) {
  const workflowForRules = includeArt306Only ? "EJECUTIVO" : ruleWorkflowType;
  const { data: rules = [] } = useWorkflowDeadlineRules(workflowForRules);
  const queryClient = useQueryClient();

  const isLaboral = workflowForRules === "LABORAL";

  // Labour matters resolve their regime from the FILING DATE only, and never
  // mix regimes (CSJ STL9085-2026).
  const { data: filingDate = null } = useQuery({
    queryKey: ["work-item-filing-date", workItemId],
    enabled: isLaboral,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("work_items")
        .select("filing_date, fecha_presenta_demanda, fecha_radicado")
        .eq("id", workItemId)
        .maybeSingle();
      if (error) throw error;
      const row = data as { filing_date?: string | null; fecha_presenta_demanda?: string | null; fecha_radicado?: string | null } | null;
      return row?.filing_date ?? row?.fecha_presenta_demanda ?? row?.fecha_radicado ?? null;
    },
  });

  const regimenInfo = useMemo(
    () => (isLaboral ? resolveLaboralRegimenForMatter(filingDate) : null),
    [isLaboral, filingDate],
  );

  const { data: missingRules = [] } = useMissingRules(
    isLaboral ? "LABORAL" : undefined,
    regimenInfo?.regimen ?? null,
  );

  const scoped = useMemo(
    () =>
      includeArt306Only
        ? rules.filter((r) => r.track_kind === "EJECUTIVO_A_CONTINUACION")
        : isLaboral
          ? filterRulesToRegimen(rules, regimenInfo?.regimen ?? null)
          : rules,
    [rules, includeArt306Only, isLaboral, regimenInfo?.regimen],
  );

  const suspensions = useMemo(() => deriveAlDespachoSuspensions(events), [events]);

  const { suggested, awaiting } = useMemo(
    () => buildRuleTermSuggestions(scoped, events, awaitingAnchorEvents, { suspensions }),
    [scoped, events, awaitingAnchorEvents, suspensions],
  );

  const confirm = useMutation({
    mutationFn: async (term: SuggestedRuleTerm) => {
      const { data: auth } = await supabase.auth.getUser();
      const ownerId = auth.user?.id;
      if (!ownerId) throw new Error("Sesión requerida");
      const { error } = await supabase.from("work_item_deadlines").insert({
        owner_id: ownerId,
        work_item_id: workItemId,
        deadline_type: term.deadlineType,
        label: term.label,
        trigger_event: term.anchor.event,
        trigger_date: term.anchor.date,
        deadline_date: term.deadlineDate,
        status: "PENDING",
        calculation_meta: {
          norma: term.citation,
          anchor_source: term.anchor.type,
          anchor_date: term.anchor.date,
          day_type: "BUSINESS",
          workflow_type: workflowForRules,
          source: "RATIFIED_WORKFLOW_RULE",
          fuente_texto: term.basis,
        },
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Término registrado");
      queryClient.invalidateQueries({ queryKey: ["work-item-deadlines", workItemId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "No se pudo registrar"),
  });

  if (!suggested.length && !awaiting.length && !missingRules.length && !regimenInfo) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4" aria-hidden />
          Términos de reglas ratificadas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {regimenInfo && (
          <p className="text-xs text-muted-foreground">
            <Gavel className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            {regimenInfo.basis}
          </p>
        )}
        {suggested.map((term) => (
          <div key={term.ruleId} className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CalendarClock className="h-3.5 w-3.5 text-primary" aria-hidden />
              {term.label}
              {term.citation && (
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {term.citation}
                </Badge>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {term.oralInHearing || !term.deadlineDate
                ? "Sin término escrito — se surte en la audiencia."
                : `Vencería el ${format(new Date(`${term.deadlineDate}T00:00:00`), "d 'de' MMMM yyyy", {
                    locale: es,
                  })}`}
            </p>
            {term.basis && <p className="mt-1 text-xs text-muted-foreground">{term.basis}</p>}
            {term.suspendedOpenEnded && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <PauseCircle className="h-3.5 w-3.5" aria-hidden />
                Término suspendido: el expediente está al despacho (art. 324).
              </p>
            )}
            {!term.suspendedOpenEnded && !!term.suspendedDays && (
              <p className="mt-1 text-xs text-muted-foreground">
                Se descontaron {term.suspendedDays} día(s) hábil(es) con el expediente al despacho (art. 324).
              </p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sugerencia — no se aplica automáticamente.
            </p>
            {term.deadlineDate && (
              <Button
                size="sm"
                className="mt-2"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate(term)}
              >
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                Confirmar término
              </Button>
            )}
          </div>
        ))}

        {awaiting.map((a) => (
          <div key={a.ruleId} className="rounded-md border p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {a.label}
              {a.citation && (
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {a.citation}
                </Badge>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{a.reason}</p>
          </div>
        ))}

        {missingRules.map((m) => (
          <div key={m.id} className="rounded-md border border-dashed p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {m.label}
              {m.expected_citation && (
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {m.expected_citation}
                </Badge>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Término no modelado — pendiente de verificación normativa. {m.reason}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
