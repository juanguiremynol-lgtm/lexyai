export interface VerifiedHearingEvidence {
  source_act_id: string | null;
  scheduled_at: string;
  time_inferred: boolean;
}

/** Preserve an existing explicit time linked to this very act. Never infer
 * identity from a title/date, reuse another act, or modify the hearing. */
export function hearingAlreadyResolved(rows: readonly VerifiedHearingEvidence[], actId: string, day: string): boolean {
  const matches = rows.filter(r => r.source_act_id === actId && r.time_inferred === false &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(r.scheduled_at) && Number.isFinite(Date.parse(r.scheduled_at)) &&
    new Date(Date.parse(r.scheduled_at) - 5 * 3600_000).toISOString().slice(0,10) === day);
  return new Set(matches.map(r=>new Date(r.scheduled_at).toISOString())).size === 1;
}
