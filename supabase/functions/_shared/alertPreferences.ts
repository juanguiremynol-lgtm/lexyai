/**
 * Alert preferences contract (alert_preferences.preferences jsonb).
 * Mirrored in src/lib/alert-preferences.ts — keep both identical.
 * Missing row / missing key => current platform defaults.
 */
export const SUPPORTED_TERM_MILESTONES = ["D-8", "D-3", "D-1", "D-DAY"] as const;
export type TermMilestone = typeof SUPPORTED_TERM_MILESTONES[number];

export interface AlertPrefs {
  term_milestones: TermMilestone[];
  overdue: boolean;
  manual_review_info: boolean;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  term_milestones: [...SUPPORTED_TERM_MILESTONES],
  overdue: true,
  manual_review_info: true,
};

export function normalizeAlertPrefs(raw: unknown): AlertPrefs {
  const r = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const ms = Array.isArray(r.term_milestones)
    ? (r.term_milestones as unknown[]).filter((m): m is TermMilestone =>
        typeof m === "string" && (SUPPORTED_TERM_MILESTONES as readonly string[]).includes(m))
    : DEFAULT_ALERT_PREFS.term_milestones;
  return {
    term_milestones: ms,
    overdue: typeof r.overdue === "boolean" ? r.overdue : DEFAULT_ALERT_PREFS.overdue,
    manual_review_info: typeof r.manual_review_info === "boolean"
      ? r.manual_review_info : DEFAULT_ALERT_PREFS.manual_review_info,
  };
}
