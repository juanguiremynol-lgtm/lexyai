/** Terminal outcomes for every parsed SAMAI publication, including structural reuse. */
export type SamaiPersistBucket = 'INSERTED' | 'SKIPPED_DUPLICATE' | 'SKIPPED_DUPLICATE_STRUCTURAL'
  | 'SKIPPED_CROSS_SOURCE' | 'REJECTED_PARTIES' | 'REJECTED_TRIGGER' | 'ERROR';

export function emptySamaiBuckets(): Record<SamaiPersistBucket, number> {
  return { INSERTED: 0, SKIPPED_DUPLICATE: 0, SKIPPED_DUPLICATE_STRUCTURAL: 0,
    SKIPPED_CROSS_SOURCE: 0, REJECTED_PARTIES: 0, REJECTED_TRIGGER: 0, ERROR: 0 };
}

export function samaiAccountingComplete(summary: any): boolean {
  const values = Object.values(summary?.buckets ?? {});
  return values.length > 0 && values.every(v => Number.isInteger(v) && Number(v) >= 0)
    && Number.isInteger(summary?.parsed_count) && summary.parsed_count >= 0
    && summary.accounted_count === summary.parsed_count
    && values.reduce<number>((sum, n) => sum + Number(n), 0) === summary.parsed_count
    && ['ERROR', 'REJECTED_PARTIES', 'REJECTED_TRIGGER'].every(k => summary.buckets[k] === 0);
}
