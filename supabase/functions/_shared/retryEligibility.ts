type Item = { deleted_at: unknown; lifecycle_state: string; monitoring_enabled: boolean } | null;

/** Reevaluate every claimed task; a later legitimate reactivation is eligible. */
export function retryItemEligible(item: Item): boolean {
  return !!item && !item.deleted_at && item.lifecycle_state === 'ACTIVE' && item.monitoring_enabled === true;
}

/** Only CPACA publications are exclusively SAMAI Estados. Tutela can also need PP. */
export function isExclusiveSamaiPublication(kind: string, workflow: string): boolean {
  return kind === 'PUB_RETRY' && workflow === 'CPACA';
}
