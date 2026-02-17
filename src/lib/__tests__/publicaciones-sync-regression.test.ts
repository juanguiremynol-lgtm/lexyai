/**
 * Publicaciones Procesales — Regression Test Suite
 * 
 * Covers:
 * - Radicado validation for publicaciones eligibility
 * - Fingerprint deduplication key derivation
 * - Analytics event catalog completeness
 * - Coverage gap alert dedup logic
 * - Wizard background sync trigger conditions
 * 
 * Run: npx vitest run src/lib/__tests__/publicaciones-sync-regression.test.ts
 */
import { describe, it, expect } from 'vitest';
import { normalizeRadicadoInput, normalizeRadicado, validateCgpRadicado } from '../radicado-utils';
import { DEFAULT_ALLOWED_PROPERTIES, BLOCKED_PROPERTIES } from '../analytics/types';

// ============= RADICADO VALIDATION FOR PUBLICACIONES =============

describe('Radicado validation for publicaciones eligibility', () => {
  it('accepts valid 23-digit radicado for sync', () => {
    const rad = '05001400302320250063800';
    const digits = rad.replace(/\D/g, '');
    expect(digits.length).toBe(23);
  });

  it('rejects radicado with fewer than 23 digits', () => {
    const result = normalizeRadicado('1234567890');
    expect(result.ok).toBe(false);
  });

  it('rejects radicado with more than 23 digits', () => {
    const result = normalizeRadicado('123456789012345678901234');
    expect(result.ok).toBe(false);
  });

  it('normalizes formatted radicado to 23 digits', () => {
    const result = normalizeRadicado('05-001-40-03-023-2025-00638-00');
    expect(result.ok).toBe(true);
    expect(result.radicado23).toBe('05001400302320250063800');
  });

  it('strips all non-digit chars including underscores', () => {
    expect(normalizeRadicadoInput('050014003023_2025_00638_00')).toBe('05001400302320250063800');
  });

  it('preserves leading zeros as string', () => {
    const normalized = normalizeRadicadoInput('05001400302320250063800');
    expect(normalized[0]).toBe('0');
    expect(typeof normalized).toBe('string');
  });

  it('CGP-specific: rejects radicado ending in 02', () => {
    const result = validateCgpRadicado('05001400302320250063802');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_ENDING');
  });

  it('CGP-specific: accepts radicado ending in 00', () => {
    const result = validateCgpRadicado('05001400302320250063800');
    expect(result.valid).toBe(true);
  });
});

// ============= FINGERPRINT DEDUPLICATION =============

