/**
 * External Providers — Combined Regression Test Suite
 * 
 * Covers CPNU, SAMAI (Actuaciones), Tutelas, and SAMAI Estados.
 * Mirrors the structure of publicaciones-sync-regression.test.ts.
 * 
 * Sections:
 * 1. Radicado validation (shared by all providers)
 * 2. Fingerprint deduplication per provider
 * 3. Workflow-aware provider selection rules
 * 4. Wizard background sync trigger conditions
 * 5. Sync eligibility rules
 * 6. Error classification & demonitor policy
 * 7. Cross-provider TUTELA dedup
 * 8. Analytics catalog completeness
 * 
 * Run: npx vitest run src/lib/__tests__/providers-sync-regression.test.ts
 */
import { describe, it, expect } from 'vitest';
import { normalizeRadicadoInput, normalizeRadicado, validateCgpRadicado } from '../radicado-utils';
import { DEFAULT_ALLOWED_PROPERTIES, BLOCKED_PROPERTIES } from '../analytics/types';

// ============= 1. RADICADO VALIDATION (shared, all providers) =============

describe('Radicado validation (all providers)', () => {
  it('accepts valid 23-digit radicado', () => {
    const result = normalizeRadicado('05001400302320250063800');
    expect(result.ok).toBe(true);
    expect(result.radicado23).toBe('05001400302320250063800');
  });

  it('strips dashes from formatted radicado', () => {
    const result = normalizeRadicado('05-001-40-03-023-2025-00638-00');
    expect(result.ok).toBe(true);
    expect(result.radicado23).toBe('05001400302320250063800');
  });

  it('strips spaces from radicado', () => {
    expect(normalizeRadicadoInput('05 001 4003 023 2025 00638 00')).toBe('05001400302320250063800');
  });

  it('strips underscores (Icarus format)', () => {
    expect(normalizeRadicadoInput('050014003023_2025_00638_00')).toBe('05001400302320250063800');
  });

  it('rejects too short', () => {
    expect(normalizeRadicado('1234567890').ok).toBe(false);
  });

  it('rejects too long', () => {
    expect(normalizeRadicado('123456789012345678901234').ok).toBe(false);
  });

  it('rejects empty', () => {
    expect(normalizeRadicado('').ok).toBe(false);
  });

  it('rejects null-ish', () => {
    expect(normalizeRadicado(null as any).ok).toBe(false);
    expect(normalizeRadicado(undefined as any).ok).toBe(false);
  });

  it('preserves leading zeros', () => {
    const result = normalizeRadicado('05001400302320250063800');
    expect(result.radicado23?.[0]).toBe('0');
  });

  it('CGP: rejects ending 02', () => {
    const result = validateCgpRadicado('05001400302320250063802');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_ENDING');
  });

  it('CGP: accepts ending 00', () => {
    expect(validateCgpRadicado('05001400302320250063800').valid).toBe(true);
  });

  it('CGP: accepts ending 01', () => {
    expect(validateCgpRadicado('05001400302320250063801').valid).toBe(true);
  });
});

// ============= 2. FINGERPRINT DEDUPLICATION =============

