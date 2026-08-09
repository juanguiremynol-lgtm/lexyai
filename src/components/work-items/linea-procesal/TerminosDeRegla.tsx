/**
 * Términos del expediente — terms computed from RATIFIED workflow deadline
 * rules, attributed to the party they actually bind (iteration 50).
 *
 * Two invariants:
 *  1. Nothing here is our engineering backlog. The missing-rules register lives
 *     in the platform console; the matter only carries a single restrained line
 *     when its workflow has gaps.
 *  2. A term binds somebody. Only a term bound to OUR client is offered as an
 *     action; the counterparty's and the court's terms are informative, and an
 *     unattributed term asks for the client's capacity instead of guessing.
 */
import { useMemo } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clock,
  Gavel,
  HelpCircle,
  Info,
  PauseCircle,
  Scale,
  UserCheck,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  useAntinomiaDesignation,
  useWorkflowDeadlineRules,
} from "@/hooks/use-workflow-deadline-rules";
import { useMissingRules } from "@/hooks/use-missing-rules";
import { useWorkItemDeadlines } from "@/hooks/use-work-item-deadlines";
import {
  useSetWorkItemPartyRole,
  useWorkItemPartyRole,
} from "@/hooks/use-work-item-party-role";
import {
  ATTRIBUTION_COPY,
  attributeTerm,
  BOUND_PARTY_ROLE_LABELS,
  CLIENT_PARTY_ROLE_LABELS,
  CLIENT_PARTY_ROLES,
  normalizeBoundPartyRole,
  type ClientPartyRole,
  type TermAttribution,
} from "@/lib/workflow-terms/party-attribution";
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
  /**
   * Procedure variant of the matter (e.g. ABREVIADO). Rules gated to another
   * variant are not shown; ungated rules always are.
   */
  procedureVariant?: string | null;
}

type AttributedTerm = SuggestedRuleTerm & {
  attribution: TermAttribution;
  boundPartyLabel: string;
};

