/**
 * penal906-terms.ts — Penal (Ley 906) deadline engine (iteration 31).
 *
 * The mechanism is built; it computes nothing until a rule is RATIFIED.
 * Anchors are hearing dates (ANCHOR_AUDIENCIA), procedural acts (ANCHOR_ACTO)
 * and notifications (ANCHOR_NOTIFICACION) — never fijación en estado.
 */
import { addBusinessDays } from "@/lib/colombian-holidays";
import type { PenalAnchorType, PenalDeadlineRule } from "@/hooks/use-workflow-deadline-rules";

export interface PenalAnchor {
  type: PenalAnchorType;
  /** Event key, e.g. AUDIENCIA_ACUSACION, SENTENCIA, MEDIDA_ASEGURAMIENTO. */
  event: string;
  /** ISO date (YYYY-MM-DD) of the anchoring hearing / act / notification. */
  date: string;
  sourceId?: string;
}

export interface PenalComputedTerm {
  ruleId: string;
  deadlineType: string;
  label: string;
  citation: string | null;
  anchor: PenalAnchor;
  /**
   * NULL for oral, in-hearing terms (ANCHOR_ORAL_EN_AUDIENCIA / day_type NONE):
   * there is no written term to count, so there is no date to render.
   */
  deadlineDate: string | null;
  /** True when the term is discharged orally at the anchoring hearing. */
  oralInHearing: boolean;
  requiresManualReview: boolean;
}

function addCalendarDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function ruleIsRatified(rule: PenalDeadlineRule): boolean {
  return rule.status === "RATIFIED" && !!rule.ratified_at;
}

export function anchorMatchesRule(rule: PenalDeadlineRule, anchor: PenalAnchor): boolean {
  if (rule.anchor_type !== anchor.type) return false;
  if (!rule.anchor_event) return true;
  return rule.anchor_event === anchor.event;
}

/**
 * Compute penal terms for a set of anchors.
 * DRAFT / RETIRED rules are silently skipped — they are a specification the
 * lawyer owns, not an active calculation.
 */
export function computePenalTerms(
  rules: PenalDeadlineRule[],
  anchors: PenalAnchor[],
): PenalComputedTerm[] {
  const out: PenalComputedTerm[] = [];
  for (const rule of rules) {
    if (!ruleIsRatified(rule)) continue;
    for (const anchor of anchors) {
      if (!anchorMatchesRule(rule, anchor)) continue;
      const oralInHearing =
        rule.day_type === "NONE" || rule.anchor_type === "ANCHOR_ORAL_EN_AUDIENCIA";
      const deadlineDate = oralInHearing
        ? null
        : rule.day_type === "CALENDAR"
          ? addCalendarDays(anchor.date, rule.days_amount)
          : addBusinessDays(new Date(`${anchor.date}T00:00:00`), rule.days_amount)
              .toISOString()
              .slice(0, 10);
      out.push({
        ruleId: rule.id,
        deadlineType: rule.deadline_type,
        label: rule.label,
        citation: rule.citation,
        anchor,
        deadlineDate,
        oralInHearing,
        requiresManualReview: rule.requires_manual_review,
      });
    }
  }
  return out;
}

/** True when the penal term catalogue has no ratified rule yet. */
export function penalTermsPendingRatification(rules: PenalDeadlineRule[]): boolean {
  return !rules.some(ruleIsRatified);
}