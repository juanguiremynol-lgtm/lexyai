import { describe, it, expect } from 'vitest';
import { normalizeRadicado, normalizeRadicadoInput, formatRadicadoDisplay, validateCgpRadicado } from '../radicado-utils';

describe('normalizeRadicadoInput', () => {
  it('strips underscores from ICARUS format', () => {
    expect(normalizeRadicadoInput('110013337043_2026_0004700')).toBe('11001333704320260004700');
  });

  it('strips dashes', () => {
    expect(normalizeRadicadoInput('110013337043-2026-0004700')).toBe('11001333704320260004700');
  });

  it('strips spaces and trims', () => {
    expect(normalizeRadicadoInput(' 110013337043 2026 0004700 ')).toBe('11001333704320260004700');
  });

  it('strips dots and slashes', () => {
    expect(normalizeRadicadoInput('11.001.33.37043.2026.0004700')).toBe('11001333704320260004700');
  });

  it('strips tabs', () => {
    expect(normalizeRadicadoInput('11001\t3337043\t20260004700')).toBe('11001333704320260004700');
  });

  it('handles "Radicado: ..." copy/paste', () => {
    expect(normalizeRadicadoInput('Radicado: 11001333704320260004700')).toBe('11001333704320260004700');
  });

  it('preserves leading zeros', () => {
    expect(normalizeRadicadoInput('05001400302320250063800')).toBe('05001400302320250063800');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeRadicadoInput('')).toBe('');
  });

  it('returns empty string for null-ish input', () => {
    expect(normalizeRadicadoInput(undefined as any)).toBe('');
    expect(normalizeRadicadoInput(null as any)).toBe('');
  });
});

describe('normalizeRadicado (full validation)', () => {
  it('returns ok for valid 23-digit radicado', () => {
    const result = normalizeRadicado('11001333704320260004700');
    expect(result.ok).toBe(true);
    expect(result.radicado23).toBe('11001333704320260004700');
  });

  it('normalizes ICARUS underscore format to 23 digits', () => {
    const result = normalizeRadicado('110013337043_2026_0004700');
    expect(result.ok).toBe(true);
    expect(result.radicado23).toBe('11001333704320260004700');
  });

  it('normalizes dash format to 23 digits', () => {
    const result = normalizeRadicado('110013337043-2026-0004700');
    expect(result.ok).toBe(true);
    expect(result.radicado23).toBe('11001333704320260004700');
  });

  it('normalizes space format to 23 digits', () => {
    const result = normalizeRadicado(' 110013337043 2026 0004700 ');
    expect(result.ok).toBe(true);
    expect(result.radicado23).toBe('11001333704320260004700');
  });

  it('rejects too short', () => {
    const result = normalizeRadicado('1234567890');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TOO_SHORT');
  });

  it('rejects too long', () => {
    const result = normalizeRadicado('123456789012345678901234'); // 24 digits
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('TOO_LONG');
  });

  it('rejects empty input', () => {
    const result = normalizeRadicado('');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EMPTY_INPUT');
  });

  it('rejects non-digit only input', () => {
    const result = normalizeRadicado('abc-def-ghi');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_FORMAT');
  });
});

describe('validateCgpRadicado', () => {
  it('accepts 23-digit radicado ending in 00', () => {
    const result = validateCgpRadicado('05001400302320250063800');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('05001400302320250063800');
  });

  it('accepts 23-digit radicado ending in 01', () => {
    const result = validateCgpRadicado('05001400302320250063801');
    expect(result.valid).toBe(true);
  });

  it('rejects 23-digit radicado ending in 02', () => {
    const result = validateCgpRadicado('05001400302320250063802');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_ENDING');
  });
});

describe('formatRadicadoDisplay', () => {
  it('formats 23-digit radicado with separators', () => {
    expect(formatRadicadoDisplay('05001400302320250063800')).toBe('05-001-4003-023-2025-00638-00');
  });

  it('returns input unchanged if not 23 digits', () => {
    expect(formatRadicadoDisplay('12345')).toBe('12345');
  });
});