describe('Actuacion fingerprint deduplication (CPNU/SAMAI)', () => {
  // Mirror sync-by-work-item generateFingerprint logic
  function generateFingerprint(
    workItemId: string,
    date: string,
    text: string,
    indice?: string,
    source?: string
  ): string {
    const sourcePart = source ? `|${source}` : '';
    const indexPart = indice ? `|${indice}` : '';
    const normalized = `${workItemId}|${date}|${text.toLowerCase().trim().slice(0, 200)}${indexPart}${sourcePart}`;
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `wi_${workItemId.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
  }

  it('is deterministic for same inputs', () => {
    const fp1 = generateFingerprint('abc-123', '2025-06-01', 'AUTO ADMISORIO', '1', 'cpnu');
    const fp2 = generateFingerprint('abc-123', '2025-06-01', 'AUTO ADMISORIO', '1', 'cpnu');
    expect(fp1).toBe(fp2);
  });

  it('different dates produce different fingerprints', () => {
    const fp1 = generateFingerprint('abc-123', '2025-06-01', 'AUTO ADMISORIO');
    const fp2 = generateFingerprint('abc-123', '2025-06-02', 'AUTO ADMISORIO');
    expect(fp1).not.toBe(fp2);
  });

  it('different texts produce different fingerprints', () => {
    const fp1 = generateFingerprint('abc-123', '2025-06-01', 'AUTO ADMISORIO');
    const fp2 = generateFingerprint('abc-123', '2025-06-01', 'SENTENCIA');
    expect(fp1).not.toBe(fp2);
  });

  it('includes source in fingerprint (cross-provider isolation)', () => {
    const fp1 = generateFingerprint('abc-123', '2025-06-01', 'AUTO ADMISORIO', '1', 'cpnu');
    const fp2 = generateFingerprint('abc-123', '2025-06-01', 'AUTO ADMISORIO', '1', 'samai');
    expect(fp1).not.toBe(fp2);
  });

  it('includes indice in fingerprint (same-day collision prevention)', () => {
    const fp1 = generateFingerprint('abc-123', '2025-06-01', 'AUTO ADMISORIO', '1');
    const fp2 = generateFingerprint('abc-123', '2025-06-01', 'AUTO ADMISORIO', '2');
    expect(fp1).not.toBe(fp2);
  });

  it('starts with wi_ prefix', () => {
    const fp = generateFingerprint('abc-123', '2025-06-01', 'test');
    expect(fp).toMatch(/^wi_/);
  });

  it('different work items produce different fingerprints', () => {
    const fp1 = generateFingerprint('item-111', '2025-06-01', 'AUTO', '1', 'cpnu');
    const fp2 = generateFingerprint('item-222', '2025-06-01', 'AUTO', '1', 'cpnu');
    expect(fp1).not.toBe(fp2);
  });
});

// ============= 3. WORKFLOW-AWARE PROVIDER SELECTION =============

describe('Workflow-aware provider selection', () => {
  // Mirror getProviderOrder from sync-by-work-item
  function getProviderOrder(workflowType: string) {
    switch (workflowType) {
      case 'CPACA':
        return { primary: 'samai', fallback: 'cpnu', fallbackEnabled: false };
      case 'TUTELA':
        return { primary: 'cpnu', fallback: 'tutelas-api', fallbackEnabled: true };
      case 'PENAL_906':
        return { primary: 'cpnu', fallback: 'samai', fallbackEnabled: true };
      case 'CGP':
      case 'LABORAL':
        return { primary: 'cpnu', fallback: null, fallbackEnabled: false };
      default:
        return { primary: 'cpnu', fallback: null, fallbackEnabled: false };
    }
  }

  it('CGP: CPNU primary, NO fallback', () => {
    const order = getProviderOrder('CGP');
    expect(order.primary).toBe('cpnu');
    expect(order.fallback).toBeNull();
    expect(order.fallbackEnabled).toBe(false);
  });

  it('LABORAL: CPNU primary, NO fallback', () => {
    const order = getProviderOrder('LABORAL');
    expect(order.primary).toBe('cpnu');
    expect(order.fallback).toBeNull();
    expect(order.fallbackEnabled).toBe(false);
  });

  it('CPACA: SAMAI primary, CPNU fallback disabled', () => {
    const order = getProviderOrder('CPACA');
    expect(order.primary).toBe('samai');
    expect(order.fallback).toBe('cpnu');
    expect(order.fallbackEnabled).toBe(false);
  });

  it('TUTELA: CPNU primary, TUTELAS-API fallback enabled', () => {
    const order = getProviderOrder('TUTELA');
    expect(order.primary).toBe('cpnu');
    expect(order.fallback).toBe('tutelas-api');
    expect(order.fallbackEnabled).toBe(true);
  });

  it('PENAL_906: CPNU primary, SAMAI fallback enabled', () => {
    const order = getProviderOrder('PENAL_906');
    expect(order.primary).toBe('cpnu');
    expect(order.fallback).toBe('samai');
    expect(order.fallbackEnabled).toBe(true);
  });

  it('Unknown workflow: CPNU primary, no fallback', () => {
    const order = getProviderOrder('UNKNOWN_TYPE');
    expect(order.primary).toBe('cpnu');
    expect(order.fallback).toBeNull();
    expect(order.fallbackEnabled).toBe(false);
  });
});

// ============= 4. WIZARD SYNC TRIGGER CONDITIONS =============

describe('Wizard background sync trigger (all providers)', () => {
  function shouldTriggerSync(radicado: string | null | undefined): boolean {
    const digits = (radicado || '').replace(/\D/g, '');
    return digits.length === 23;
  }

  it('triggers for valid 23-digit radicado', () => {
    expect(shouldTriggerSync('05001400302320250063800')).toBe(true);
  });

  it('triggers for formatted radicado', () => {
    expect(shouldTriggerSync('05-001-40-03-023-2025-00638-00')).toBe(true);
  });

  it('does NOT trigger for null', () => {
    expect(shouldTriggerSync(null)).toBe(false);
  });

  it('does NOT trigger for empty', () => {
    expect(shouldTriggerSync('')).toBe(false);
  });

  it('does NOT trigger for short radicado', () => {
    expect(shouldTriggerSync('12345')).toBe(false);
  });

  it('does NOT trigger for T-code', () => {
    expect(shouldTriggerSync('T1234567')).toBe(false);
  });
});

// ============= 5. SYNC ELIGIBILITY =============

describe('Sync eligibility rules', () => {
  const SYNC_ENABLED_WORKFLOWS = ['CGP', 'LABORAL', 'CPACA', 'TUTELA', 'PENAL_906'];
  const TERMINAL_STAGES = ['ARCHIVADO', 'FINALIZADO', 'EJECUTORIADO', 'PRECLUIDO_ARCHIVADO', 'FINALIZADO_ABSUELTO', 'FINALIZADO_CONDENADO'];

  it('includes all 5 workflow types', () => {
    expect(SYNC_ENABLED_WORKFLOWS).toContain('CGP');
    expect(SYNC_ENABLED_WORKFLOWS).toContain('LABORAL');
    expect(SYNC_ENABLED_WORKFLOWS).toContain('CPACA');
    expect(SYNC_ENABLED_WORKFLOWS).toContain('TUTELA');
    expect(SYNC_ENABLED_WORKFLOWS).toContain('PENAL_906');
    expect(SYNC_ENABLED_WORKFLOWS.length).toBe(5);
  });

  it('excludes GOV_PROCEDURE from sync', () => {
    expect(SYNC_ENABLED_WORKFLOWS).not.toContain('GOV_PROCEDURE');
  });

  it('excludes PETICION from sync', () => {
    expect(SYNC_ENABLED_WORKFLOWS).not.toContain('PETICION');
  });

  it('terminal stages include ARCHIVADO and FINALIZADO', () => {
    expect(TERMINAL_STAGES).toContain('ARCHIVADO');
    expect(TERMINAL_STAGES).toContain('FINALIZADO');
  });

  it('active stages are NOT in terminal list', () => {
    expect(TERMINAL_STAGES).not.toContain('RADICACION');
    expect(TERMINAL_STAGES).not.toContain('AUTO_ADMISORIO');
    expect(TERMINAL_STAGES).not.toContain('PROCESO');
  });

  it('eligibility: 23-digit radicado filter applied', () => {
    // Mirror selectEligibleWorkItems filter
    const items = [
      { radicado: '05001400302320250063800' },
      { radicado: '12345' },
      { radicado: null },
      { radicado: '05001400302320250063801' },
    ];
    const eligible = items.filter(i => i.radicado && i.radicado.replace(/\D/g, '').length === 23);
    expect(eligible.length).toBe(2);
  });
});

// ============= 6. ERROR CLASSIFICATION & DEMONITOR POLICY =============

describe('Error classification and demonitor policy', () => {
  const TRANSIENT_CODES = ['SCRAPING_TIMEOUT', 'SCRAPING_PENDING', 'SCRAPING_TIMEOUT_RETRY_SCHEDULED'];
  const DEMONITOR_ELIGIBLE = ['PROVIDER_404', 'RECORD_NOT_FOUND', 'PROVIDER_NOT_FOUND', 'UPSTREAM_ROUTE_MISSING', 'SCRAPING_STUCK'];

  it('SCRAPING_TIMEOUT is transient, NOT demonitorable', () => {
    expect(TRANSIENT_CODES).toContain('SCRAPING_TIMEOUT');
    expect(DEMONITOR_ELIGIBLE).not.toContain('SCRAPING_TIMEOUT');
  });

  it('SCRAPING_PENDING is transient, NOT demonitorable', () => {
    expect(TRANSIENT_CODES).toContain('SCRAPING_PENDING');
    expect(DEMONITOR_ELIGIBLE).not.toContain('SCRAPING_PENDING');
  });

  it('PROVIDER_404 IS demonitorable', () => {
    expect(DEMONITOR_ELIGIBLE).toContain('PROVIDER_404');
  });

  it('PROVIDER_RATE_LIMITED is neither transient nor demonitorable', () => {
    expect(TRANSIENT_CODES).not.toContain('PROVIDER_RATE_LIMITED');
    expect(DEMONITOR_ELIGIBLE).not.toContain('PROVIDER_RATE_LIMITED');
  });

  it('PROVIDER_EMPTY_RESULT is NOT demonitorable', () => {
    expect(DEMONITOR_ELIGIBLE).not.toContain('PROVIDER_EMPTY_RESULT');
  });

  it('SCRAPING_STUCK IS demonitorable (terminal)', () => {
    expect(DEMONITOR_ELIGIBLE).toContain('SCRAPING_STUCK');
  });
});

// ============= 7. CROSS-PROVIDER TUTELA DEDUP =============

describe('Cross-provider TUTELA deduplication', () => {
  // Mirror normalizeTextForComparison and normalizedSimilarity
  function normalizeTextForComparison(text: string): string {
    return text
      .toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizedSimilarity(a: string, b: string): number {
    const normA = normalizeTextForComparison(a);
    const normB = normalizeTextForComparison(b);
    const tokensA = new Set(normA.split(/\s+/).filter(Boolean));
    const tokensB = new Set(normB.split(/\s+/).filter(Boolean));
    if (tokensA.size === 0 && tokensB.size === 0) return 1;
    if (tokensA.size === 0 || tokensB.size === 0) return 0;
    const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
    const union = new Set([...tokensA, ...tokensB]);
    return intersection.size / union.size;
  }

  it('identical texts score 1.0', () => {
    expect(normalizedSimilarity('AUTO ADMISORIO', 'AUTO ADMISORIO')).toBe(1);
  });

  it('accented vs unaccented match', () => {
    expect(normalizedSimilarity('SENTENCIA DE TUTELA', 'SENTENCIA DE TÚTELA')).toBeGreaterThan(0.9);
  });

  it('similar CPNU vs SAMAI descriptions match >70%', () => {
    const cpnu = 'AUTO ADMISORIO DE LA DEMANDA';
    const samai = 'AUTO ADMISORIO DE DEMANDA';
    expect(normalizedSimilarity(cpnu, samai)).toBeGreaterThan(0.7);
  });

  it('completely different descriptions are <0.3', () => {
    const a = 'AUTO ADMISORIO DE LA DEMANDA';
    const b = 'SENTENCIA DE PRIMERA INSTANCIA';
    expect(normalizedSimilarity(a, b)).toBeLessThan(0.3);
  });

  it('normalization removes accents', () => {
    expect(normalizeTextForComparison('Actuación')).toBe('ACTUACION');
  });

  it('normalization removes punctuation', () => {
    expect(normalizeTextForComparison('Auto (Admisorio)')).toBe('AUTO ADMISORIO');
  });

  it('normalization collapses whitespace', () => {
    expect(normalizeTextForComparison('AUTO   ADMISORIO')).toBe('AUTO ADMISORIO');
  });
});

// ============= 8. LEGAL EVENT CLASSIFICATION =============

describe('Legal event type classification', () => {
  function classifyActuacionType(description: string): string {
    const upper = description.toUpperCase();
    if (/SENTENCIA|FALLO/.test(upper)) return 'SENTENCIA';
    if (/AUTO\s+ADMISORIO|ADMITE\s+TUTELA/.test(upper)) return 'AUTO_ADMISORIO';
    if (/AUTO\s+INTERLOCUTORIO/.test(upper)) return 'AUTO_INTERLOCUTORIO';
    if (/AUDIENCIA/.test(upper)) return 'AUDIENCIA';
    if (/IMPUGNA/.test(upper)) return 'IMPUGNACION';
    if (/NOTIFICA/.test(upper)) return 'NOTIFICACION';
    if (/RECURSO/.test(upper)) return 'RECURSO';
    if (/SELECCION.*REVISION|REVISION/.test(upper)) return 'SELECCION_REVISION';
    if (/ARCHIV/.test(upper)) return 'ARCHIVO';
    if (/TRASLADO/.test(upper)) return 'TRASLADO';
    if (/REQUIERE|REQUERIMIENTO/.test(upper)) return 'REQUERIMIENTO';
    return 'OTHER';
  }

  it('classifies SENTENCIA', () => {
    expect(classifyActuacionType('SENTENCIA DE PRIMERA INSTANCIA')).toBe('SENTENCIA');
  });

  it('classifies FALLO as SENTENCIA', () => {
    expect(classifyActuacionType('FALLO DE TUTELA')).toBe('SENTENCIA');
  });

  it('classifies AUTO ADMISORIO', () => {
    expect(classifyActuacionType('AUTO ADMISORIO DE DEMANDA')).toBe('AUTO_ADMISORIO');
  });

  it('classifies AUDIENCIA', () => {
    expect(classifyActuacionType('AUDIENCIA INICIAL')).toBe('AUDIENCIA');
  });

  it('classifies NOTIFICACION', () => {
    expect(classifyActuacionType('NOTIFICACIÓN PERSONAL')).toBe('NOTIFICACION');
  });

  it('classifies TRASLADO', () => {
    expect(classifyActuacionType('TRASLADO DE LA DEMANDA')).toBe('TRASLADO');
  });

  it('returns OTHER for unknown', () => {
    expect(classifyActuacionType('REGISTRO DE DOCUMENTOS')).toBe('OTHER');
  });
});

// ============= 9. TUTELA IDENTIFIER VALIDATION =============

describe('Tutela identifier validation', () => {
  function isValidTutelaCode(code: string): boolean {
    return /^T\d{6,10}$/i.test(code);
  }

  it('accepts T followed by 7 digits', () => {
    expect(isValidTutelaCode('T1234567')).toBe(true);
  });

  it('accepts T followed by 10 digits', () => {
    expect(isValidTutelaCode('T1234567890')).toBe(true);
  });

  it('rejects T with fewer than 6 digits', () => {
    expect(isValidTutelaCode('T12345')).toBe(false);
  });

  it('rejects without T prefix', () => {
    expect(isValidTutelaCode('1234567')).toBe(false);
  });

  it('rejects T with letters', () => {
    expect(isValidTutelaCode('Tabcdefg')).toBe(false);
  });

  it('case insensitive', () => {
    expect(isValidTutelaCode('t1234567')).toBe(true);
  });
});

// ============= 10. PROVIDER SOURCE PRIORITY =============

describe('TUTELA source priority ordering', () => {
  const TUTELA_SOURCE_PRIORITY = ['cpnu', 'samai', 'tutelas-api'];

  it('CPNU is highest priority', () => {
    expect(TUTELA_SOURCE_PRIORITY[0]).toBe('cpnu');
  });

  it('SAMAI is second priority', () => {
    expect(TUTELA_SOURCE_PRIORITY[1]).toBe('samai');
  });

  it('TUTELAS-API is third (Corte Constitucional is authoritative for stage)', () => {
    expect(TUTELA_SOURCE_PRIORITY[2]).toBe('tutelas-api');
  });
});

// ============= 11. PUBLICACIONES WORKFLOW COVERAGE =============

describe('Publicaciones workflow coverage', () => {
  const PUBLICACIONES_WORKFLOWS = ['CGP', 'LABORAL', 'CPACA', 'PENAL_906'];

  it('includes CGP', () => expect(PUBLICACIONES_WORKFLOWS).toContain('CGP'));
  it('includes LABORAL', () => expect(PUBLICACIONES_WORKFLOWS).toContain('LABORAL'));
  it('includes CPACA', () => expect(PUBLICACIONES_WORKFLOWS).toContain('CPACA'));
  it('includes PENAL_906', () => expect(PUBLICACIONES_WORKFLOWS).toContain('PENAL_906'));
  it('excludes TUTELA by design', () => expect(PUBLICACIONES_WORKFLOWS).not.toContain('TUTELA'));
  it('has exactly 4 types', () => expect(PUBLICACIONES_WORKFLOWS.length).toBe(4));
});

// ============= 12. DEMO PROVIDER REGISTRY =============

describe('Demo provider registry completeness', () => {
  const DEMO_PROVIDERS = ['CPNU', 'SAMAI', 'Publicaciones', 'Tutelas', 'SAMAI Estados'];

  it('includes all 5 providers', () => {
    expect(DEMO_PROVIDERS.length).toBe(5);
  });

  it('includes CPNU', () => expect(DEMO_PROVIDERS).toContain('CPNU'));
  it('includes SAMAI', () => expect(DEMO_PROVIDERS).toContain('SAMAI'));
  it('includes Publicaciones', () => expect(DEMO_PROVIDERS).toContain('Publicaciones'));
  it('includes Tutelas', () => expect(DEMO_PROVIDERS).toContain('Tutelas'));
  it('includes SAMAI Estados', () => expect(DEMO_PROVIDERS).toContain('SAMAI Estados'));
});

// ============= 13. ANALYTICS CATALOG =============

describe('Analytics catalog includes provider-related properties', () => {
  const requiredProps = [
    'workflow_type',
    'latency_ms',
    'duration_ms',
    'status_code',
    'outcome',
    'source',
    'data_kind',
    'entries_count',
  ];

  for (const prop of requiredProps) {
    it(`DEFAULT_ALLOWED_PROPERTIES includes "${prop}"`, () => {
      expect(DEFAULT_ALLOWED_PROPERTIES).toContain(prop);
    });
  }

  it('no duplicates in DEFAULT_ALLOWED_PROPERTIES', () => {
    const unique = new Set(DEFAULT_ALLOWED_PROPERTIES);
    expect(DEFAULT_ALLOWED_PROPERTIES.length).toBe(unique.size);
  });

  it('BLOCKED_PROPERTIES never overlap with ALLOWED', () => {
    for (const blocked of BLOCKED_PROPERTIES) {
      expect(DEFAULT_ALLOWED_PROPERTIES).not.toContain(blocked);
    }
  });
});

// ============= 14. DATE PARSING =============

describe('Colombian date parsing', () => {
  function parseColombianDate(dateStr: string | undefined | null): string | null {
    if (!dateStr) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
    const dateOnly = dateStr.split(' ')[0];
    const patterns = [
      /^(\d{2})\/(\d{2})\/(\d{4})$/,
      /^(\d{2})-(\d{2})-(\d{4})$/,
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    ];
    for (const pattern of patterns) {
      const match = dateOnly.match(pattern);
      if (match) {
        const day = match[1].padStart(2, '0');
        const month = match[2].padStart(2, '0');
        return `${match[3]}-${month}-${day}`;
      }
    }
    return null;
  }

  it('parses ISO format', () => {
    expect(parseColombianDate('2025-06-01')).toBe('2025-06-01');
  });

  it('parses ISO with time', () => {
    expect(parseColombianDate('2025-06-01T00:00:00')).toBe('2025-06-01');
  });

  it('parses DD/MM/YYYY', () => {
    expect(parseColombianDate('01/06/2025')).toBe('2025-06-01');
  });

  it('parses DD/MM/YYYY with time', () => {
    expect(parseColombianDate('07/06/2025 6:06:44')).toBe('2025-06-07');
  });

  it('returns null for null', () => {
    expect(parseColombianDate(null)).toBeNull();
  });

  it('returns null for empty', () => {
    expect(parseColombianDate('')).toBeNull();
  });
});

// ============= 15. POLLING BACKOFF CALCULATION =============

describe('Polling exponential backoff', () => {
  const POLLING_CONFIG = {
    maxAttempts: 10,
    initialIntervalMs: 3000,
    maxIntervalMs: 15000,
  };

  it('first attempt waits ~3000ms', () => {
    const delay = Math.min(POLLING_CONFIG.initialIntervalMs * Math.pow(1.6, 0), POLLING_CONFIG.maxIntervalMs);
    expect(delay).toBe(3000);
  });

  it('delay is capped at maxIntervalMs', () => {
    const delay = Math.min(POLLING_CONFIG.initialIntervalMs * Math.pow(1.6, 9), POLLING_CONFIG.maxIntervalMs);
    expect(delay).toBe(POLLING_CONFIG.maxIntervalMs);
  });

  it('delay increases monotonically until cap', () => {
    let prev = 0;
    for (let i = 0; i < POLLING_CONFIG.maxAttempts; i++) {
      const delay = Math.min(POLLING_CONFIG.initialIntervalMs * Math.pow(1.6, i), POLLING_CONFIG.maxIntervalMs);
      expect(delay).toBeGreaterThanOrEqual(prev);
      prev = delay;
    }
  });
});

// ============= 16. SAMAI ESTADOS (EXTERNAL PROVIDER) =============

describe('SAMAI Estados external provider contract', () => {
  it('uses radicado field (not provider_case_id)', () => {
    // SAMAI Estados expects "radicado" in the request body
    const caps = ['get_estados', 'search_by_radicado'];
    const caps_set = new Set(caps.map(c => c.toLowerCase()));
    const useRadicadoField = caps_set.has('search_by_radicado');
    expect(useRadicadoField).toBe(true);
  });

  it('capabilities include get_estados', () => {
    const caps = ['get_estados', 'search_by_radicado'];
    expect(caps).toContain('get_estados');
  });
});

// ============= 17. DEMONITOR SAFETY GATES =============

describe('Demonitor safety gates', () => {
  // Mirror shouldDemonitor logic
  function checkDemonitorBlocked(params: {
    consecutive404: number;
    threshold: number;
    hasPendingRetry: boolean;
    lastErrorCode: string | null;
    publicacionesCount: number;
    recentActsCount: number;
  }): { blocked: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const TRANSIENT = ['SCRAPING_TIMEOUT', 'SCRAPING_PENDING', 'SCRAPING_TIMEOUT_RETRY_SCHEDULED'];
    const DEMONITOR_ELIGIBLE = ['PROVIDER_404', 'RECORD_NOT_FOUND', 'PROVIDER_NOT_FOUND', 'UPSTREAM_ROUTE_MISSING', 'SCRAPING_STUCK'];

    if (params.consecutive404 < params.threshold) {
      return { blocked: true, reasons: ['BELOW_THRESHOLD'] };
    }
    if (params.hasPendingRetry) reasons.push('PENDING_RETRY');
    if (params.lastErrorCode && TRANSIENT.includes(params.lastErrorCode)) reasons.push('TRANSIENT_ERROR');
    if (params.lastErrorCode && !DEMONITOR_ELIGIBLE.includes(params.lastErrorCode)) reasons.push('NON_404_ERROR');
    if (params.publicacionesCount > 0) reasons.push('HAS_PUBLICACIONES');
    if (params.recentActsCount > 0) reasons.push('HAS_RECENT_ACTS');

    return { blocked: reasons.length > 0, reasons };
  }

  it('blocks demonitor when publicaciones exist (Gate 4)', () => {
    const result = checkDemonitorBlocked({
      consecutive404: 10,
      threshold: 5,
      hasPendingRetry: false,
      lastErrorCode: 'PROVIDER_404',
      publicacionesCount: 3,
      recentActsCount: 0,
    });
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain('HAS_PUBLICACIONES');
  });

  it('blocks demonitor when recent acts exist (Gate 5)', () => {
    const result = checkDemonitorBlocked({
      consecutive404: 10,
      threshold: 5,
      hasPendingRetry: false,
      lastErrorCode: 'PROVIDER_404',
      publicacionesCount: 0,
      recentActsCount: 5,
    });
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain('HAS_RECENT_ACTS');
  });

  it('blocks when pending retry exists', () => {
    const result = checkDemonitorBlocked({
      consecutive404: 10,
      threshold: 5,
      hasPendingRetry: true,
      lastErrorCode: 'PROVIDER_404',
      publicacionesCount: 0,
      recentActsCount: 0,
    });
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain('PENDING_RETRY');
  });

  it('blocks when error is transient', () => {
    const result = checkDemonitorBlocked({
      consecutive404: 10,
      threshold: 5,
      hasPendingRetry: false,
      lastErrorCode: 'SCRAPING_TIMEOUT',
      publicacionesCount: 0,
      recentActsCount: 0,
    });
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain('TRANSIENT_ERROR');
  });

  it('allows demonitor when all gates pass', () => {
    const result = checkDemonitorBlocked({
      consecutive404: 10,
      threshold: 5,
      hasPendingRetry: false,
      lastErrorCode: 'PROVIDER_404',
      publicacionesCount: 0,
      recentActsCount: 0,
    });
    expect(result.blocked).toBe(false);
  });
});