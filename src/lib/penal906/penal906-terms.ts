/**
 * penal906-terms.ts — Penal (Ley 906) deadline engine (iteration 31).
 *
 * The mechanism is built; it computes nothing until a rule is RATIFIED.
 * Anchors are hearing dates (ANCHOR_AUDIENCIA), procedural acts (ANCHOR_ACTO)
 * and notifications (ANCHOR_NOTIFICACION) — never fijación en estado.
 */
import { addBusinessDays, isBusinessDay } from "@/lib/colombian-holidays";
import type { PenalAnchorType, PenalDeadlineRule } from "@/hooks/use-workflow-deadline-rules";

/**
 * Note shown for a rule whose day type the statute does not fix (iteration 41).
 * Lives here, not in the hook, so pure logic never pulls in the data client.
 */
export const UNSPECIFIED_DAY_TYPE_NOTE =
  "tipo de día no especificado en la norma — pendiente de definición";

/**
 * Window during which the term does NOT run (Ley 2452 de 2025, art. 324: terms
 * do not run while the file is "al despacho"). `until` is null while the file
 * is still al despacho — the term stays suspended with no computable date.
 */
export interface SuspensionWindow {
  from: string;
  until: string | null;
  reason: string;
}

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
   * Also NULL while the term is suspended with the file al despacho and no
   * return date is known.
   */
  deadlineDate: string | null;
  /** True when the term is discharged orally at the anchoring hearing. */
  oralInHearing: boolean;
  requiresManualReview: boolean;
  /** Suspension days added because the file was al despacho. */
  suspendedDays?: number;
  /** True when the file is still al despacho and the term cannot be computed. */
  suspendedOpenEnded?: boolean;
}

function addCalendarDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Terms in months / years (art. 324): they end on the same day of the
 * corresponding month or year and, if that day is not a business day, they
 * extend to the next business day.
 */
function addMonthsOrYears(iso: string, amount: number, unit: "MONTHS" | "YEARS"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  if (unit === "YEARS") d.setUTCFullYear(d.getUTCFullYear() + amount);
  else d.setUTCMonth(d.getUTCMonth() + amount);
  // Overflow guard: 31-jan + 1 month must not become 3-mar.
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  let out = d.toISOString().slice(0, 10);
  while (!isBusinessDay(new Date(`${out}T00:00:00`))) {
    out = addCalendarDays(out, 1);
  }
  return out;
}

/** Business days the file spent al despacho inside a window. */
function suspendedBusinessDays(
  fromIso: string,
  suspensions: SuspensionWindow[],
): { days: number; openEnded: boolean } {
  let days = 0;
  let openEnded = false;
  for (const s of suspensions) {
    if (!s.until) {
      if (s.from >= fromIso) openEnded = true;
      continue;
    }
    if (s.until <= fromIso) continue;
    const start = s.from > fromIso ? s.from : fromIso;
    let cursor = start;
    while (cursor < s.until) {
      if (isBusinessDay(new Date(`${cursor}T00:00:00`))) days += 1;
      cursor = addCalendarDays(cursor, 1);
    }
  }
  return { days, openEnded };
}

export function ruleIsRatified(rule: PenalDeadlineRule): boolean {
  return rule.status === "RATIFIED" && !!rule.ratified_at;
}

/**
 * A rule whose day type the statute does not specify computes NOTHING
 * (iteration 41). Defence in depth: such rules cannot be ratified either.
 */
export function ruleComputesDate(rule: PenalDeadlineRule): boolean {
  return rule.day_type !== "UNSPECIFIED";
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
  suspensions: SuspensionWindow[] = [],
): PenalComputedTerm[] {
  const out: PenalComputedTerm[] = [];
  for (const rule of rules) {
    if (!ruleIsRatified(rule)) continue;
    if (!ruleComputesDate(rule)) continue;
    for (const anchor of anchors) {
      if (!anchorMatchesRule(rule, anchor)) continue;
      const oralInHearing =
        rule.day_type === "NONE" || rule.anchor_type === "ANCHOR_ORAL_EN_AUDIENCIA";
      const { days: suspendedDays, openEnded } = oralInHearing
        ? { days: 0, openEnded: false }
        : suspendedBusinessDays(anchor.date, suspensions);
      let deadlineDate: string | null;
      if (oralInHearing || openEnded) {
        deadlineDate = null;
      } else if (rule.day_type === "CALENDAR") {
        deadlineDate = addCalendarDays(anchor.date, rule.days_amount);
      } else if (rule.day_type === "MONTHS" || rule.day_type === "YEARS") {
        deadlineDate = addMonthsOrYears(anchor.date, rule.days_amount, rule.day_type);
      } else {
        deadlineDate = addBusinessDays(
          new Date(`${anchor.date}T00:00:00`),
          rule.days_amount + suspendedDays,
        )
          .toISOString()
          .slice(0, 10);
      }
      out.push({
        ruleId: rule.id,
        deadlineType: rule.deadline_type,
        label: rule.label,
        citation: rule.citation,
        anchor,
        deadlineDate,
        oralInHearing,
        requiresManualReview: rule.requires_manual_review,
        suspendedDays,
        suspendedOpenEnded: openEnded,
      });
    }
  }
  return out;
}

/** True when the penal term catalogue has no ratified rule yet. */
export function penalTermsPendingRatification(rules: PenalDeadlineRule[]): boolean {
  return !rules.some(ruleIsRatified);
}