/**
 * Atenia AI External Provider Integration
 *
 * Bridges Atenia AI's autonomous supervision with the External Provider system.
 * Provides:
 * - Health evaluation for heartbeat (evaluateExternalProviderHealth)
 * - Retry evaluation for corrective sync (evaluateExternalProviderRetries)
 * - Gemini context builder (buildExternalProviderContext)
 * - User report diagnostics (gatherExternalProviderDiagnostics)
 *
 * NEVER exposes secrets, base_urls, or raw API payloads.
 */

import { supabase } from '@/integrations/supabase/client';

// ============= TYPES =============

export interface ExternalProviderObservation {
  type: 'ext_missing_platform_instance' | 'ext_sync_failures' | 'ext_stale_mapping_drafts' | 'ext_provider_degraded';
  severity: 'info' | 'warning' | 'critical';
  detail: string;
  error_code?: string;
  count?: number;
  connector_id?: string;
  affected_connectors?: string[];
  affected_workflows?: string[];
  sample_work_items?: string[];
  sample_connector_ids?: string[];
  stats?: { ok: number; error: number; empty: number; pending: number };
}

export interface ExternalProviderHealthResult {
  observations: ExternalProviderObservation[];
  connectors_checked: number;
  issues_found: number;
}

export interface ExternalProviderRetryItem {
  work_item_id: string;
  connector_id: string;
  reason: string;
}

export interface ExternalProviderDiagnostics {
  external_provider_involved: boolean;
  connectors: Array<{ name: string; visibility: string }> | null;
  recent_traces: Array<{
    step: string;
    success: boolean;
    error_code: string | null;
    latency_ms: number | null;
    age: string;
  }>;
  raw_snapshots: Array<{
    status: string;
    age: string;
    error: string | null;
  }> | null;
  mapping_specs_active: number;
  unmapped_extras_count: number;
  has_unmapped_fields: boolean;
}

// ============= HEARTBEAT HEALTH =============

/**
 * Evaluates External Provider health across all active connectors.
 * Called during heartbeat OBSERVE phase.
 */
