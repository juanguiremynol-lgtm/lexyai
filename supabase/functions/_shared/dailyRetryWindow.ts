import { bogotaDay } from './dailyCompletion.ts';

/** The existing GCP feeds refresh at 02:00–02:40 Bogotá. This constrains
 * ordinary actuaciones retries, never publication follow-ups or user reads. */
export function actsRetryReadyAt(now: Date): Date {
  return new Date(`${bogotaDay(now)}T03:00:00-05:00`);
}

export function dailyRetryRunAfter(action: string, eligibleAt: string | null | undefined, now = new Date()): string {
  const parsed = Date.parse(eligibleAt ?? '');
  const proposed = new Date(Number.isFinite(parsed) ? parsed + 60_000 : now.getTime() + 3600_000);
  return new Date(action === 'RETRY_ACTS'
    ? Math.max(proposed.getTime(), actsRetryReadyAt(proposed).getTime())
    : proposed.getTime()).toISOString();
}
