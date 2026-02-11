import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

import { supabase } from '@/integrations/supabase/client';
import {
  evaluateExternalProviderHealth,
  evaluateExternalProviderRetries,
  buildExternalProviderContext,
  gatherExternalProviderDiagnostics,
  getExternalObservationTitle,
  EXTERNAL_PROVIDER_GEMINI_SYSTEM_PROMPT,
} from '../atenia-ai-external-providers';

function mockFrom(responses: Record<string, any>) {
  (supabase.from as any).mockImplementation((table: string) => {
    const data = responses[table];
    const builder: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: data?.single, error: null }),
    };
    // Terminal resolution
    builder.select.mockReturnValue({
      ...builder,
      then: (resolve: any) => resolve({ data: data?.rows || [], error: null, count: data?.count ?? 0 }),
    });
    return builder;
  });
}

describe('Atenia AI External Provider Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('evaluateExternalProviderHealth', () => {
    it('returns no issues when no external connectors exist', async () => {
      mockFrom({
        provider_category_routes_global: { rows: [] },
        provider_instances: { rows: [] },
        provider_sync_traces: { rows: [] },
        provider_mapping_specs: { rows: [] },
        provider_raw_snapshots: { rows: [] },
        provider_connectors: { rows: [], count: 0 },
      });

      const result = await evaluateExternalProviderHealth('org-1');
      expect(result.issues_found).toBe(0);
      expect(result.observations).toHaveLength(0);
    });

    it('detects GLOBAL routes missing PLATFORM instances', async () => {
      mockFrom({
        provider_category_routes_global: {
          rows: [
            { id: 'r1', workflow: 'CGP', provider_connector_id: 'conn-1', enabled: true },
            { id: 'r2', workflow: 'CPACA', provider_connector_id: 'conn-2', enabled: true },
          ],
        },
        provider_instances: { rows: [] }, // No platform instances
        provider_sync_traces: { rows: [] },
        provider_mapping_specs: { rows: [] },
        provider_raw_snapshots: { rows: [] },
        provider_connectors: { rows: [], count: 0 },
      });

      const result = await evaluateExternalProviderHealth('org-1');
      const missingObs = result.observations.find(o => o.type === 'ext_missing_platform_instance');
      expect(missingObs).toBeDefined();
      expect(missingObs!.severity).toBe('warning');
      expect(missingObs!.affected_connectors).toContain('conn-1');
    });

    it('marks PROVIDER_UNPARSABLE_SNAPSHOT as critical severity', async () => {
      mockFrom({
        provider_category_routes_global: { rows: [] },
        provider_instances: { rows: [] },
        provider_sync_traces: {
          rows: [
            { provider_instance_id: 'inst-1', stage: 'TERMINAL', ok: false, result_code: 'PROVIDER_UNPARSABLE_SNAPSHOT', work_item_id: 'wi-1', created_at: new Date().toISOString() },
          ],
        },
        provider_mapping_specs: { rows: [] },
        provider_raw_snapshots: { rows: [] },
        provider_connectors: { rows: [], count: 1 },
      });

      const result = await evaluateExternalProviderHealth('org-1');
      const failObs = result.observations.find(o => o.error_code === 'PROVIDER_UNPARSABLE_SNAPSHOT');
      expect(failObs).toBeDefined();
      expect(failObs!.severity).toBe('critical');
    });
  });

  describe('evaluateExternalProviderRetries', () => {
    it('returns no retries when no failures exist', async () => {
      mockFrom({
        provider_sync_traces: { rows: [] },
      });

      const result = await evaluateExternalProviderRetries('org-1');
      expect(result.should_sync).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it('excludes non-retryable errors (MISSING_PLATFORM_INSTANCE)', async () => {
      mockFrom({
        provider_sync_traces: {
          rows: [
            { work_item_id: 'wi-1', provider_instance_id: 'inst-1', result_code: 'MISSING_PLATFORM_INSTANCE', created_at: new Date().toISOString() },
          ],
        },
      });

      const result = await evaluateExternalProviderRetries('org-1');
      expect(result.should_sync).toBe(false);
    });
  });

  describe('buildExternalProviderContext (Gemini)', () => {
    it('never includes secrets or base_urls in output', async () => {
      mockFrom({
        provider_connectors: { rows: [{ id: 'c1', name: 'Test', visibility: 'PLATFORM', is_enabled: true, capabilities: ['ACTS'], created_at: '2025-01-01' }] },
        provider_category_routes_global: { rows: [] },
        provider_instances: { rows: [] },
        provider_mapping_specs: { rows: [] },
        provider_sync_traces: { rows: [] },
        provider_raw_snapshots: { rows: [] },
      });

      const ctx = await buildExternalProviderContext('org-1');
      const json = JSON.stringify(ctx);
      expect(json).not.toContain('base_url');
      expect(json).not.toContain('secret');
      expect(json).not.toContain('api_key');
    });
  });

  describe('gatherExternalProviderDiagnostics (User Reports)', () => {
    it('returns null when work item has no external traces', async () => {
      mockFrom({
        provider_sync_traces: { rows: [] },
      });

      const result = await gatherExternalProviderDiagnostics('wi-1');
      expect(result).toBeNull();
    });
  });

  describe('getExternalObservationTitle', () => {
    it('returns correct titles for each observation type', () => {
      expect(getExternalObservationTitle({ type: 'ext_missing_platform_instance', severity: 'warning', detail: '' })).toBe('RUTAS GLOBALES SIN INSTANCIA');
      expect(getExternalObservationTitle({ type: 'ext_sync_failures', severity: 'critical', detail: '', error_code: 'TIMEOUT' })).toBe('FALLO EXTERNO: TIMEOUT');
      expect(getExternalObservationTitle({ type: 'ext_stale_mapping_drafts', severity: 'info', detail: '' })).toBe('MAPPINGS EN BORRADOR');
      expect(getExternalObservationTitle({ type: 'ext_provider_degraded', severity: 'critical', detail: '' })).toBe('PROVEEDOR EXTERNO DEGRADADO');
    });
  });

  describe('EXTERNAL_PROVIDER_GEMINI_SYSTEM_PROMPT', () => {
    it('does not contain secrets or base_url references', () => {
      expect(EXTERNAL_PROVIDER_GEMINI_SYSTEM_PROMPT).not.toContain('api_key');
      expect(EXTERNAL_PROVIDER_GEMINI_SYSTEM_PROMPT).toContain('NUNCA revelar secretos');
    });
  });
});