export async function evaluateExternalProviderHealth(
  _orgId: string
): Promise<ExternalProviderHealthResult> {
  const result: ExternalProviderHealthResult = {
    observations: [],
    connectors_checked: 0,
    issues_found: 0,
  };

  try {
    // 1. Check for GLOBAL routes missing PLATFORM instances
    const { data: globalRoutes } = await (supabase
      .from('provider_category_routes_global') as any)
      .select('id, workflow, provider_connector_id, enabled')
      .eq('enabled', true);

    const { data: platformInstances } = await (supabase
      .from('provider_instances') as any)
      .select('connector_id, is_enabled')
      .eq('scope', 'PLATFORM')
      .eq('is_enabled', true);

    const platformConnectorIds = new Set(
      (platformInstances || []).map((i: any) => i.connector_id)
    );

    const missingPlatformRoutes = (globalRoutes || []).filter(
      (r: any) => !platformConnectorIds.has(r.provider_connector_id)
    );

    if (missingPlatformRoutes.length > 0) {
      result.observations.push({
        type: 'ext_missing_platform_instance',
        severity: 'warning',
        detail: `${missingPlatformRoutes.length} ruta(s) GLOBAL sin instancia PLATFORM activa`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        affected_connectors: Array.from(new Set<string>(missingPlatformRoutes.map((r: any) => String(r.provider_connector_id)))),
        affected_workflows: missingPlatformRoutes.map((r: any) => String(r.workflow)),
      });
      result.issues_found++;
    }

    // 2. Check recent external provider sync failures (last 24h)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentTraces } = await (supabase
      .from('provider_sync_traces') as any)
      .select('provider_instance_id, stage, ok, result_code, work_item_id, created_at')
      .gte('created_at', twentyFourHoursAgo)
      .eq('stage', 'TERMINAL')
      .order('created_at', { ascending: false })
      .limit(500);

    const failedTraces = (recentTraces || []).filter((t: any) => !t.ok);

    if (failedTraces.length > 0) {
      const errorGroups: Record<string, any[]> = {};
      for (const trace of failedTraces) {
        const code = trace.result_code || 'UNKNOWN';
        if (!errorGroups[code]) errorGroups[code] = [];
        errorGroups[code].push(trace);
      }

      for (const [code, traces] of Object.entries(errorGroups)) {
        const severity: 'info' | 'warning' | 'critical' =
          code === 'PROVIDER_UNPARSABLE_SNAPSHOT' ? 'critical'
          : code === 'MISSING_PLATFORM_INSTANCE' ? 'warning'
          : code === 'MAPPING_SPEC_MISSING' ? 'warning'
          : traces.length >= 5 ? 'critical'
          : 'warning';

        result.observations.push({
          type: 'ext_sync_failures',
          severity,
          error_code: code,
          count: traces.length,
          detail: `${traces.length} sync(s) externos fallaron con ${code} en las últimas 24h`,
          sample_work_items: traces.slice(0, 3).map((t: any) => t.work_item_id),
          sample_connector_ids: [...new Set(traces.map((t: any) => t.provider_instance_id).filter(Boolean))],
        });
        result.issues_found++;
      }
    }

    // 3. Check for stale DRAFT mapping specs (>7 days)
    const { data: draftSpecs } = await (supabase
      .from('provider_mapping_specs') as any)
      .select('id, provider_connector_id, scope, created_at')
      .eq('status', 'DRAFT');

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const staleDrafts = (draftSpecs || []).filter((s: any) => {
      return Date.now() - new Date(s.created_at).getTime() > sevenDaysMs;
    });

    if (staleDrafts.length > 0) {
      result.observations.push({
        type: 'ext_stale_mapping_drafts',
        severity: 'info',
        detail: `${staleDrafts.length} mapping spec(s) en DRAFT por más de 7 días`,
        affected_connectors: Array.from(new Set<string>(staleDrafts.map((s: any) => String(s.provider_connector_id)))),
      });
    }

    // 4. Check raw snapshot error rates per connector (last 24h)
    const { data: rawSnapshots } = await (supabase
      .from('provider_raw_snapshots') as any)
      .select('connector_id, status')
      .gte('fetched_at', twentyFourHoursAgo)
      .limit(1000);

    if (rawSnapshots && rawSnapshots.length > 0) {
      const byConnector: Record<string, { ok: number; error: number; empty: number; pending: number }> = {};
      for (const snap of rawSnapshots) {
        const cid = snap.connector_id || 'unknown';
        if (!byConnector[cid]) byConnector[cid] = { ok: 0, error: 0, empty: 0, pending: 0 };
        const status = (snap.status || 'error').toUpperCase();
        if (status === 'OK') byConnector[cid].ok++;
        else if (status === 'EMPTY') byConnector[cid].empty++;
        else if (status === 'PENDING') byConnector[cid].pending++;
        else byConnector[cid].error++;
      }

      for (const [connectorId, counts] of Object.entries(byConnector)) {
        const total = counts.ok + counts.error + counts.empty + counts.pending;
        const errorRate = total > 0 ? (counts.error / total) * 100 : 0;

        if (errorRate >= 50) {
          result.observations.push({
            type: 'ext_provider_degraded',
            severity: 'critical',
            detail: `Conector externo tiene ${errorRate.toFixed(0)}% tasa de error (${counts.error}/${total} snapshots)`,
            connector_id: connectorId,
            stats: counts,
          });
          result.issues_found++;
        } else if (errorRate >= 20) {
          result.observations.push({
            type: 'ext_provider_degraded',
            severity: 'warning',
            detail: `Conector externo tiene ${errorRate.toFixed(0)}% tasa de error`,
            connector_id: connectorId,
            stats: counts,
          });
          result.issues_found++;
        }
      }
    }

    // 5. Count active connectors
    const { count: activeConnectors } = await (supabase
      .from('provider_connectors') as any)
      .select('id', { count: 'exact', head: true })
      .eq('is_enabled', true);

    result.connectors_checked = activeConnectors || 0;
  } catch (err) {
    console.error('[atenia-ai-ext] evaluateExternalProviderHealth error:', err);
  }

  return result;
}

