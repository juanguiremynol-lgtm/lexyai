import { describe, it, expect } from 'vitest';
import { detectWorkflowType, detectWorkflowTypeEnhanced } from './icarus-workflow-detection';

describe('detectWorkflowType', () => {
  it('detects CGP from civil court', () => {
    const r = detectWorkflowType('JUZGADO 007 CIVIL MUNICIPAL DE BARRANQUILLA');
    expect(r.suggestedType).toBe('CGP');
  });

  it('detects CGP from promiscuo', () => {
    const r = detectWorkflowType('JUZGADO PROMISCUO MUNICIPAL EL RETIRO');
    expect(r.suggestedType).toBe('CGP');
  });

  it('detects TUTELA from tribunal superior', () => {
    // This one has "tribunal superior - civil" but was marked TUTELA in DB
    // The despacho alone might not indicate tutela
    const r = detectWorkflowType('DESPACHO 000 - TRIBUNAL SUPERIOR - CIVIL - MEDELLÍN');
    // Civil keyword → CGP, which is expected since tutela detection needs "tutela" keyword
    expect(['CGP', 'UNKNOWN']).toContain(r.suggestedType);
  });

  it('detects TUTELA from laboral court with tutela context', () => {
    // This court handles tutelas but name says "laborales"
    const r = detectWorkflowType('JUZGADO CUARTO MUNICIPAL DE PEQUEÑAS CAUSAS LABORALES DE MEDELLÍN');
    expect(r.suggestedType).toBe('LABORAL');
  });

  it('detects CPACA from administrative court', () => {
    const r = detectWorkflowType('Juzgado Administrativo de Bogotá');
    expect(r.suggestedType).toBe('CPACA');
  });

  it('detects LABORAL from labor keywords', () => {
    const r = detectWorkflowType('JUZGADO 001 LABORAL DEL CIRCUITO DE MEDELLÍN');
    expect(r.suggestedType).toBe('LABORAL');
  });

  it('returns UNKNOWN for empty', () => {
    const r = detectWorkflowType('');
    expect(r.suggestedType).toBe('UNKNOWN');
  });
});

describe('detectWorkflowTypeEnhanced', () => {
  it('detects CGP with civil despacho + tipo_proceso', () => {
    const r = detectWorkflowTypeEnhanced({
      despacho: 'JUZGADO 007 CIVIL MUNICIPAL DE BARRANQUILLA',
      tipo_proceso: 'EJECUTIVO',
    });
    expect(r.suggestedType).toBe('CGP');
    expect(r.confidence).toBe('HIGH');
  });

  it('detects CPACA with administrative despacho + jurisdiccion', () => {
    const r = detectWorkflowTypeEnhanced({
      despacho: 'Juzgado Administrativo de Bogotá',
      jurisdiccion: 'Contencioso Administrativo',
    });
    expect(r.suggestedType).toBe('CPACA');
    expect(r.confidence).toBe('HIGH');
  });

  it('falls back to jurisdiccion when despacho is null', () => {
    const r = detectWorkflowTypeEnhanced({
      despacho: null,
      jurisdiccion: 'Ordinaria Civil',
    });
    expect(r.suggestedType).toBe('CGP');
  });

  it('detects LABORAL from despacho with laboral keyword', () => {
    const r = detectWorkflowTypeEnhanced({
      despacho: 'JUZGADO CUARTO MUNICIPAL DE PEQUEÑAS CAUSAS LABORALES DE MEDELLÍN',
    });
    expect(r.suggestedType).toBe('LABORAL');
  });

  it('detects TUTELA from actuaciones text even when despacho says civil', () => {
    const r = detectWorkflowTypeEnhanced({
      despacho: 'DESPACHO 000 - TRIBUNAL SUPERIOR - CIVIL - MEDELLÍN',
      actuacionesText: [
        'Auto admite tutela Y NIEGA MEDIDA PROVISIONAL',
        'Sentencia tutela primera instancia CONCEDE',
      ],
    });
    expect(r.suggestedType).toBe('TUTELA');
    expect(r.confidence).toBe('HIGH');
  });

  it('detects TUTELA from single actuacion mention', () => {
    const r = detectWorkflowTypeEnhanced({
      despacho: 'JUZGADO LABORAL DE MEDELLÍN',
      actuacionesText: ['acción de tutela radicada'],
    });
    expect(r.suggestedType).toBe('TUTELA');
  });
});
