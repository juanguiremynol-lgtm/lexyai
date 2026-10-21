export interface ProviderRun {
  provider: string; status: string; finished_at: string; error_code: string | null;
  records_inserted: number; records_skipped: number;
}
export function providerRunInstant(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Fecha no informada';
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
export function providerRunPresentation(runs: ProviderRun[], source: string) {
  const ordered = runs.filter(run => run.provider === source).sort((a, b) => b.finished_at.localeCompare(a.finished_at));
  const latest = ordered[0] ?? null;
  const success = ordered.find(run => ['success', 'empty'].includes(run.status)) ?? null;
  return { latest, success, accounted: success ? success.records_inserted + success.records_skipped : null };
}