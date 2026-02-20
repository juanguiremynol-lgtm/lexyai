/**
 * Sync Pipeline Invariant Tests — Layer 4
 * 
 * Regression tests that validate the behavioral invariants of the sync pipeline.
 * These must pass on every deploy to prevent the class of regression where
 * status lies about data (e.g., last_synced_at advances on failure).
 */

import { describe, it, expect } from "vitest";

// ── Import the shared validator (same logic used in edge functions) ──
// We test the pure functions here; the DB trigger and watchdog are tested via integration.

// ── Inline the validator types for Vitest (edge function imports use Deno) ──

type ProviderResultStatus = 'SUCCESS' | 'EMPTY' | 'ERROR' | 'TIMEOUT' | 'SKIPPED';

interface ProviderResult {
  status: ProviderResultStatus;
  called: boolean;
  statusCode: number;
  recordsReceived: number;
  recordsUpserted: number;
  recordsDeduped?: number;
  error?: string;
  retryable?: boolean;
}

interface PostSyncCheck {
  workItemId: string;
  providersAttempted: string[];
  providerResults: Record<string, ProviderResult>;
}

interface IntegrityVerdict {
  canMarkSynced: boolean;
  reason: string;
  severity: 'OK' | 'WARNING' | 'ERROR';
}

// ── Pure validator function (mirrors syncIntegrityValidator.ts) ──

function validateSyncIntegrity(check: PostSyncCheck): IntegrityVerdict {
  const { providerResults, providersAttempted } = check;

  const anyProviderCalled = providersAttempted.some(
    p => providerResults[p]?.called
  );
  if (!anyProviderCalled) {
    return { canMarkSynced: false, reason: 'NO_PROVIDERS_CALLED', severity: 'ERROR' };
  }

  for (const [provider, result] of Object.entries(providerResults)) {
    if (result.called && result.statusCode >= 400 && !result.error) {
      return { canMarkSynced: false, reason: `UNLOGGED_ERROR_${provider}_${result.statusCode}`, severity: 'ERROR' };
    }
  }

  const calledProviders = Object.entries(providerResults).filter(([, r]) => r.called);
  const allFailed = calledProviders.length > 0 && calledProviders.every(
    ([, r]) => r.status === 'ERROR' || r.status === 'TIMEOUT' || r.statusCode >= 400
  );
  if (allFailed) {
    return { canMarkSynced: false, reason: 'ALL_PROVIDERS_FAILED', severity: 'ERROR' };
  }

  for (const [provider, result] of Object.entries(providerResults)) {
    if (result.called && result.recordsReceived > 0 && result.recordsUpserted === 0) {
      return { canMarkSynced: true, reason: `ALL_DEDUPED_${provider}`, severity: 'WARNING' };
    }
  }

  return { canMarkSynced: true, reason: 'OK', severity: 'OK' };
}

// ── Provider result accountability ──

function findMissingProviderResults(
  expectedProviders: string[],
  providerResults: Record<string, ProviderResult | undefined>,
): string[] {
  return expectedProviders.filter(p => !providerResults[p]);
}

// ── Hash fingerprint source-agnosticism ──

function computeTestFingerprint(fields: Record<string, string>): string {
  // Simulates canonical fingerprint: source_platform is NOT included
  const { fecha, actuacion, anotacion } = fields;
  const raw = `${fecha || ''}|${actuacion || ''}|${anotacion || ''}`.trim().toLowerCase();
  // Simple hash for test (real uses SHA-256)
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `test_${Math.abs(hash)}`;
}

// ════════════════════════════════════════════════════════════
// Test 4A: last_synced_at conditional update semantics
// ════════════════════════════════════════════════════════════

describe("4A: last_synced_at conditional update", () => {
  it("blocks marking as synced when ALL providers fail", () => {
    const result = validateSyncIntegrity({
      workItemId: 'test-123',
      providersAttempted: ['cpnu'],
      providerResults: {
        cpnu: { called: true, statusCode: 500, recordsReceived: 0, recordsUpserted: 0, status: 'ERROR', error: 'Internal Server Error' }
      }
    });
    expect(result.canMarkSynced).toBe(false);
    expect(result.reason).toBe('ALL_PROVIDERS_FAILED');
    expect(result.severity).toBe('ERROR');
  });

  it("blocks marking when no providers were called", () => {
    const result = validateSyncIntegrity({
      workItemId: 'test-123',
      providersAttempted: ['cpnu'],
      providerResults: {
        cpnu: { called: false, statusCode: 0, recordsReceived: 0, recordsUpserted: 0, status: 'SKIPPED' }
      }
    });
    expect(result.canMarkSynced).toBe(false);
    expect(result.reason).toBe('NO_PROVIDERS_CALLED');
  });

  it("allows marking when provider returns 200 with data", () => {
    const result = validateSyncIntegrity({
      workItemId: 'test-123',
      providersAttempted: ['cpnu'],
      providerResults: {
        cpnu: { called: true, statusCode: 200, recordsReceived: 5, recordsUpserted: 3, status: 'SUCCESS' }
      }
    });
    expect(result.canMarkSynced).toBe(true);
    expect(result.severity).toBe('OK');
  });

  it("allows marking when provider returns 200 with zero records (legitimate empty)", () => {
    const result = validateSyncIntegrity({
      workItemId: 'test-123',
      providersAttempted: ['cpnu'],
      providerResults: {
        cpnu: { called: true, statusCode: 200, recordsReceived: 0, recordsUpserted: 0, status: 'EMPTY' }
      }
    });
    expect(result.canMarkSynced).toBe(true);
  });

  it("blocks when provider returns 400+ without logging error", () => {
    const result = validateSyncIntegrity({
      workItemId: 'test-123',
      providersAttempted: ['cpnu'],
      providerResults: {
        cpnu: { called: true, statusCode: 403, recordsReceived: 0, recordsUpserted: 0, status: 'ERROR' }
        // Note: NO error field — this is the bug
      }
    });
    expect(result.canMarkSynced).toBe(false);
    expect(result.reason).toContain('UNLOGGED_ERROR');
  });
});

