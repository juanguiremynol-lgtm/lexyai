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

export function occurredByToday(date: string, now = new Date()): boolean {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
}
