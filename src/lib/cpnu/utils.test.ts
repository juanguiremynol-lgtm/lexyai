import { describe, it, expect } from 'vitest';
import {
  buildSearchCandidates,
  buildDetailCandidates,
  buildActuacionesCandidates,
  computeFingerprint,
  classifyRun,
  parseCpnuSearchResponse,
  parseCpnuActuacionesResponse,
  parseFirecrawlSearchResult,
  validateSearchResponseSchema,
  validateActuacionesResponseSchema,
  validateAttemptLog,
  parseColombianDate,
  determineEventType,
  truncate,
  redactSensitiveData,
} from './utils';
import type { AttemptLog, ParseMeta } from './types';

// Import fixtures
import searchSuccessFixture from '../../__fixtures__/cpnu/search_success_v2.json';
import actuacionesSuccessFixture from '../../__fixtures__/cpnu/actuaciones_success_v2.json';
import searchNoResultsFixture from '../../__fixtures__/cpnu/search_no_results_v2.json';
import firecrawlSuccessFixture from '../../__fixtures__/firecrawl/actions_success.json';
import firecrawlFormOnlyFixture from '../../__fixtures__/firecrawl/actions_form_only.json';

// ============= URL CANDIDATE TESTS =============

describe('buildSearchCandidates', () => {
  const testRadicado = '05001400300220250105400';

  it('should return at least 5 candidates', () => {
    const candidates = buildSearchCandidates(testRadicado);
    expect(candidates.length).toBeGreaterThanOrEqual(5);
  });

  it('should keep radicado as string in all URLs', () => {
    const candidates = buildSearchCandidates(testRadicado);
    
    for (const candidate of candidates) {
      expect(candidate.url).toContain(testRadicado);
      // Ensure radicado is not cast to scientific notation or truncated
      expect(candidate.url).not.toMatch(/5e\+?\d+/);
      expect(candidate.url).not.toContain('5001400300220250100000');
    }
  });

  it('should have preferred endpoints first', () => {
    const candidates = buildSearchCandidates(testRadicado);
    
    // First candidate should be the standard v2 without explicit port
    expect(candidates[0].url).toContain('/api/v2/Procesos/Consulta/NumeroRadicacion');
    expect(candidates[0].url).not.toMatch(/:4\d{2}\//);
  });

  it('should include v1 fallback last', () => {
    const candidates = buildSearchCandidates(testRadicado);
    const lastCandidate = candidates[candidates.length - 1];
    
    expect(lastCandidate.url).toContain('/api/v1/');
  });

  it('should embed radicado correctly in POST body', () => {
    const candidates = buildSearchCandidates(testRadicado);
    const postCandidate = candidates.find(c => c.method === 'POST');
    
    expect(postCandidate).toBeDefined();
    expect(postCandidate!.body).toBeDefined();
    
    const body = JSON.parse(postCandidate!.body!);
    expect(body.numero).toBe(testRadicado);
  });

  it('should include SoloActivos parameter', () => {
    const candidates = buildSearchCandidates(testRadicado, false);
    const getCandidate = candidates.find(c => c.method === 'GET');
    
    expect(getCandidate!.url).toContain('SoloActivos=false');
  });
});

describe('buildDetailCandidates', () => {
  it('should return at least 2 candidates', () => {
    const candidates = buildDetailCandidates(12345);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('should embed idProceso correctly', () => {
    const candidates = buildDetailCandidates('12345');
    
    for (const candidate of candidates) {
      expect(candidate.url).toContain('/Detalle/12345');
    }
  });
});

describe('buildActuacionesCandidates', () => {
  it('should return at least 2 candidates', () => {
    const candidates = buildActuacionesCandidates(12345);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('should embed idProceso correctly', () => {
    const candidates = buildActuacionesCandidates(12345);
    
    for (const candidate of candidates) {
      expect(candidate.url).toContain('/Actuaciones/12345');
    }
  });
});

// ============= FINGERPRINT TESTS =============

describe('computeFingerprint', () => {
  it('should return consistent hash for same input', () => {
    const fp1 = computeFingerprint('CPNU', '05001400300220250105400', '2025-06-01', 'AUTO', 'Test description', 'Juzgado 001');
    const fp2 = computeFingerprint('CPNU', '05001400300220250105400', '2025-06-01', 'AUTO', 'Test description', 'Juzgado 001');
    
    expect(fp1).toBe(fp2);
  });

  it('should return 16-char hex string', () => {
    const fp = computeFingerprint('CPNU', '05001400300220250105400', '2025-06-01', 'AUTO', 'Test', 'Despacho');
    
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should change when description changes', () => {
    const fp1 = computeFingerprint('CPNU', '05001400300220250105400', '2025-06-01', 'AUTO', 'Description A', 'Juzgado');
    const fp2 = computeFingerprint('CPNU', '05001400300220250105400', '2025-06-01', 'AUTO', 'Description B', 'Juzgado');
    
    expect(fp1).not.toBe(fp2);
  });

  it('should change when date changes', () => {
    const fp1 = computeFingerprint('CPNU', '05001400300220250105400', '2025-06-01', 'AUTO', 'Same', 'Juzgado');
    const fp2 = computeFingerprint('CPNU', '05001400300220250105400', '2025-06-02', 'AUTO', 'Same', 'Juzgado');
    
    expect(fp1).not.toBe(fp2);
  });

  it('should handle null date', () => {
    const fp = computeFingerprint('CPNU', '05001400300220250105400', null, 'AUTO', 'Test', 'Despacho');
    
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ============= CLASSIFICATION TESTS =============

describe('classifyRun', () => {
  const makeAttempt = (overrides: Partial<AttemptLog> = {}): AttemptLog => ({
    phase: 'QUERY_LIST',
    url: 'https://test.com',
    method: 'GET',
    status: 200,
    latency_ms: 100,
    success: true,
    ...overrides,
  });

  it('should return SUCCESS when results exist', () => {
    const result = classifyRun([makeAttempt()], null, 1, 0);
    expect(result.classification).toBe('SUCCESS');
  });

  it('should return SUCCESS when events exist', () => {
    const result = classifyRun([makeAttempt()], null, 0, 3);
    expect(result.classification).toBe('SUCCESS');
  });

  it('should return ENDPOINT_404 when all attempts are 404', () => {
    const attempts = [
      makeAttempt({ status: 404, success: false }),
      makeAttempt({ status: 404, success: false }),
      makeAttempt({ status: 404, success: false }),
    ];
    const result = classifyRun(attempts, null, 0, 0);
    
    expect(result.classification).toBe('ENDPOINT_404');
    expect(result.why_empty).toBe('ALL_ENDPOINTS_404');
  });

  it('should return BLOCKED_403_429 for 403 status', () => {
    const attempts = [
      makeAttempt({ status: 404, success: false }),
      makeAttempt({ status: 403, success: false }),
    ];
    const result = classifyRun(attempts, null, 0, 0);
    
    expect(result.classification).toBe('BLOCKED_403_429');
    expect(result.why_empty).toContain('403');
  });

  it('should return BLOCKED_403_429 for 429 status', () => {
    const attempts = [
      makeAttempt({ status: 429, success: false }),
    ];
    const result = classifyRun(attempts, null, 0, 0);
    
    expect(result.classification).toBe('BLOCKED_403_429');
    expect(result.why_empty).toContain('429');
  });

  it('should return NON_JSON_RESPONSE when all non-JSON', () => {
    const attempts = [
      makeAttempt({ error_type: 'NON_JSON', success: false }),
      makeAttempt({ error_type: 'NON_JSON', success: false }),
    ];
    const result = classifyRun(attempts, null, 0, 0);
    
    expect(result.classification).toBe('NON_JSON_RESPONSE');
  });

  it('should return PARSE_BROKE when success but no results', () => {
    const attempts = [makeAttempt({ success: true })];
    const parseMeta: ParseMeta = { parseMethod: 'CONTENT_MATCH', itemCount: 0 };
    const result = classifyRun(attempts, parseMeta, 0, 0);
    
    expect(result.classification).toBe('PARSE_BROKE');
  });

  it('should return NO_RESULTS_CONFIRMED for no results message', () => {
    const attempts = [makeAttempt()];
    const parseMeta: ParseMeta = { parseMethod: 'NO_RESULTS_MESSAGE' };
    const result = classifyRun(attempts, parseMeta, 0, 0);
    
    expect(result.classification).toBe('NO_RESULTS_CONFIRMED');
  });

  it('should return INTERACTION_FAILED for SPA form empty', () => {
    const attempts = [makeAttempt()];
    const parseMeta: ParseMeta = { parseMethod: 'SPA_FORM_EMPTY' };
    const result = classifyRun(attempts, parseMeta, 0, 0);
    
    expect(result.classification).toBe('INTERACTION_FAILED_SELECTOR_CHANGED');
  });

  it('should use firecrawl classification when provided', () => {
    const result = classifyRun([], null, 0, 0, 'INTERACTION_REQUIRED');
    
    expect(result.classification).toBe('INTERACTION_REQUIRED');
  });
});

// ============= PARSING TESTS =============

describe('parseCpnuSearchResponse', () => {
  it('should parse success fixture correctly', () => {
    const { results, parseMeta } = parseCpnuSearchResponse(searchSuccessFixture);
    
    expect(results.length).toBe(1);
    expect(results[0].radicado).toBe('05001400300220250105400');
    expect(results[0].id_proceso).toBe(12345);
    expect(results[0].despacho).toContain('Juzgado');
    expect(parseMeta.parseMethod).toBe('CPNU_API_PROCESOS');
  });

  it('should parse no results fixture correctly', () => {
    const { results, parseMeta } = parseCpnuSearchResponse(searchNoResultsFixture);
    
    expect(results.length).toBe(0);
    expect(parseMeta.parseMethod).toBe('CPNU_API_EMPTY');
  });

  it('should handle invalid JSON', () => {
    const { results, parseMeta } = parseCpnuSearchResponse(null);
    
    expect(results.length).toBe(0);
    expect(parseMeta.parseMethod).toBe('INVALID_JSON');
  });

  it('should extract all required fields', () => {
    const { results } = parseCpnuSearchResponse(searchSuccessFixture);
    const result = results[0];
    
    expect(result.radicado).toBeDefined();
    expect(result.despacho).toBeDefined();
    expect(result.id_proceso).toBeDefined();
    expect(result.detail_url).toBeDefined();
    expect(result.detail_url).toContain('idProceso=12345');
  });
});

describe('parseCpnuActuacionesResponse', () => {
  const testRadicado = '05001400300220250105400';
  const sourceUrl = 'https://test.com';

  it('should parse success fixture correctly', () => {
    const { events, parseMeta } = parseCpnuActuacionesResponse(actuacionesSuccessFixture, testRadicado, sourceUrl);
    
    expect(events.length).toBe(3);
    expect(parseMeta.parseMethod).toBe('CPNU_ACTUACIONES_PARSED');
  });

  it('should set correct event types', () => {
    const { events } = parseCpnuActuacionesResponse(actuacionesSuccessFixture, testRadicado, sourceUrl);
    
    const autoEvent = events.find(e => e.description.includes('AUTO ADMISORIO'));
    expect(autoEvent?.event_type).toBe('AUTO');
    
    const notificacionEvent = events.find(e => e.description.includes('NOTIFICACIÓN'));
    expect(notificacionEvent?.event_type).toBe('NOTIFICACION');
  });

  it('should generate fingerprints for each event', () => {
    const { events } = parseCpnuActuacionesResponse(actuacionesSuccessFixture, testRadicado, sourceUrl);
    
    for (const event of events) {
      expect(event.hash_fingerprint).toMatch(/^[0-9a-f]{16}$/);
    }
    
    // All fingerprints should be unique
    const fingerprints = events.map(e => e.hash_fingerprint);
    const uniqueFingerprints = new Set(fingerprints);
    expect(uniqueFingerprints.size).toBe(fingerprints.length);
  });

  it('should extract attachments', () => {
    const { events } = parseCpnuActuacionesResponse(actuacionesSuccessFixture, testRadicado, sourceUrl);
    
    const eventWithDocs = events.find(e => e.attachments.length > 0);
    expect(eventWithDocs).toBeDefined();
    expect(eventWithDocs!.attachments[0].label).toBe('Auto Admisorio');
    expect(eventWithDocs!.attachments[0].url).toContain('.pdf');
  });
});

describe('parseFirecrawlSearchResult', () => {
  const testRadicado = '05001400300220250105400';

  it('should parse success fixture correctly', () => {
    const markdown = firecrawlSuccessFixture.data.markdown;
    const html = firecrawlSuccessFixture.data.html;
    
    const { results, parseMeta } = parseFirecrawlSearchResult(markdown, html, testRadicado);
    
    expect(results.length).toBe(1);
    expect(results[0].radicado).toBe(testRadicado);
    expect(results[0].id_proceso).toBe('12345');
    expect(parseMeta.parseMethod).toBe('FIRECRAWL_CONTENT_MATCH');
  });

  it('should detect form-only state', () => {
    const markdown = firecrawlFormOnlyFixture.data.markdown;
    const html = firecrawlFormOnlyFixture.data.html;
    
    const { results, parseMeta } = parseFirecrawlSearchResult(markdown, html, testRadicado);
    
    expect(results.length).toBe(0);
    expect(parseMeta.parseMethod).toBe('SPA_FORM_EMPTY');
  });

  it('should extract despacho from content', () => {
    const markdown = firecrawlSuccessFixture.data.markdown;
    const html = firecrawlSuccessFixture.data.html;
    
    const { results } = parseFirecrawlSearchResult(markdown, html, testRadicado);
    
    expect(results[0].despacho).toContain('Juzgado');
  });
});

// ============= SCHEMA VALIDATION TESTS =============

describe('validateSearchResponseSchema', () => {
  it('should validate success fixture', () => {
    const result = validateSearchResponseSchema(searchSuccessFixture);
    
    expect(result.valid).toBe(true);
    expect(result.missingFields).toHaveLength(0);
  });

  it('should fail on missing procesos', () => {
    const result = validateSearchResponseSchema({ foo: 'bar' });
    
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('procesos OR idProceso');
  });

  it('should provide clear error message', () => {
    const result = validateSearchResponseSchema({});
    
    expect(result.message).toContain('CPNU schema changed');
  });
});

describe('validateActuacionesResponseSchema', () => {
  it('should validate success fixture', () => {
    const result = validateActuacionesResponseSchema(actuacionesSuccessFixture);
    
    expect(result.valid).toBe(true);
  });

  it('should fail on missing actuaciones', () => {
    const result = validateActuacionesResponseSchema({ foo: 'bar' });
    
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('actuaciones');
  });
});

describe('validateAttemptLog', () => {
  it('should validate valid attempt', () => {
    const attempt: AttemptLog = {
      phase: 'QUERY_LIST',
      url: 'https://test.com',
      method: 'GET',
      status: 200,
      latency_ms: 100,
      success: true,
    };
    
    const result = validateAttemptLog(attempt);
    expect(result.valid).toBe(true);
  });

  it('should detect missing fields', () => {
    const result = validateAttemptLog({ phase: 'QUERY_LIST' });
    
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('url');
    expect(result.missingFields).toContain('method');
  });

  it('should validate response snippet length', () => {
    const attempt = {
      phase: 'QUERY_LIST',
      url: 'https://test.com',
      method: 'GET',
      status: 200,
      latency_ms: 100,
      success: true,
      response_snippet_1kb: 'x'.repeat(2000), // Too long
    };
    
    const result = validateAttemptLog(attempt);
    expect(result.valid).toBe(false);
    expect(result.missingFields.some(f => f.includes('1024'))).toBe(true);
  });
});

// ============= UTILITY FUNCTION TESTS =============

describe('parseColombianDate', () => {
  it('should parse ISO format', () => {
    const result = parseColombianDate('2025-06-01');
    expect(result).toContain('2025-06-01');
  });

  it('should parse DD/MM/YYYY format', () => {
    const result = parseColombianDate('15/06/2025');
    expect(result).toContain('2025');
  });

  it('should handle DD-MM-YYYY format', () => {
    const result = parseColombianDate('15-06-2025');
    expect(result).toContain('2025');
  });

  it('should return null for empty string', () => {
    expect(parseColombianDate('')).toBeNull();
  });

  it('should handle 2-digit years', () => {
    const result = parseColombianDate('15/06/25');
    expect(result).toContain('2025');
  });
});

describe('determineEventType', () => {
  it('should detect AUDIENCIA', () => {
    expect(determineEventType('Audiencia de conciliación')).toBe('AUDIENCIA');
  });

  it('should detect SENTENCIA', () => {
    expect(determineEventType('Sentencia de primera instancia')).toBe('SENTENCIA');
  });

  it('should detect AUTO', () => {
    expect(determineEventType('Auto admisorio de demanda')).toBe('AUTO');
  });

  it('should detect NOTIFICACION', () => {
    expect(determineEventType('Notificación personal')).toBe('NOTIFICACION');
  });

  it('should default to ACTUACION', () => {
    expect(determineEventType('Something else')).toBe('ACTUACION');
  });
});

describe('truncate', () => {
  it('should truncate long strings', () => {
    const result = truncate('This is a very long string', 10);
    expect(result).toBe('This is a ...');
    expect(result.length).toBe(13);
  });

  it('should not truncate short strings', () => {
    const result = truncate('Short', 10);
    expect(result).toBe('Short');
  });

  it('should handle empty string', () => {
    expect(truncate('', 10)).toBe('');
  });
});

describe('redactSensitiveData', () => {
  it('should redact email addresses', () => {
    const result = redactSensitiveData('Contact: test@example.com') as string;
    expect(result).not.toContain('test@example.com');
    expect(result).toContain('email@test.com');
  });

  it('should redact names in objects', () => {
    const data = {
      demandante: 'Juan Carlos Pérez',
      demandado: 'María López',
    };
    const result = redactSensitiveData(data) as Record<string, string>;
    
    expect(result.demandante).toBe('REDACTED_TEST');
    expect(result.demandado).toBe('REDACTED_TEST');
  });

  it('should handle nested objects', () => {
    const data = {
      proceso: {
        demandante: { nombre: 'Test Name' },
      },
    };
    const result = redactSensitiveData(data) as any;
    
    expect(result.proceso.demandante.nombre).toBe('REDACTED_TEST');
  });

  it('should handle arrays', () => {
    const data = ['email@test.com', 'other text'];
    const result = redactSensitiveData(data) as string[];
    
    expect(result[0]).not.toContain('email@test.com');
  });
});