// ============= CORRECTIVE SYNC RETRIES =============

const RETRYABLE_ERROR_CODES = [
  'PROVIDER_TIMEOUT',
  'PROVIDER_5XX',
  'SNAPSHOT_FETCH_FAILED',
  'MAPPING_ERROR',
];

/**
 * Evaluates external provider items that need retry.
 * Only retries items with transient errors, ≤3 retries in 24h, capped at 5 per cycle.
 */
export async function evaluateExternalProviderRetries(_orgId: string): Promise<{
  should_sync: boolean;
  items: ExternalProviderRetryItem[];
}> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: failedTerminals } = await (supabase
      .from('provider_sync_traces') as any)
      .select('work_item_id, provider_instance_id, result_code, created_at')
      .eq('stage', 'TERMINAL')
      .eq('ok', false)
      .in('result_code', RETRYABLE_ERROR_CODES)
      .gte('created_at', twentyFourHoursAgo)
      .limit(200);

    if (!failedTerminals || failedTerminals.length === 0) {
      return { should_sync: false, items: [] };
    }

    // Count retries per work_item to avoid retry storms
    const retryCounts: Record<string, { count: number; instance_id: string }> = {};
    for (const t of failedTerminals) {
      if (!t.work_item_id) continue;
      const key = `${t.work_item_id}:${t.provider_instance_id || ''}`;
      if (!retryCounts[key]) {
        retryCounts[key] = { count: 0, instance_id: t.provider_instance_id || '' };
      }
      retryCounts[key].count++;
    }

    const retryable = Object.entries(retryCounts)
      .filter(([_, v]) => v.count <= 3)
      .map(([key, v]) => {
        const [work_item_id] = key.split(':');
        return {
          work_item_id,
          connector_id: v.instance_id,
          reason: `${v.count} fallo(s) transitorio(s) en 24h — reintentable`,
        };
      })
      .slice(0, 5); // Cap at 5 per heartbeat cycle

    return {
      should_sync: retryable.length > 0,
      items: retryable,
    };
  } catch (err) {
    console.error('[atenia-ai-ext] evaluateExternalProviderRetries error:', err);
    return { should_sync: false, items: [] };
  }
}

// ============= GEMINI CONTEXT BUILDER =============

/**
 * Builds sanitized external provider context for Gemini.
 * NEVER includes secrets, base_urls, or raw API payloads.
 */
