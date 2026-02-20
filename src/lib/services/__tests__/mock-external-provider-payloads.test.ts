import { describe, it, expect } from 'vitest';

/**
 * Structural tests for mock external provider payloads.
 * These verify the payload shape matches what the real pipeline expects,
 * without calling any edge function.
 */

// Replicate the mock payload generators for unit testing
function deterministicId(seed: number, suffix: string): string {
  const base = `mock-${seed}-${suffix}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function cpnuPayload(radicado: string, scenario: string, seed: number) {
  if (scenario === 'EMPTY') return { actuaciones: [] };
  if (scenario === 'ERROR_404') return { error: 'Radicado no encontrado', code: 'NOT_FOUND' };
  return {
    actuaciones: [{
      idRegActuacion: deterministicId(seed, 'cpnu-act'),
      consActuacion: 1,
      fechaActuacion: '2026-02-19',
      fechaRegistro: new Date().toISOString(),
      actuacion: scenario === 'MODIFIED_MOVEMENT'
        ? 'AUTO INTERLOCUTORIO - Modificado'
        : 'AUTO INTERLOCUTORIO - Fija fecha para audiencia inicial',
      anotacion: `Anotación mock (seed=${seed})`,
      existDocument: false,
      cant: 0,
      conlesProcesoRama: radicado,
      esPrivado: false,
    }],
  };
}

function samaiPayload(radicado: string, scenario: string, seed: number) {
  if (scenario === 'EMPTY') return { actuaciones: [] };
  if (scenario === 'ERROR_404') return { error: 'Proceso no encontrado', code: 'RECORD_NOT_FOUND' };
  return {
    actuaciones: [{
      id: deterministicId(seed, 'samai-act'),
      fechaActuacion: '2026-02-19',
      fechaRegistro: new Date().toISOString(),
      tipoActuacion: 'Auto',
      descripcion: `Auto interlocutorio SAMAI mock (seed=${seed})`,
      anotacion: 'Anotación SAMAI mock',
      radicado,
    }],
  };
}

function publicacionesPayload(radicado: string, scenario: string, seed: number) {
  if (scenario === 'EMPTY') return { publicaciones: [] };
  if (scenario === 'ERROR_404') return { error: 'Sin publicaciones', code: 'NOT_FOUND' };
  return {
    publicaciones: [{
      id: deterministicId(seed, 'pub'),
      fechaFijacion: '2026-02-19',
      fechaDesfijacion: '2026-02-20',
      titulo: `Fijación en lista mock (seed=${seed})`,
      tipoPublicacion: 'AUTO INTERLOCUTORIO',
      radicado,
      proceso: radicado,
    }],
  };
}

function tutelasPayload(radicado: string, scenario: string, seed: number) {
  if (scenario === 'EMPTY') return { actuaciones: [] };
  if (scenario === 'ERROR_404') return { error: 'Tutela no encontrada', code: 'RECORD_NOT_FOUND' };
  return {
    actuaciones: [{
      id: deterministicId(seed, 'tutela-act'),
      fechaActuacion: '2026-02-19',
      fechaRegistro: new Date().toISOString(),
      tipo: 'Providencia',
      descripcion: `Sentencia tutela mock (seed=${seed})`,
      anotacion: 'Mock tutela anotación',
      radicado,
    }],
  };
}

function samaiEstadosPayload(radicado: string, scenario: string, seed: number) {
  if (scenario === 'EMPTY') return { estados: [] };
  if (scenario === 'ERROR_404') return { error: 'Sin estados', code: 'NOT_FOUND' };
  return {
    estados: [{
      id: deterministicId(seed, 'samai-estado'),
      fechaFijacion: '2026-02-19',
      fechaDesfijacion: '2026-02-20',
      titulo: `Estado SAMAI mock (seed=${seed})`,
      tipoPublicacion: 'AUTO',
      radicado,
    }],
  };
}

describe('Mock Provider Payloads — CPNU', () => {
  const radicado = '05001400302020250187800';

  it('NEW_MOVEMENT returns actuaciones array with required fields', () => {
    const p = cpnuPayload(radicado, 'NEW_MOVEMENT', 42);
    expect(p.actuaciones).toHaveLength(1);
    expect(p.actuaciones[0]).toHaveProperty('idRegActuacion');
    expect(p.actuaciones[0]).toHaveProperty('fechaActuacion');
    expect(p.actuaciones[0]).toHaveProperty('actuacion');
    expect(p.actuaciones[0]).toHaveProperty('anotacion');
    expect(p.actuaciones[0].conlesProcesoRama).toBe(radicado);
  });

  it('EMPTY returns empty actuaciones', () => {
    const p = cpnuPayload(radicado, 'EMPTY', 42);
    expect(p.actuaciones).toHaveLength(0);
  });

  it('ERROR_404 returns error object', () => {
    const p = cpnuPayload(radicado, 'ERROR_404', 42);
    expect(p).toHaveProperty('error');
    expect(p).toHaveProperty('code', 'NOT_FOUND');
  });

  it('MODIFIED_MOVEMENT changes actuacion text', () => {
    const original = cpnuPayload(radicado, 'NEW_MOVEMENT', 42);
    const modified = cpnuPayload(radicado, 'MODIFIED_MOVEMENT', 42);
    expect(original.actuaciones![0].actuacion).not.toBe(modified.actuaciones![0].actuacion);
  });

  it('is deterministic for same seed', () => {
    const a = cpnuPayload(radicado, 'NEW_MOVEMENT', 42);
    const b = cpnuPayload(radicado, 'NEW_MOVEMENT', 42);
    expect(a.actuaciones![0].idRegActuacion).toBe(b.actuaciones![0].idRegActuacion);
  });
});

describe('Mock Provider Payloads — SAMAI', () => {
  it('NEW_MOVEMENT returns actuaciones with id', () => {
    const p = samaiPayload('test', 'NEW_MOVEMENT', 1);
    expect(p.actuaciones).toHaveLength(1);
    expect(p.actuaciones[0]).toHaveProperty('id');
    expect(p.actuaciones[0]).toHaveProperty('tipoActuacion');
  });

  it('EMPTY returns empty', () => {
    expect(samaiPayload('test', 'EMPTY', 1).actuaciones).toHaveLength(0);
  });
});

describe('Mock Provider Payloads — Publicaciones', () => {
  it('NEW_MOVEMENT returns publicaciones with required fields', () => {
    const p = publicacionesPayload('test', 'NEW_MOVEMENT', 1);
    expect(p.publicaciones).toHaveLength(1);
    expect(p.publicaciones[0]).toHaveProperty('fechaFijacion');
    expect(p.publicaciones[0]).toHaveProperty('titulo');
    expect(p.publicaciones[0]).toHaveProperty('tipoPublicacion');
  });
});

describe('Mock Provider Payloads — Tutelas', () => {
  it('NEW_MOVEMENT returns actuaciones with tipo', () => {
    const p = tutelasPayload('test', 'NEW_MOVEMENT', 1);
    expect(p.actuaciones).toHaveLength(1);
    expect(p.actuaciones[0]).toHaveProperty('tipo', 'Providencia');
  });
});

describe('Mock Provider Payloads — SAMAI Estados', () => {
  it('NEW_MOVEMENT returns estados with required fields', () => {
    const p = samaiEstadosPayload('test', 'NEW_MOVEMENT', 1);
    expect(p.estados).toHaveLength(1);
    expect(p.estados[0]).toHaveProperty('fechaFijacion');
    expect(p.estados[0]).toHaveProperty('tipoPublicacion');
  });

  it('EMPTY returns empty', () => {
    expect(samaiEstadosPayload('test', 'EMPTY', 1).estados).toHaveLength(0);
  });
});

describe('Deterministic ID generation', () => {
  it('produces consistent IDs for same inputs', () => {
    expect(deterministicId(42, 'test')).toBe(deterministicId(42, 'test'));
  });

  it('produces different IDs for different seeds', () => {
    expect(deterministicId(1, 'test')).not.toBe(deterministicId(2, 'test'));
  });

  it('produces different IDs for different suffixes', () => {
    expect(deterministicId(1, 'a')).not.toBe(deterministicId(1, 'b'));
  });
});
