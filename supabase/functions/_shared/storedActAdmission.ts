import type { DailyAdmission } from './dailyUpdateGate.ts';

/** A terminal daily gate may consume a later CPNU snapshot only. The caller
 * must restrict providers to CPNU, disable /buscar and disable force refresh. */
export function mayConsumeStoredCpnu(admission: DailyAdmission, workflow: string): boolean {
  return workflow !== 'CPACA' && admission.reason === 'DAILY_UPDATE_ALREADY_STARTED'
    && ['DONE', 'PARTIAL', 'FAILED', 'PENDING_UPSTREAM'].includes(String(admission.existing?.status));
}
