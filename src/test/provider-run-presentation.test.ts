import { describe, it, expect } from 'vitest';
import { providerRunInstant, providerRunPresentation } from '@/lib/provider-run-presentation';
describe('Source attempts and retained successful ingestion', () => {
  it('uses the real Bogota instant even for midnight UTC', () => {
    expect(providerRunInstant('2026-10-21T00:00:00Z')).toBe(new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date('2026-10-21T00:00:00Z')));
    expect(providerRunInstant('2026-10-21T00:00:00Z')).not.toBe(providerRunInstant('2026-10-21T05:00:00Z'));
  });
  it('keeps latest failed attempt apart from Familia 28 successful records', () => {
    const view = providerRunPresentation([
      { provider: 'cpnu', status: 'error', finished_at: '2026-10-21T12:00:00Z', error_code: 'PROVIDER_NO_RESPONSE', records_inserted: 0, records_skipped: 0 },
      { provider: 'cpnu', status: 'success', finished_at: '2026-10-21T01:49:58Z', error_code: null, records_inserted: 0, records_skipped: 28 },
      { provider: 'samai', status: 'success', finished_at: '2026-10-21T13:00:00Z', error_code: null, records_inserted: 0, records_skipped: 91 },
    ], 'cpnu');
    expect(view.latest?.error_code).toBe('PROVIDER_NO_RESPONSE');
    expect(view.accounted).toBe(28);
    expect(view.success?.finished_at).toBe('2026-10-21T01:49:58Z');
  });
  it('reports J15 source snapshot 53 without replacing it with cache 49 or stored chronology 54', () => {
    expect(providerRunPresentation([{ provider: 'cpnu', status: 'success', finished_at: '2026-10-21T01:50:00Z', error_code: null, records_inserted: 0, records_skipped: 53 }], 'cpnu').accounted).toBe(53);
  });
});