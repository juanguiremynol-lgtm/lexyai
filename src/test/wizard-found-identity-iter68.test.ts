import { describe, it, expect } from 'vitest';
import { toWizardResult } from '../../supabase/functions/_shared/providerAdapters/bridge.ts';

const base = {
  provider: 'cpnu',
  actuaciones: [],
  publicaciones: [],
  metadata: null,
  parties: null,
  durationMs: 10,
} as any;

describe('toWizardResult — provider-confirmed identity without actuaciones', () => {
  it('marks a freshly filed radicado as found when metadata proves it exists', () => {
    const r = toWizardResult({
      ...base,
      status: 'EMPTY',
      metadata: { despacho: 'DESPACHO 006 - JUZGADO MUNICIPAL - LABORAL - MEDELLÍN', fecha_radicacion: '2026-08-18' },
    });
    expect(r.found).toBe(true);
    expect(r.eventsFound).toBe(0);
    expect(r.processData.despacho).toContain('LABORAL');
  });

  it('marks as found when only parties are known', () => {
    const r = toWizardResult({ ...base, status: 'EMPTY', parties: { demandante: 'MARÍA ODILIA MONTOYA', demandado: null } });
    expect(r.found).toBe(true);
  });

  it('stays not-found when the provider returned nothing at all', () => {
    const r = toWizardResult({ ...base, status: 'EMPTY' });
    expect(r.found).toBe(false);
  });

  it('still found when actuaciones exist', () => {
    const r = toWizardResult({ ...base, status: 'SUCCESS', actuaciones: [{ fecha_actuacion: '2026-08-18', actuacion: 'Reparto' }] });
    expect(r.found).toBe(true);
  });
});
