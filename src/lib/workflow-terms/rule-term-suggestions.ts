/**
 * rule-term-suggestions.ts — surfaces terms computed from RATIFIED workflow
 * deadline rules (iteration 38).
 *
 * Invariant: nothing auto-applies. Every term produced here is a SUGGESTION the
 * lawyer confirms. A ratified rule whose anchor date is unknown is rendered as
 * "awaiting the anchor date" — never computed from a guess.
 */
import { addBusinessDays } from "@/lib/colombian-holidays";
import {
  computePenalTerms,
  ruleIsRatified,
  type PenalAnchor,
  type PenalComputedTerm,
  type SuspensionWindow,
} from "@/lib/penal906/penal906-terms";
import {
  UNSPECIFIED_DAY_TYPE_NOTE,
  type WorkflowDeadlineRule,
} from "@/hooks/use-workflow-deadline-rules";

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
  /** Set when the term belongs to a conflicting-norm group (antinomia). */
  antinomiaGroup?: string | null;
}

/**
 * Rule whose day type the statute leaves unspecified: shown with its article
 * and anchor, never computed (iteration 41).
 */
export interface UnspecifiedDayTypeRule {
  ruleId: string;
  deadlineType: string;
  label: string;
  citation: string | null;
  anchorEvent: string | null;
  daysAmount: number;
  daysAmountMax: number | null;
  variantDaysAmount: number | null;
  variantCondition: string | null;
  /** Which direction is conservative for THIS term — it differs per term. */
  conservativeNote: string | null;
  note: string;
}

export interface AntinomiaMember {
  ruleId: string;
  label: string;
  citation: string | null;
  daysAmount: number;
  daysAmountMax: number | null;
  dayType: string;
  deadlineDate: string | null;
  isOperative: boolean;
  isDesignated: boolean;
}

/** Two norms fix different terms for the same act. Never resolved silently. */
export interface AntinomiaConflict {
  group: string;
  members: AntinomiaMember[];
  operativeRuleId: string | null;
  designatedRuleId: string | null;
  designatedAt: string | null;
  designatedBy: string | null;
}

export interface RuleTermSuggestions {
  suggested: SuggestedRuleTerm[];
  awaiting: AwaitingAnchor[];
  unspecified: UnspecifiedDayTypeRule[];
  antinomias: AntinomiaConflict[];
}

/**
 * Terms for the RATIFIED rules of a workflow/track, plus the ratified rules
 * whose anchor date is not yet known.
 */
export function buildRuleTermSuggestions(
  rules: WorkflowDeadlineRule[],
  events: TermEvent[],
  /**
   * Anchor events the caller considers relevant for this matter. Ratified rules
   * with one of these anchors and no known date are listed as "awaiting"; the
   * rest of the catalogue stays silent instead of flooding the card.
   */
  awaitingAnchorEvents: string[] = [],
  /**
   * Extra anchors the caller resolved elsewhere (e.g. the two-stage TIC
   * notification) and windows during which terms do not run (al despacho).
   */
  extra: { anchors?: (PenalAnchor & { basis?: string })[]; suspensions?: SuspensionWindow[] } = {},
): RuleTermSuggestions {
  const live = rules.filter((r) => r.status !== "RETIRED");
  const ratified = live.filter(ruleIsRatified);
  const anchors: ResolvedAnchor[] = [
    ...resolveAnchorsFromEvents(events),
    ...(extra.anchors ?? []).map((a) => ({ ...a, basis: a.basis ?? "" })),
  ];
  const computed = computePenalTerms(ratified, anchors, extra.suspensions ?? []);

  const byRuleId = new Map(live.map((r) => [r.id, r]));
  let suggested: SuggestedRuleTerm[] = computed.map((term) => ({
    ...term,
    basis: (anchors.find((a) => a.event === term.anchor.event && a.date === term.anchor.date)?.basis) ?? "",
    antinomiaGroup: byRuleId.get(term.ruleId)?.antinomia_group ?? null,
  }));

  // ── Antinomias ────────────────────────────────────────────────────────────
  // The engine keeps the SHORTER term as the operative suggestion (the
  // conservative reading protects against negligence) unless the owner has
  // designated which norm governs. Both articles stay visible either way.
  const groups = new Map<string, WorkflowDeadlineRule[]>();
  for (const r of live) {
    if (!r.antinomia_group) continue;
    groups.set(r.antinomia_group, [...(groups.get(r.antinomia_group) ?? []), r]);
  }

  const antinomias: AntinomiaConflict[] = [];
  for (const [group, members] of groups) {
    const designatedRuleId =
      members.find((m) => m.antinomia_designated_rule_id)?.antinomia_designated_rule_id ?? null;
    const shortest = [...members].sort((a, b) => a.days_amount - b.days_amount)[0];
    const operativeRuleId = designatedRuleId ?? shortest?.id ?? null;
    antinomias.push({
      group,
      operativeRuleId,
      designatedRuleId,
      designatedAt: members.find((m) => m.antinomia_designated_at)?.antinomia_designated_at ?? null,
      designatedBy: members.find((m) => m.antinomia_designated_by)?.antinomia_designated_by ?? null,
      members: members.map((m) => ({
        ruleId: m.id,
        label: m.label,
        citation: m.citation,
        daysAmount: m.days_amount,
        daysAmountMax: m.days_amount_max ?? null,
        dayType: m.day_type,
        deadlineDate: computed.find((c) => c.ruleId === m.id)?.deadlineDate ?? null,
        isOperative: m.id === operativeRuleId,
        isDesignated: !!designatedRuleId && m.id === designatedRuleId,
      })),
    });
  }

  // Only the operative member of a group is offered as a term to confirm.
  const nonOperative = new Set(
    antinomias.flatMap((a) => a.members.filter((m) => !m.isOperative).map((m) => m.ruleId)),
  );
  suggested = suggested.filter((t) => !nonOperative.has(t.ruleId));

  const resolvedRuleIds = new Set(suggested.map((t) => t.ruleId));
  const awaiting: AwaitingAnchor[] = ratified
    .filter((r) => !resolvedRuleIds.has(r.id))
    .filter((r) => !nonOperative.has(r.id))
    .filter((r) => !!r.anchor_event && awaitingAnchorEvents.includes(r.anchor_event))
    .map((r) => ({
      ruleId: r.id,
      deadlineType: r.deadline_type,
      label: r.label,
      citation: r.citation,
      anchorEvent: r.anchor_event,
      reason: "En espera de la fecha ancla — no se calcula sobre una suposición.",
    }));

  const unspecified: UnspecifiedDayTypeRule[] = live
    .filter((r) => r.day_type === "UNSPECIFIED")
    .map((r) => ({
      ruleId: r.id,
      deadlineType: r.deadline_type,
      label: r.label,
      citation: r.citation,
      anchorEvent: r.anchor_event,
      daysAmount: r.days_amount,
      daysAmountMax: r.days_amount_max ?? null,
      variantDaysAmount: r.variant_days_amount ?? null,
      variantCondition: r.variant_condition ?? null,
      conservativeNote: r.description ?? null,
      note: UNSPECIFIED_DAY_TYPE_NOTE,
    }));

  return { suggested, awaiting, unspecified, antinomias };
}