export async function buildExternalProviderContext(_orgId: string): Promise<Record<string, any>> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: connectors },
      { data: globalRoutes },
      { data: instances },
      { data: mappingSpecs },
      { data: traceTerminals },
      { data: snapshots },
    ] = await Promise.all([
      (supabase.from('provider_connectors') as any)
        .select('id, name, visibility, is_enabled, capabilities, created_at')
        .eq('is_enabled', true),
      (supabase.from('provider_category_routes_global') as any)
        .select('workflow, provider_connector_id, enabled, priority')
        .eq('enabled', true),
      (supabase.from('provider_instances') as any)
        .select('connector_id, scope, is_enabled')
        .eq('is_enabled', true),
      (supabase.from('provider_mapping_specs') as any)
        .select('provider_connector_id, scope, status, created_at')
        .in('status', ['ACTIVE', 'DRAFT']),
      (supabase.from('provider_sync_traces') as any)
        .select('provider_instance_id, stage, ok, result_code, latency_ms')
        .eq('stage', 'TERMINAL')
        .gte('created_at', twentyFourHoursAgo)
        .limit(500),
      (supabase.from('provider_raw_snapshots') as any)
        .select('connector_id, status')
        .gte('fetched_at', twentyFourHoursAgo)
        .limit(500),
    ]);

    // Connector summaries (no secrets, no base_url)
    const connectorSummaries = (connectors || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      visibility: c.visibility,
    }));

    // Trace summary grouped by instance
    const traceSummary: Record<string, { success: number; failed: number; errors: string[] }> = {};
    for (const t of (traceTerminals || [])) {
      const key = t.provider_instance_id || 'unknown';
      if (!traceSummary[key]) traceSummary[key] = { success: 0, failed: 0, errors: [] };
      if (t.ok) traceSummary[key].success++;
      else {
        traceSummary[key].failed++;
        if (t.result_code && !traceSummary[key].errors.includes(t.result_code)) {
          traceSummary[key].errors.push(t.result_code);
        }
      }
    }

    // Snapshot summary
    const snapshotSummary: Record<string, Record<string, number>> = {};
    for (const s of (snapshots || [])) {
      const cid = s.connector_id || 'unknown';
      if (!snapshotSummary[cid]) snapshotSummary[cid] = {};
      snapshotSummary[cid][s.status] = (snapshotSummary[cid][s.status] || 0) + 1;
    }

    return {
      connectors: connectorSummaries,
      global_routes: (globalRoutes || []).length,
      instances: {
        platform: (instances || []).filter((i: any) => i.scope === 'PLATFORM').length,
        org: (instances || []).filter((i: any) => i.scope === 'ORG').length,
      },
      mapping_specs: {
        active: (mappingSpecs || []).filter((s: any) => s.status === 'ACTIVE').length,
        draft: (mappingSpecs || []).filter((s: any) => s.status === 'DRAFT').length,
      },
      sync_traces_24h: traceSummary,
      snapshot_health_24h: snapshotSummary,
      routing_resolution: 'ORG_OVERRIDE → GLOBAL → BUILT-IN',
      platform_semantics: 'GLOBAL routes require PLATFORM instance; ORG_OVERRIDE routes require ORG instance',
    };
  } catch (err) {
    console.error('[atenia-ai-ext] buildExternalProviderContext error:', err);
    return { error: 'Failed to build external provider context' };
  }
}

// ============= USER REPORT DIAGNOSTICS =============

/**
 * Gathers external provider diagnostics for a specific work item.
 * Returns null if the work item has no external provider involvement.
 */
export async function gatherExternalProviderDiagnostics(
  workItemId: string
): Promise<ExternalProviderDiagnostics | null> {
  try {
    // 1. Check for external provider sync traces
    const { data: traces } = await (supabase
      .from('provider_sync_traces') as any)
      .select('provider_instance_id, stage, ok, result_code, latency_ms, created_at')
      .eq('work_item_id', workItemId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!traces || traces.length === 0) return null;

    // 2. Get connector info via instances
    const instanceIds = [...new Set(traces.map((t: any) => t.provider_instance_id).filter(Boolean))];

    let connectors: any[] = [];
    if (instanceIds.length > 0) {
      const { data: instanceData } = await (supabase
        .from('provider_instances') as any)
        .select('connector_id')
        .in('id', instanceIds);

      const connectorIds = [...new Set((instanceData || []).map((i: any) => i.connector_id).filter(Boolean))];

      if (connectorIds.length > 0) {
        const { data: connectorData } = await (supabase
          .from('provider_connectors') as any)
          .select('id, name, visibility')
          .in('id', connectorIds);
        connectors = connectorData || [];
      }
    }

    // 3. Raw snapshots
    const { data: snapshots } = await (supabase
      .from('provider_raw_snapshots') as any)
      .select('connector_id, status, fetched_at, normalized_error_code')
      .eq('work_item_id', workItemId)
      .order('fetched_at', { ascending: false })
      .limit(5);

    // 4. Mapping spec status
    const connectorIdsFromConnectors = connectors.map((c: any) => c.id);
    let mappingSpecCount = 0;
    if (connectorIdsFromConnectors.length > 0) {
      const { count } = await (supabase
        .from('provider_mapping_specs') as any)
        .select('id', { count: 'exact', head: true })
        .in('provider_connector_id', connectorIdsFromConnectors)
        .eq('status', 'ACTIVE');
      mappingSpecCount = count || 0;
    }

    // 5. Extras (unmapped fields)
    const { count: extrasCount } = await (supabase
      .from('work_item_act_extras') as any)
      .select('id', { count: 'exact', head: true })
      .eq('work_item_id', workItemId);

    return {
      external_provider_involved: true,
      connectors: connectors.map((c: any) => ({ name: c.name, visibility: c.visibility })),
      recent_traces: traces.slice(0, 10).map((t: any) => ({
        step: t.stage,
        success: t.ok,
        error_code: t.result_code,
        latency_ms: t.latency_ms,
        age: t.created_at,
      })),
      raw_snapshots: snapshots?.map((s: any) => ({
        status: s.status,
        age: s.fetched_at,
        error: s.normalized_error_code,
      })) || null,
      mapping_specs_active: mappingSpecCount,
      unmapped_extras_count: extrasCount || 0,
      has_unmapped_fields: (extrasCount || 0) > 0,
    };
  } catch (err) {
    console.error('[atenia-ai-ext] gatherExternalProviderDiagnostics error:', err);
    return null;
  }
}