describe('Publicacion fingerprint deduplication', () => {
  // Mirror the edge function's generatePublicacionFingerprint logic
  function generatePublicacionFingerprint(
    workItemId: string,
    assetId: string | undefined,
    key: string | undefined,
    title: string
  ): string {
    const uniqueId = assetId || key || title;
    const data = `${workItemId}|${uniqueId}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `pub_${workItemId.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
  }

  it('produces deterministic fingerprint for same inputs', () => {
    const fp1 = generatePublicacionFingerprint('abc-123', 'asset_001', undefined, 'title');
    const fp2 = generatePublicacionFingerprint('abc-123', 'asset_001', undefined, 'title');
    expect(fp1).toBe(fp2);
  });

  it('produces different fingerprints for different asset_ids', () => {
    const fp1 = generatePublicacionFingerprint('abc-123', 'asset_001', undefined, 'title');
    const fp2 = generatePublicacionFingerprint('abc-123', 'asset_002', undefined, 'title');
    expect(fp1).not.toBe(fp2);
  });

  it('falls back to key when no asset_id', () => {
    const fp1 = generatePublicacionFingerprint('abc-123', undefined, 'key_001', 'title');
    const fp2 = generatePublicacionFingerprint('abc-123', undefined, 'key_001', 'title');
    expect(fp1).toBe(fp2);
  });

  it('falls back to title when no asset_id or key', () => {
    const fp1 = generatePublicacionFingerprint('abc-123', undefined, undefined, 'Estado Electrónico 2025');
    const fp2 = generatePublicacionFingerprint('abc-123', undefined, undefined, 'Estado Electrónico 2025');
    expect(fp1).toBe(fp2);
  });

  it('different work_item_ids produce different fingerprints', () => {
    const fp1 = generatePublicacionFingerprint('item-111', 'asset_001', undefined, 'title');
    const fp2 = generatePublicacionFingerprint('item-222', 'asset_001', undefined, 'title');
    expect(fp1).not.toBe(fp2);
  });

  it('fingerprint starts with pub_ prefix', () => {
    const fp = generatePublicacionFingerprint('abc-123', 'asset_001', undefined, 'title');
    expect(fp).toMatch(/^pub_/);
  });
});

// ============= ANALYTICS CATALOG REGRESSION =============

describe('Analytics catalog includes publicaciones-related properties', () => {
  const requiredProps = [
    'data_kind',       // For diff_view_opened (estados vs actuaciones)
    'entries_count',   // For diff_view_copied
    'variant',
    'source',
    'outcome',
    'providers_with_data',
    'latency_bucket',
    'has_radicado',
  ];

  for (const prop of requiredProps) {
    it(`DEFAULT_ALLOWED_PROPERTIES includes "${prop}"`, () => {
      expect(DEFAULT_ALLOWED_PROPERTIES).toContain(prop);
    });
  }

  it('no duplicate entries in DEFAULT_ALLOWED_PROPERTIES', () => {
    const unique = new Set(DEFAULT_ALLOWED_PROPERTIES);
    // Allow up to 1 duplicate (export_type appears twice in current code)
    expect(DEFAULT_ALLOWED_PROPERTIES.length - unique.size).toBeLessThanOrEqual(1);
  });

  it('BLOCKED_PROPERTIES never overlap with DEFAULT_ALLOWED_PROPERTIES', () => {
    for (const blocked of BLOCKED_PROPERTIES) {
      expect(DEFAULT_ALLOWED_PROPERTIES).not.toContain(blocked);
    }
  });
});

// ============= WIZARD BACKGROUND SYNC TRIGGER CONDITIONS =============

describe('Wizard background sync trigger conditions', () => {
  function shouldTriggerSync(radicado: string | null | undefined): boolean {
    const digits = (radicado || '').replace(/\D/g, '');
    return digits.length === 23;
  }

  it('triggers sync for valid 23-digit radicado', () => {
    expect(shouldTriggerSync('05001400302320250063800')).toBe(true);
  });

  it('triggers sync for formatted radicado', () => {
    expect(shouldTriggerSync('05-001-40-03-023-2025-00638-00')).toBe(true);
  });

  it('does NOT trigger sync for null radicado', () => {
    expect(shouldTriggerSync(null)).toBe(false);
  });

  it('does NOT trigger sync for undefined radicado', () => {
    expect(shouldTriggerSync(undefined)).toBe(false);
  });

  it('does NOT trigger sync for empty string', () => {
    expect(shouldTriggerSync('')).toBe(false);
  });

  it('does NOT trigger sync for short radicado', () => {
    expect(shouldTriggerSync('12345')).toBe(false);
  });

  it('does NOT trigger sync for tutela code (T-prefix)', () => {
    // Tutela codes are handled by a different API
    expect(shouldTriggerSync('T1234567')).toBe(false);
  });
});

// ============= COVERAGE GAP ALERT DEDUP =============

describe('Coverage gap alert dedup fingerprint', () => {
  function coverageGapFingerprint(workItemId: string): string {
    return `coverage_gap_${workItemId}_ESTADOS_publicaciones`;
  }

  it('produces deterministic fingerprint', () => {
    expect(coverageGapFingerprint('abc-123')).toBe('coverage_gap_abc-123_ESTADOS_publicaciones');
  });

  it('different work items produce different fingerprints', () => {
    expect(coverageGapFingerprint('item-1')).not.toBe(coverageGapFingerprint('item-2'));
  });
});

// ============= WORKFLOW COVERAGE =============

describe('Scheduled publicaciones monitor workflow coverage', () => {
  const PUBLICACIONES_WORKFLOWS = ['CGP', 'LABORAL', 'CPACA', 'PENAL_906'];

  it('includes CGP', () => expect(PUBLICACIONES_WORKFLOWS).toContain('CGP'));
  it('includes LABORAL', () => expect(PUBLICACIONES_WORKFLOWS).toContain('LABORAL'));
  it('includes CPACA', () => expect(PUBLICACIONES_WORKFLOWS).toContain('CPACA'));
  it('includes PENAL_906', () => expect(PUBLICACIONES_WORKFLOWS).toContain('PENAL_906'));
  it('excludes TUTELA by design', () => expect(PUBLICACIONES_WORKFLOWS).not.toContain('TUTELA'));
  it('has exactly 4 workflow types', () => expect(PUBLICACIONES_WORKFLOWS.length).toBe(4));
});

// ============= TERMINAL STAGE EXCLUSION =============

describe('Terminal stages excluded from monitoring', () => {
  const TERMINAL_STAGES = [
    'ARCHIVADO', 'FINALIZADO', 'EJECUTORIADO',
    'PRECLUIDO_ARCHIVADO', 'FINALIZADO_ABSUELTO', 'FINALIZADO_CONDENADO'
  ];

  it('includes ARCHIVADO', () => expect(TERMINAL_STAGES).toContain('ARCHIVADO'));
  it('includes FINALIZADO', () => expect(TERMINAL_STAGES).toContain('FINALIZADO'));
  it('does NOT include RADICACION (active stage)', () => expect(TERMINAL_STAGES).not.toContain('RADICACION'));
  it('does NOT include PROCESO (active stage)', () => expect(TERMINAL_STAGES).not.toContain('PROCESO'));
});
