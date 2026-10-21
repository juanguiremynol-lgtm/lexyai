export function bogotaDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function dailyWindowDue(source: string, now = new Date()) {
  if (source !== 'CRON') return true;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour >= 7;
}
export function dailyCompletion(expected: number, succeeded: number, failed: number, dispatched: number, skipped: number) {
  if (failed === 0 && dispatched === 0 && skipped === 0 && succeeded === expected) return 'SUCCESS';
  return succeeded > 0 || dispatched > 0 || skipped > 0 ? 'PARTIAL' : 'FAILED';
}