// ============= DIAGNOSTIC TITLE HELPER =============

export function getExternalObservationTitle(obs: ExternalProviderObservation): string {
  switch (obs.type) {
    case 'ext_missing_platform_instance':
      return 'RUTAS GLOBALES SIN INSTANCIA';
    case 'ext_sync_failures':
      return `FALLO EXTERNO: ${obs.error_code || 'DESCONOCIDO'}`;
    case 'ext_stale_mapping_drafts':
      return 'MAPPINGS EN BORRADOR';
    case 'ext_provider_degraded':
      return 'PROVEEDOR EXTERNO DEGRADADO';
    default:
      return 'PROBLEMA EXTERNO';
  }
}

// ============= GEMINI PROMPT EXTENSION =============

export const EXTERNAL_PROVIDER_GEMINI_SYSTEM_PROMPT = `
## Proveedores Externos

ATENIA soporta proveedores de datos externos vía conectores Cloud Run. Estos complementan los proveedores built-in (CPNU, SAMAI, Publicaciones, Tutelas).

Conceptos clave:
- PLATFORM: Super Admin crea, sirve a TODAS las organizaciones automáticamente — sin acción de orgs.
- ORG_PRIVATE: Org Admin crea, sirve solo a su organización.
- Resolución de rutas: ORG_OVERRIDE → GLOBAL → BUILT-IN (overrides de org ganan, luego rutas globales, luego built-in).
- Rutas GLOBAL REQUIEREN una instancia PLATFORM activa. Si falta → skip_reason = MISSING_PLATFORM_INSTANCE.
- Mapping specs transforman datos crudos del proveedor al formato canónico ATENIA. Ciclo de vida: DRAFT → ACTIVE → ARCHIVED.
- Raw snapshots se persisten para cada intento de sync. Estados: OK, PENDING, EMPTY, ERROR.
- Sync traces tienen 7 etapas: SNAPSHOT_FETCHED → RAW_SAVED → MAPPING_APPLIED → UPSERTED_CANONICAL → PROVENANCE_WRITTEN → EXTRAS_WRITTEN → TERMINAL.

Al diagnosticar problemas de proveedores externos:
1. Verificar si la ruta existe y está activa
2. Verificar si la instancia requerida existe (PLATFORM para GLOBAL, ORG para ORG_OVERRIDE)
3. Verificar estado del raw snapshot — ERROR significa que el API del conector falló, EMPTY significa que no retornó datos
4. Verificar estado del mapping spec — specs DRAFT NUNCA se aplican; solo specs ACTIVE se usan
5. Verificar sync traces para la etapa específica de falla
6. Códigos de error: PROVIDER_UNPARSABLE_SNAPSHOT, MISSING_PLATFORM_INSTANCE, MAPPING_SPEC_MISSING, MAPPING_ERROR, DEDUPE_ERROR

NUNCA revelar secretos, base_urls, o payloads crudos de APIs en el análisis.
`;
