import { describe, it, expect } from 'vitest';
import {
  normalizeError,
  NormalizedErrorCode,
  isRetryable,
  isSuspendable,
  getErrorLabel,
  getRecommendedAction,
} from '../errorCodes';

describe('normalizeError', () => {
  it('classifies PROVIDER_TIMEOUT from rawCode', () => {
    const result = normalizeError({ rawCode: 'PROVIDER_TIMEOUT' });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_TIMEOUT);
    expect(result.meta.retryable).toBe(true);
  });

  it('classifies RECORD_NOT_FOUND from rawCode', () => {
    const result = normalizeError({ rawCode: 'RECORD_NOT_FOUND', provider: 'cpnu' });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_NOT_FOUND);
    expect(result.meta.suspendable).toBe(true);
    expect(result.meta.provider).toBe('cpnu');
  });

  it('classifies PROVIDER_404 from rawCode', () => {
    const result = normalizeError({ rawCode: 'PROVIDER_404' });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_NOT_FOUND);
  });

  it('classifies EMPTY_SNAPSHOT from rawCode', () => {
    const result = normalizeError({ rawCode: 'EMPTY_SNAPSHOT' });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_EMPTY_RESULT);
    expect(result.meta.retryable).toBe(false);
  });

  it('classifies SCRAPING_STUCK from rawCode', () => {
    const result = normalizeError({ rawCode: 'SCRAPING_STUCK' });
    expect(result.code).toBe(NormalizedErrorCode.SCRAPING_STUCK);
    expect(result.meta.suspendable).toBe(true);
  });

  it('classifies MISSING_PLATFORM_INSTANCE', () => {
    const result = normalizeError({ rawCode: 'MISSING_PLATFORM_INSTANCE' });
    expect(result.code).toBe(NormalizedErrorCode.MISSING_PLATFORM_INSTANCE);
    expect(result.meta.retryable).toBe(false);
  });

  it('classifies MAPPING_NOT_ACTIVE', () => {
    const result = normalizeError({ rawCode: 'MAPPING_NOT_ACTIVE' });
    expect(result.code).toBe(NormalizedErrorCode.MAPPING_NOT_ACTIVE);
  });

  it('classifies SNAPSHOT_PARSE_FAILED', () => {
    const result = normalizeError({ rawCode: 'SNAPSHOT_PARSE_FAILED' });
    expect(result.code).toBe(NormalizedErrorCode.SNAPSHOT_PARSE_FAILED);
  });

  it('classifies timeout from thrown error', () => {
    const result = normalizeError({ thrownError: 'AbortError: The operation was aborted' });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_TIMEOUT);
  });

  it('classifies ETIMEDOUT from thrown error', () => {
    const result = normalizeError({ thrownError: 'connect ETIMEDOUT 1.2.3.4:443' });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_TIMEOUT);
  });

  it('classifies network error from thrown error', () => {
    const result = normalizeError({ thrownError: 'ECONNREFUSED 127.0.0.1:3000' });
    expect(result.code).toBe(NormalizedErrorCode.NETWORK_ERROR);
  });

  it('classifies 401 from HTTP status', () => {
    const result = normalizeError({ responseStatus: 401 });
    expect(result.code).toBe(NormalizedErrorCode.UPSTREAM_AUTH);
  });

  it('classifies 403 from HTTP status', () => {
    const result = normalizeError({ responseStatus: 403 });
    expect(result.code).toBe(NormalizedErrorCode.UPSTREAM_AUTH);
  });

  it('classifies 404 with HTML body as UPSTREAM_ROUTE_MISSING', () => {
    const result = normalizeError({
      responseStatus: 404,
      bodyText: '<!DOCTYPE html><html><body>Cannot GET /api/foo</body></html>',
    });
    expect(result.code).toBe(NormalizedErrorCode.UPSTREAM_ROUTE_MISSING);
  });

  it('classifies 404 with JSON body as PROVIDER_NOT_FOUND', () => {
    const result = normalizeError({
      responseStatus: 404,
      bodyText: '{"error": "record not found"}',
    });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_NOT_FOUND);
  });

  it('classifies 429 from HTTP status', () => {
    const result = normalizeError({ responseStatus: 429 });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_RATE_LIMITED);
  });

  it('classifies 500 from HTTP status', () => {
    const result = normalizeError({ responseStatus: 500 });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_5XX);
  });

  it('classifies 502 from HTTP status', () => {
    const result = normalizeError({ responseStatus: 502 });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_5XX);
  });

  it('returns UNKNOWN for unrecognized input', () => {
    const result = normalizeError({});
    expect(result.code).toBe(NormalizedErrorCode.UNKNOWN);
  });

  it('includes bodyPreview capped at 200 chars', () => {
    const longBody = 'x'.repeat(500);
    const result = normalizeError({ bodyText: longBody, responseStatus: 500 });
    expect(result.meta.bodyPreview?.length).toBe(200);
  });

  it('classifies FUNCTION_INVOKE_FAILED from rawCode', () => {
    const result = normalizeError({ rawCode: 'FUNCTION_INVOKE_FAILED' });
    expect(result.code).toBe(NormalizedErrorCode.EDGE_INVOCATION_FAILED);
    expect(result.meta.retryable).toBe(true);
  });

  it('classifies PROVIDER_EMPTY_RESULT from rawCode', () => {
    const result = normalizeError({ rawCode: 'PROVIDER_EMPTY_RESULT' });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_EMPTY_RESULT);
    expect(result.meta.retryable).toBe(false);
  });

  it('prioritizes rawCode over responseStatus', () => {
    const result = normalizeError({
      rawCode: 'PROVIDER_TIMEOUT',
      responseStatus: 404,
    });
    expect(result.code).toBe(NormalizedErrorCode.PROVIDER_TIMEOUT);
  });
});

