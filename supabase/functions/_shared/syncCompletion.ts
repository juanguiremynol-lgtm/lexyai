export interface PersistenceLedger {
  parsed: number;
  inserted: number;
  updated: number;
  skippedDuplicate: number;
  skippedStructural: number;
  rejected: number;
  errored: number;
}

/** A retry may repeat a complete snapshot, but missing or rejected rows are partial. */
export function persistenceIsComplete(ledger: PersistenceLedger): boolean {
  return ledger.errored === 0 && ledger.rejected === 0 && ledger.skippedStructural === 0 &&
    ledger.parsed === ledger.inserted + ledger.updated + ledger.skippedDuplicate;
}

/** Re-evaluate after every required provider has finished, including enrichers. */
export function requiredSourcesComplete(initial: boolean, attempts: ReadonlyArray<{ status: string }>): boolean {
  return initial && attempts.length > 0 && attempts.every(a => a.status === 'success' || a.status === 'empty');
}

/** Source completion and downstream side effects are independent outcomes. */
export function ingestionOutcome(sourceComplete: boolean, effectErrors: ReadonlyArray<unknown>): { sourceComplete: boolean; effectsPending: boolean } {
  return { sourceComplete, effectsPending: sourceComplete && effectErrors.length > 0 };
}

/** Called only after a positively validated empty source response. */
export async function recordEmptyInitialCompletion(db: any, workItemId: string, observedAt?: string, now = new Date()): Promise<void> {
  const { error } = await db.from('work_items')
    .update({ acts_initial_sync_completed_at: observedAt || now.toISOString() })
    .eq('id', workItemId).is('acts_initial_sync_completed_at', null);
  if (error) throw error;
}

export function occurredByToday(date: string, now = new Date()): boolean {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
}