export function TerminosDeRegla({
  workItemId,
  ruleWorkflowType,
  includeArt306Only,
  events,
  awaitingAnchorEvents = [],
  procedureVariant = null,
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

  // The register itself is an admin surface; here it only tells us whether the
  // workflow has gaps, so the matter can carry one restrained line about it.
  const { data: missingRules = [] } = useMissingRules(
    isLaboral ? "LABORAL" : undefined,
    regimenInfo?.regimen ?? null,
  );

  const scoped = useMemo(
    () => {
      const base = includeArt306Only
        ? rules.filter((r) => r.track_kind === "EJECUTIVO_A_CONTINUACION")
        : isLaboral
          ? filterRulesToRegimen(rules, regimenInfo?.regimen ?? null)
          : rules;
      return base.filter((r) => !r.procedure_variant || r.procedure_variant === procedureVariant);
    },
    [rules, includeArt306Only, isLaboral, regimenInfo?.regimen, procedureVariant],
  );

  const suspensions = useMemo(() => deriveAlDespachoSuspensions(events), [events]);

  // Already-registered terms: the confirmation must be reflected in the card,
  // otherwise the suggestion looks untouched even though the row exists.
  const { data: existingDeadlines = [] } = useWorkItemDeadlines(workItemId);
  const registeredTypes = useMemo(
    () => new Set(existingDeadlines.map((d) => d.deadline_type)),
    [existingDeadlines],
  );

  const { data: partyRole } = useWorkItemPartyRole(workItemId);
  const setRole = useSetWorkItemPartyRole(workItemId);
  const confirmedRole: ClientPartyRole | null =
    partyRole?.source === "CONFIRMADO" ? partyRole.role : null;

  const { suggested, awaiting, antinomias } = useMemo(
    () => buildRuleTermSuggestions(scoped, events, awaitingAnchorEvents, { suspensions }),
    [scoped, events, awaitingAnchorEvents, suspensions],
  );
  const designate = useAntinomiaDesignation();

  const ruleById = useMemo(() => new Map(scoped.map((r) => [r.id, r])), [scoped]);

  const attributed: AttributedTerm[] = useMemo(
    () =>
      suggested.map((t) => {
        const rule = ruleById.get(t.ruleId);
        const bound = normalizeBoundPartyRole(rule?.bound_party_role);
        return {
          ...t,
          attribution: attributeTerm(bound, confirmedRole, {
            isJudgeSide: rule?.is_judge_side === true,
          }),
          boundPartyLabel: BOUND_PARTY_ROLE_LABELS[bound],
        };
      }),
    [suggested, ruleById, confirmedRole],
  );

  const mine = attributed.filter((t) => t.attribution === "PROPIO");
  const others = attributed.filter((t) => t.attribution === "CONTRAPARTE" || t.attribution === "JUEZ");
  const unattributed = attributed.filter((t) => t.attribution === "DESCONOCIDO");

  const confirm = useMutation({
    mutationFn: async (term: AttributedTerm) => {
      const { data: auth } = await supabase.auth.getUser();
      const ownerId = auth.user?.id;
      if (!ownerId) throw new Error("Sesión requerida");
      // An oral, in-hearing moment has no written term by design: confirming it
      // records that the moment was noted; it must never become a phantom date.
      const oral = term.oralInHearing || !term.deadlineDate;
      const { error } = await supabase.from("work_item_deadlines").insert({
        owner_id: ownerId,
        work_item_id: workItemId,
        deadline_type: term.deadlineType,
        label: term.label,
        trigger_event: term.anchor.event,
        trigger_date: term.anchor.date,
        deadline_date: oral ? null : term.deadlineDate,
        status: oral ? "INVALID_NO_TERM" : "PENDING",
        notes: oral ? "Momento oral en audiencia registrado — sin término escrito." : null,
        calculation_meta: {
          norma: term.citation,
          anchor_source: term.anchor.type,
          anchor_date: term.anchor.date,
          day_type: oral ? "HOURS" : "BUSINESS",
          workflow_type: workflowForRules,
          source: "RATIFIED_WORKFLOW_RULE",
          fuente_texto: term.basis,
          bound_party_role: normalizeBoundPartyRole(
            ruleById.get(term.ruleId)?.bound_party_role,
          ),
          client_party_role: confirmedRole,
          attribution: term.attribution,
          oral_en_audiencia: oral,
        },
      } as never);
      if (error) throw error;
    },
    onSuccess: async (_data, term) => {
      toast.success(
        term.oralInHearing || !term.deadlineDate
          ? "Momento registrado en el expediente"
          : "Término registrado",
        { id: `term-${term.ruleId}`, duration: 4000 },
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["work-item-deadlines", workItemId] }),
        queryClient.invalidateQueries({ queryKey: ["work-item-timeline", workItemId] }),
        queryClient.invalidateQueries({ queryKey: ["hoy-counts"] }),
      ]);
    },
    onError: (e: unknown, term) =>
      toast.error(e instanceof Error ? e.message : "No se pudo registrar", {
        id: `term-${term.ruleId}`,
        duration: 6000,
      }),
  });

  const roleSelector = (
    <Select
      value={partyRole?.role ?? undefined}
      onValueChange={(v) =>
        setRole.mutate(v as ClientPartyRole, {
          onSuccess: () => toast.success("Calidad del cliente registrada"),
          onError: (e: unknown) =>
            toast.error(e instanceof Error ? e.message : "No se pudo registrar la calidad"),
        })}
    >
      <SelectTrigger className="h-8 w-[280px] text-xs">
        <SelectValue placeholder="Indique la calidad en que actúa su cliente" />
      </SelectTrigger>
      <SelectContent>
        {CLIENT_PARTY_ROLES.map((r) => (
          <SelectItem key={r} value={r} className="text-xs">
            {CLIENT_PARTY_ROLE_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const renderTerm = (term: AttributedTerm, tone: "own" | "info" | "unknown") => (
    <div
      key={term.ruleId}
      className={
        tone === "own"
          ? "rounded-md border border-primary/30 bg-primary/5 p-3"
          : tone === "unknown"
            ? "rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
            : "rounded-md border bg-muted/30 p-3"
      }
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <CalendarClock
          className={tone === "own" ? "h-3.5 w-3.5 text-primary" : "h-3.5 w-3.5 text-muted-foreground"}
          aria-hidden
        />
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
          : `Vence el ${format(new Date(`${term.deadlineDate}T00:00:00`), "d 'de' MMMM yyyy", {
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

      {tone !== "own" && (
        <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
          {tone === "unknown" ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" aria-hidden />
          ) : (
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          )}
          <span>
            {ATTRIBUTION_COPY[term.attribution]}
            {term.attribution === "CONTRAPARTE" ? ` Corresponde a ${term.boundPartyLabel}.` : ""}
          </span>
        </p>
      )}
      {tone === "unknown" && <div className="mt-2">{roleSelector}</div>}

      {tone === "own" && registeredTypes.has(term.deadlineType) && (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {term.oralInHearing || !term.deadlineDate
            ? "Momento registrado en el expediente."
            : "Término registrado en el calendario del expediente."}
        </p>
      )}
      {tone === "own" && !registeredTypes.has(term.deadlineType) && (
        <>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Sugerencia — no se aplica automáticamente.
          </p>
          <Button
            size="sm"
            className="mt-2"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate(term)}
          >
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
            {term.oralInHearing || !term.deadlineDate ? "Registrar el momento" : "Confirmar término"}
          </Button>
        </>
      )}
    </div>
  );

  const hasGaps = missingRules.length > 0;

  if (
    !attributed.length &&
    !awaiting.length &&
    !antinomias.length &&
    !hasGaps &&
    !regimenInfo &&
    !partyRole?.role
  )
    return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4" aria-hidden />
          Términos del expediente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {regimenInfo && (
          <p className="text-xs text-muted-foreground">
            <Gavel className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            {regimenInfo.basis}
          </p>
        )}

        {/* Client capacity — the datum every attribution depends on. */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2">
          <UserCheck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {confirmedRole ? (
            <p className="text-xs text-muted-foreground">
              Su cliente actúa como{" "}
              <span className="font-medium text-foreground">
                {CLIENT_PARTY_ROLE_LABELS[confirmedRole]}
              </span>
              .
            </p>
          ) : partyRole?.role ? (
            <>
              <p className="text-xs text-muted-foreground">
                Calidad propuesta:{" "}
                <span className="font-medium text-foreground">
                  {CLIENT_PARTY_ROLE_LABELS[partyRole.role]}
                </span>
                {partyRole.basis ? ` — ${partyRole.basis}` : ""} Confírmela para atribuir los términos.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={setRole.isPending}
                onClick={() =>
                  setRole.mutate(partyRole.role as ClientPartyRole, {
                    onSuccess: () => toast.success("Calidad del cliente confirmada"),
                    onError: (e: unknown) =>
                      toast.error(e instanceof Error ? e.message : "No se pudo confirmar"),
                  })}
              >
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                Confirmar calidad
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Indique la calidad en que actúa su cliente para atribuir los términos.
            </p>
          )}
          {!confirmedRole && roleSelector}
        </div>

        {mine.map((t) => renderTerm(t, "own"))}
        {unattributed.map((t) => renderTerm(t, "unknown"))}

        {others.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Términos de otras partes o del despacho (informativos)
            </p>
            {others.map((t) => renderTerm(t, "info"))}
          </div>
        )}

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

        {antinomias.map((conf) => (
          <div key={conf.group} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
              Dos normas en conflicto (antinomia)
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {conf.designatedRuleId
                ? "Norma designada por el titular; la designación queda registrada."
                : "Mientras no se designe la norma que gobierna, rige el término más corto por prudencia."}
            </p>
            <ul className="mt-2 space-y-1.5">
              {conf.members.map((m) => (
                <li key={m.ruleId} className="text-xs">
                  <span className="font-medium">{m.label}</span>
                  {m.citation && (
                    <Badge variant="outline" className="ml-1 text-[10px]">
                      {m.citation}
                    </Badge>
                  )}
                  <span className="ml-1 text-muted-foreground">
                    {m.daysAmountMax
                      ? `${m.daysAmount} a ${m.daysAmountMax} días`
                      : `${m.daysAmount} días`}
                    {m.deadlineDate
                      ? ` · vencería el ${format(new Date(`${m.deadlineDate}T00:00:00`), "d 'de' MMMM yyyy", { locale: es })}`
                      : " · sin fecha calculada"}
                  </span>
                  {m.isOperative && (
                    <Badge className="ml-1 text-[10px]">
                      {m.isDesignated ? "Designada" : "Operativo (más corto)"}
                    </Badge>
                  )}
                  {!m.isDesignated && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-2 h-6 px-2 text-[11px]"
                      disabled={designate.isPending}
                      onClick={() =>
                        designate.mutate(
                          { group: conf.group, ruleId: m.ruleId },
                          {
                            onSuccess: () => toast.success("Norma designada"),
                            onError: (e: unknown) =>
                              toast.error(e instanceof Error ? e.message : "No se pudo designar"),
                          },
                        )}
                    >
                      Designar esta norma
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* The register itself is internal; the matter only says a gap exists. */}
        {hasGaps && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <HelpCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
            Algunos términos de este flujo aún no están modelados.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
