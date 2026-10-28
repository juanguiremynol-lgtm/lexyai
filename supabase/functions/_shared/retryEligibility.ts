type Item = { deleted_at: unknown; lifecycle_state: string; monitoring_enabled: boolean } | null;

/** Reevaluate every claimed task; a later legitimate reactivation is eligible. */
export function retryItemEligible(item: Item): boolean {
  return !!item && !item.deleted_at && item.lifecycle_state === 'ACTIVE' && item.monitoring_enabled === true;
}

export function retryItemDisposition(item: Item): 'ACTIVE' | 'PAUSED' | 'DELETED' | 'MISSING' {
  if (!item) return 'MISSING';
  if (item.deleted_at || item.lifecycle_state === 'DELETED') return 'DELETED';
  return retryItemEligible(item) ? 'ACTIVE' : 'PAUSED';
}

/** Only CPACA publications are exclusively SAMAI Estados. Tutela can also need PP. */
export function isExclusiveSamaiPublication(kind: string, workflow: string): boolean {
  return kind === 'PUB_RETRY' && workflow === 'CPACA';
}

export function samaiEnrollmentDecision(error: unknown, enrollment: { enabled: boolean } | null): 'UNAVAILABLE' | 'ENABLED' | 'DISABLED' {
  if (error) return 'UNAVAILABLE';
  return enrollment?.enabled === true ? 'ENABLED' : 'DISABLED';
}
