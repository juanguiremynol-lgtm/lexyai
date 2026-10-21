import { describe, it, expect } from 'vitest';
import { civilDate, formatCivilDate, compareCivilDesc } from '@/lib/civil-date';

describe('civil dates (Bogotá)', () => {
  it('a date-only value keeps its own day (no UTC shift to the previous day)', () => {
    expect(civilDate('2026-10-20')).toBe('2026-10-20');
    expect(formatCivilDate('2026-10-20')).toMatch(/20/);
  });
  it('midnight and noon UTC placeholders are the civil day', () => {
    expect(civilDate('2026-10-20T00:00:00+00:00')).toBe('2026-10-20');
    expect(civilDate('2026-10-20T12:00:00Z')).toBe('2026-10-20');
  });
  it('a real timestamp converts to the Bogotá day', () => {
    expect(civilDate('2026-10-21T03:30:00Z')).toBe('2026-10-20');
    expect(civilDate('2026-10-20T15:30:00Z')).toBe('2026-10-20');
  });
  it('radicado-derived and textual non-dates are not informed', () => {
    expect(civilDate('0131-10-01T12:00:00+00:00')).toBeNull();
    expect(formatCivilDate('sin-fecha')).toBe('Fecha no informada');
    expect(formatCivilDate(null)).toBe('Fecha no informada');
    expect(civilDate('2026-02-30')).toBeNull();
  });
  it('sorting puts undated rows last', () => {
    const rows = [null, '2026-10-01', '0131-10-01', '2026-10-20'];
    expect([...rows].sort(compareCivilDesc)).toEqual(['2026-10-20', '2026-10-01', null, '0131-10-01']);
  });
});

import { formatDateColombia } from '@/lib/constants';
describe('provider card dates', () => {
  it('a CPNU last-action calendar date shows the same day as the timeline', () => {
    expect(formatDateColombia('2026-10-20')).toMatch(/^20 de octubre de 2026$/);
  });
});
