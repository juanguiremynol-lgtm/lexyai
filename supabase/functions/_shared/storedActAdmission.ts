import type { DailyAdmission } from './dailyUpdateGate.ts';

/** A terminal daily gate may consume a later CPNU snapshot only. The caller
 * must restrict providers to CPNU, disable /buscar and disable force refresh. */
export function mayConsumeStoredCpnu(admission: DailyAdmission, workflow: string): boolean {
  return workflow !== 'CPACA' && admission.reason === 'DAILY_UPDATE_ALREADY_STARTED'
    && ['DONE', 'PARTIAL', 'FAILED', 'PENDING_UPSTREAM'].includes(String(admission.existing?.status));
}

/** A terminal daily gate may consume a later certified SAMAI read only for
 * SAMAI-primary workflows (CPACA). The stored read is still re-assessed by
 * assessSamaiFeed (exact case, same Bogotá day, last attempt ok, verified
 * identity/pagination/persistence): a truly partial or stale read stays
 * non-success — this continuation never fabricates completeness nor
 * rejuvenates the source observation. The caller must restrict providers to
 * SAMAI, disable /buscar and disable force refresh. */
export function mayConsumeStoredSamai(admission: DailyAdmission, workflow: string): boolean {
  return workflow === 'CPACA' && admission.reason === 'DAILY_UPDATE_ALREADY_STARTED'
    && ['DONE', 'PARTIAL', 'FAILED', 'PENDING_UPSTREAM'].includes(String(admission.existing?.status));
}