describe('isRetryable', () => {
  it('returns true for retryable codes', () => {
    expect(isRetryable(NormalizedErrorCode.PROVIDER_TIMEOUT)).toBe(true);
    expect(isRetryable(NormalizedErrorCode.PROVIDER_5XX)).toBe(true);
    expect(isRetryable(NormalizedErrorCode.NETWORK_ERROR)).toBe(true);
  });

  it('returns false for non-retryable codes', () => {
    expect(isRetryable(NormalizedErrorCode.MISSING_PLATFORM_INSTANCE)).toBe(false);
    expect(isRetryable(NormalizedErrorCode.MAPPING_NOT_ACTIVE)).toBe(false);
    expect(isRetryable(NormalizedErrorCode.UPSTREAM_AUTH)).toBe(false);
  });
});

describe('isSuspendable', () => {
  it('returns true for suspendable codes', () => {
    expect(isSuspendable(NormalizedErrorCode.PROVIDER_NOT_FOUND)).toBe(true);
    expect(isSuspendable(NormalizedErrorCode.EMPTY_RESULTS)).toBe(true);
    expect(isSuspendable(NormalizedErrorCode.SCRAPING_STUCK)).toBe(true);
  });

  it('returns false for non-suspendable codes', () => {
    expect(isSuspendable(NormalizedErrorCode.PROVIDER_TIMEOUT)).toBe(false);
    expect(isSuspendable(NormalizedErrorCode.NETWORK_ERROR)).toBe(false);
  });
});

describe('getErrorLabel', () => {
  it('returns Spanish labels', () => {
    expect(getErrorLabel(NormalizedErrorCode.PROVIDER_TIMEOUT)).toBe('Tiempo de espera excedido');
    expect(getErrorLabel(NormalizedErrorCode.UNKNOWN)).toBe('Error desconocido');
  });
});

describe('getRecommendedAction', () => {
  it('returns action text', () => {
    const action = getRecommendedAction(NormalizedErrorCode.PROVIDER_NOT_FOUND);
    expect(action).toContain('suspender');
  });
});
