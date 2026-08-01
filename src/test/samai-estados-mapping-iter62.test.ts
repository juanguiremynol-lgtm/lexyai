/**
 * Iteración 6.2 — SAMAI Estados mapping spec (ratificado).
 *
 * Reglas verificadas:
 *  1. Corroboración de identidad por partes: sin solapamiento de tokens en
 *     demandantes NI demandados, la fila NO se normaliza.
 *  2. El motor de términos jamás ancla FIJACION/DESFIJACION en filas cuyo
 *     source es 'samai_estados' (el payload no trae fechas de estado).
 */
import { describe, it, expect } from 'vitest';
import {
  corroborateParties,
  normalizeSamaiEstadosResponse,
} from '../../supabase/functions/_shared/providerAdapters/samaiEstadosAdapter.ts';

const row = (extra: Record<string, unknown> = {}) => ({
  'Fecha Providencia': '2026-07-03',
  'Actuación': 'Auto admite demanda',
  ...extra,
});

describe('SAMAI Estados — corroboración de partes', () => {
  it('acepta cuando hay solapamiento en demandantes', () => {
    expect(
      corroborateParties(row({ Demandante: 'SANDRA HERNANDEZ', Demandado: 'Municipio de Envigado' }), {
        demandantes: 'Sandra Hernandez',
        demandados: 'Municipio de Medellin',
      }),
    ).toBe(true);
  });

  it('rechaza cuando no hay solapamiento en ninguna parte', () => {
    expect(
      corroborateParties(row({ Demandante: 'Pedro Perez', Demandado: 'Municipio de Cali' }), {
        demandantes: 'Sandra Hernandez',
        demandados: 'Municipio de Medellin',
      }),
    ).toBe(false);
  });

  it('no bloquea cuando el payload no trae partes', () => {
    expect(corroborateParties(row(), { demandantes: 'X', demandados: 'Y' })).toBe(true);
  });

  it('descarta filas no corroboradas y las reporta', () => {
    const mismatches: any[] = [];
    const out = normalizeSamaiEstadosResponse(
      { actuaciones: [row({ Demandante: 'Pedro Perez', Demandado: 'Municipio de Cali' })] },
      { workItemId: 'wi-1', expectedParties: { demandantes: 'Sandra Hernandez', demandados: 'Municipio de Medellin' } },
      mismatches,
    );
    expect(out).toHaveLength(0);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].provider).toBe('samai_estados');
  });
});

describe('SAMAI Estados — sin anclas de fijación', () => {
  it('el mapeo ratificado no expone fecha de desfijación', () => {
    const out = normalizeSamaiEstadosResponse({ actuaciones: [row()] }, { workItemId: 'wi-1' });
    expect(out).toHaveLength(1);
    expect(out[0].fecha_desfijacion).toBeUndefined();
    // la única fecha del payload es la de providencia
    expect(out[0].fecha_providencia).toBe('2026-07-03');
  });
});
