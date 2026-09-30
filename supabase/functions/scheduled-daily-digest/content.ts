/** Whether a digest day has anything the lawyer must see. Manual-review
 * terms are content: a day with only reviews must never be EMPTY_NO_EMAIL. */
export function digestHasContent(p: { rowCount: number; manualReviewCount: number; coverageIncomplete: boolean }): boolean {
  return p.rowCount + p.manualReviewCount > 0 || p.coverageIncomplete;
}
