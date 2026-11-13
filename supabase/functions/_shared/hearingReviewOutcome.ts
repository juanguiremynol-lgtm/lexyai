export interface HearingReview {
  reason: "HEARING_TIME_UNVERIFIED" | "HEARING_SUSPENSION_TARGET_UNVERIFIED";
  source_act_id: string;
  candidate_date?: string;
}

/** Identify a documentary handoff only if it accounts for every remaining
 * error, after both source completion and persistence readback are known. */
export function hearingReviewNote(review: HearingReview): string {
  return review.reason === "HEARING_TIME_UNVERIFIED"
    ? `Hearing date ${review.candidate_date} needs a verified time from source act ${review.source_act_id}`
    : `Hearing suspension requires an explicit target: ${review.source_act_id}`;
}

export function exclusivelyHearingReview(errors: readonly string[], notes: readonly HearingReview[]): boolean {
  if (!notes.length || !errors.length) return false;
  const messages = new Set(notes.map(hearingReviewNote));
  return errors.every(message => messages.has(message));
}
