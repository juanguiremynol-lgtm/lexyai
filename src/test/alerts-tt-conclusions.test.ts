import { describe, it, expect } from 'vitest';
import {
  DOCTRINE_ALERT_TYPES,
  alertTypeLabel,
  groupAlertsByType,
  isDoctrineAlertType,
} from '@/lib/alerts/doctrine';

/**
 * TT2/TT3 — the alert catalogue must expose the two corrected classes:
 *  - a matter whose radicado no source can match is its own class,
 *    not a generic "monitoring without ingestion" gap;
 *  - the appellate alert keeps its type but changes conclusion/severity.
 */
describe('alert doctrine — TT2/TT3 classes', () => {
  it('registers RADICADO_SIN_COINCIDENCIA as a doctrine alert', () => {
    expect(isDoctrineAlertType('RADICADO_SIN_COINCIDENCIA')).toBe(true);
    expect(DOCTRINE_ALERT_TYPES).toContain('RADICADO_SIN_COINCIDENCIA');
  });

  it('labels both classes in Spanish', () => {
    expect(alertTypeLabel('RADICADO_SIN_COINCIDENCIA')).toBe('Radicado sin coincidencia en fuentes');
    expect(alertTypeLabel('ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE')).toBe('Apelación en el superior');
  });

  it('keeps the data-quality class separate from monitoring gaps when grouping', () => {
    const groups = groupAlertsByType([
      { id: '1', alert_type: 'MONITOREO_SIN_INGESTA', severity: 'WARNING' },
      { id: '2', alert_type: 'RADICADO_SIN_COINCIDENCIA', severity: 'WARNING' },
      { id: '3', alert_type: 'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE', severity: 'INFO' },
    ]);
    expect(groups.map((g) => g.type)).toEqual([
      'MONITOREO_SIN_INGESTA',
      'RADICADO_SIN_COINCIDENCIA',
      'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE',
    ]);
    expect(groups.every((g) => g.count === 1)).toBe(true);
  });
});