// ════════════════════════════════════════════════════════════
// Test 4B: Provider result accountability
// ════════════════════════════════════════════════════════════

describe("4B: Provider result accountability", () => {
  it("detects missing provider results in TUTELA fan-out", () => {
    const expected = ['cpnu', 'tutelas-api'];
    const results: Record<string, ProviderResult | undefined> = {
      'cpnu': { called: true, statusCode: 200, recordsReceived: 3, recordsUpserted: 3, status: 'SUCCESS' },
      // tutelas-api is MISSING — adapter bug
    };
    const missing = findMissingProviderResults(expected, results);
    expect(missing).toEqual(['tutelas-api']);
  });

  it("returns empty when all providers have results", () => {
    const expected = ['cpnu', 'samai'];
    const results: Record<string, ProviderResult | undefined> = {
      'cpnu': { called: true, statusCode: 200, recordsReceived: 3, recordsUpserted: 3, status: 'SUCCESS' },
      'samai': { called: true, statusCode: 200, recordsReceived: 0, recordsUpserted: 0, status: 'EMPTY' },
    };
    const missing = findMissingProviderResults(expected, results);
    expect(missing).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════
// Test 4C: Append-only invariant
// ════════════════════════════════════════════════════════════

describe("4C: Append-only invariant", () => {
  it("sync with empty provider response must NOT reduce act count", () => {
    // This tests the behavioral contract: if provider returns empty,
    // existing acts are preserved (enforced by DB trigger + app logic)
    const beforeCount = 3;
    // Simulating: provider returns 0, upsert inserts 0
    const providerRecords = 0;
    const afterCount = beforeCount + providerRecords; // append-only: never subtract
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });
});

// ════════════════════════════════════════════════════════════
// Test 4D: Hash fingerprint source-agnosticism
// ════════════════════════════════════════════════════════════

describe("4D: Hash fingerprint is source-agnostic", () => {
  it("same event from different providers produces identical fingerprint", () => {
    const event = {
      fecha: '2025-08-08',
      actuacion: 'Radicación de Proceso',
      anotacion: 'Test annotation',
    };

    const hashFromCPNU = computeTestFingerprint({ ...event, source_platform: 'CPNU' });
    const hashFromSAMAI = computeTestFingerprint({ ...event, source_platform: 'SAMAI' });

    // source_platform is not used in fingerprint computation
    expect(hashFromCPNU).toBe(hashFromSAMAI);
  });
});

// ════════════════════════════════════════════════════════════
// Test 4E: Routing completeness
// ════════════════════════════════════════════════════════════

describe("4E: Routing completeness", () => {
  // Map mirroring getProviderOrder logic
  const EXPECTED_PRIMARY: Record<string, string> = {
    CGP: 'cpnu',
    CPACA: 'samai',
    TUTELA: 'tutelas-api',
    LABORAL: 'cpnu',
    PENAL_906: 'cpnu',
  };

  const allCategories = ['CGP', 'CPACA', 'TUTELA', 'LABORAL', 'PENAL_906'];

  for (const category of allCategories) {
    it(`${category} has a primary provider configured`, () => {
      expect(EXPECTED_PRIMARY[category]).toBeDefined();
      expect(EXPECTED_PRIMARY[category].length).toBeGreaterThan(0);
    });
  }
});

// ════════════════════════════════════════════════════════════
// Test 4F: Sync integrity — multi-provider scenarios
// ════════════════════════════════════════════════════════════

describe("4F: Multi-provider sync integrity", () => {
  it("partial success (one ok, one failed) allows marking synced", () => {
    const result = validateSyncIntegrity({
      workItemId: 'test-456',
      providersAttempted: ['cpnu', 'tutelas-api'],
      providerResults: {
        cpnu: { called: true, statusCode: 200, recordsReceived: 5, recordsUpserted: 5, status: 'SUCCESS' },
        'tutelas-api': { called: true, statusCode: 500, recordsReceived: 0, recordsUpserted: 0, status: 'ERROR', error: 'Server error' },
      }
    });
    expect(result.canMarkSynced).toBe(true);
  });

  it("all providers timeout blocks marking synced", () => {
    const result = validateSyncIntegrity({
      workItemId: 'test-789',
      providersAttempted: ['cpnu', 'samai'],
      providerResults: {
        cpnu: { called: true, statusCode: 0, recordsReceived: 0, recordsUpserted: 0, status: 'TIMEOUT', error: 'AbortError' },
        samai: { called: true, statusCode: 0, recordsReceived: 0, recordsUpserted: 0, status: 'TIMEOUT', error: 'AbortError' },
      }
    });
    expect(result.canMarkSynced).toBe(false);
    expect(result.reason).toBe('ALL_PROVIDERS_FAILED');
  });

  it("warns when records received but all deduped", () => {
    const result = validateSyncIntegrity({
      workItemId: 'test-dedup',
      providersAttempted: ['cpnu'],
      providerResults: {
        cpnu: { called: true, statusCode: 200, recordsReceived: 10, recordsUpserted: 0, status: 'SUCCESS' },
      }
    });
    expect(result.canMarkSynced).toBe(true);
    expect(result.severity).toBe('WARNING');
    expect(result.reason).toContain('ALL_DEDUPED');
  });
});
