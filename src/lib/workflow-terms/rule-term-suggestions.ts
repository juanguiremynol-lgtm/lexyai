/**
 * rule-term-suggestions.ts — surfaces terms computed from RATIFIED workflow
 * deadline rules (iteration 38).
 *
 * Invariant: nothing auto-applies. Every term produced here is a SUGGESTION the
 * lawyer confirms. A ratified rule whose anchor date is unknown is rendered as
 * "awaiting the anchor date" — never computed from a guess.
 */
import { addBusinessDays } from "@/lib/colombian-holidays";
import { computePenalTerms, ruleIsRatified, type PenalAnchor, type PenalComputedTerm } from "@/lib/penal906/penal906-terms";
import type { WorkflowDeadlineRule } from "@/hooks/use-workflow-deadline-rules";

export interface TermEvent {
  at: string;
  text: string;
  source: "ACTUACION" | "ESTADO";
}

export interface ResolvedAnchor extends PenalAnchor {
  /** Human-readable explanation of how the anchor date was obtained. */
  basis: string;
}

export interface AwaitingAnchor {
  ruleId: string;
  deadlineType: string;
  label: string;
  citation: string | null;
  anchorEvent: string | null;
  reason: string;
}

const MANDAMIENTO_RE =
  /(libra|librar|librese|liberese)\s+mandamiento|mandamiento\s+(ejecutivo\s*)?(de\s*)?pago/i;
const FIJACION_RE = /fijacion\s+estado|fijacion\s+en\s+estado/i;
const EJECUTORIA_RE = /ejecutoria|obedecimiento\s+a\s+lo\s+resuelto/i;

function normalize(text: string): string {
  return (text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function iso(at: string): string {
  return at.slice(0, 10);
}

function nextBusinessDay(isoDate: string): string {
  return addBusinessDays(new Date(`${isoDate}T00:00:00`), 1).toISOString().slice(0, 10);
}

/**
 * Derives the anchors the engine can honestly establish from the record.
 * Only anchors with a documented basis are returned; everything else stays
 * unresolved so the rule surfaces as "awaiting the anchor date".
 */
export function resolveAnchorsFromEvents(events: TermEvent[]): ResolvedAnchor[] {
  const sorted = [...events].filter((e) => !!e.at).sort((a, b) => (a.at < b.at ? -1 : 1));
  const out: ResolvedAnchor[] = [];

  // NOTIFICACION_MANDAMIENTO_PAGO — the mandamiento is notified by estado; the
  // notification takes effect the business day following the fijación.
  const mandamiento = [...sorted].reverse().find((e) => MANDAMIENTO_RE.test(normalize(e.text)));
  if (mandamiento) {
    const fijacion = sorted.find(
      (e) => FIJACION_RE.test(normalize(e.text)) && iso(e.at) >= iso(mandamiento.at),
    );
    if (fijacion) {
      const notificationDate = nextBusinessDay(iso(fijacion.at));
      out.push({
        type: "ANCHOR_NOTIFICACION",
        event: "NOTIFICACION_MANDAMIENTO_PAGO",
        date: notificationDate,
        basis: `Auto que libra mandamiento de pago del ${iso(mandamiento.at)}, fijado en estado el ${iso(
          fijacion.at,
        )}; la notificación por estado surte efectos el día hábil siguiente (${notificationDate}).`,
      });
    }
  }

  // EJECUTORIA_SENTENCIA — only when the record states it explicitly.
  const ejecutoria = [...sorted].reverse().find((e) => EJECUTORIA_RE.test(normalize(e.text)));
  if (ejecutoria) {
    out.push({
      type: "ANCHOR_EJECUTORIA",
      event: "EJECUTORIA_SENTENCIA",
      date: iso(ejecutoria.at),
      basis: `Constancia de ejecutoria en el expediente (${iso(ejecutoria.at)}).`,
    });
  }

  return out;
}

export interface SuggestedRuleTerm extends PenalComputedTerm {
  basis: string;
}

export interface RuleTermSuggestions {
  suggested: SuggestedRuleTerm[];
  awaiting: AwaitingAnchor[];
}

/**
 * Terms for the RATIFIED rules of a workflow/track, plus the ratified rules
 * whose anchor date is not yet known.
 */
export function buildRuleTermSuggestions(
  rules: WorkflowDeadlineRule[],
  events: TermEvent[],
): RuleTermSuggestions {
  const ratified = rules.filter(ruleIsRatified);
  const anchors = resolveAnchorsFromEvents(events);
  const computed = computePenalTerms(ratified, anchors);

  const suggested: SuggestedRuleTerm[] = computed.map((term) => ({
    ...term,
    basis: (anchors.find((a) => a.event === term.anchor.event && a.date === term.anchor.date)?.basis) ?? "",
  }));

  const resolvedRuleIds = new Set(suggested.map((t) => t.ruleId));
  const awaiting: AwaitingAnchor[] = ratified
    .filter((r) => !resolvedRuleIds.has(r.id))
    .map((r) => ({
      ruleId: r.id,
      deadlineType: r.deadline_type,
      label: r.label,
      citation: r.citation,
      anchorEvent: r.anchor_event,
      reason: "En espera de la fecha ancla — no se calcula sobre una suposición.",
    }));

  return { suggested, awaiting };
}
