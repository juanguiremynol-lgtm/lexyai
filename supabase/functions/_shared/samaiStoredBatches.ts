export const SAMAI_BATCH_SIZE = 10;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SamaiBatchRequest =
  | { run: string; mode: 'prepare'; expected: number }
  | { run: string; mode: 'apply'; page: number };

export function parseSamaiBatchRequest(value: unknown): SamaiBatchRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { run, mode, expected, page } = value as Record<string, unknown>;
  if (typeof run !== 'string' || !uuid.test(run)) return null;
  if (mode === 'prepare' && typeof expected === 'number' && Number.isInteger(expected) && expected >= 1 && expected <= 500) {
    return { run, mode, expected };
  }
  if (mode === 'apply' && typeof page === 'number' && Number.isInteger(page) && page >= 0 && page < 50) {
    return { run, mode, page };
  }
  return null;
}

export function samaiBatchPrefix(workItemId: string, run: string) {
  if (!uuid.test(workItemId) || !uuid.test(run)) throw new Error('Invalid stored batch identity');
  return `samai_replay:${workItemId}:${run}:`;
}

export function storedSamaiPages<T>(acts: readonly T[], expected: number) {
  if (acts.length !== expected) return null;
  return Array.from({ length: Math.ceil(expected / SAMAI_BATCH_SIZE) }, (_, page) =>
    acts.slice(page * SAMAI_BATCH_SIZE, (page + 1) * SAMAI_BATCH_SIZE));
}

export function observedTodayInBogota(observed: unknown, now = Date.now()) {
  const value = typeof observed === 'string' ? Date.parse(observed) : NaN;
  const day = (ms: number) => new Date(ms - 5 * 3600_000).toISOString().slice(0, 10);
  return Number.isFinite(value) && value <= now && day(value) === day(now);
}
