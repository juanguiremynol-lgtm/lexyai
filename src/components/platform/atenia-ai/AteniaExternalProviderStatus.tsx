/**
 * AteniaExternalProviderStatus — External provider health panel for Atenia AI Supervisor
 */

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plug, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  evaluateExternalProviderHealth,
  type ExternalProviderHealthResult,
  type ExternalProviderObservation,
  getExternalObservationTitle,
} from '@/lib/services/atenia-ai-external-providers';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  organizationId: string;
}

interface ConnectorStatus {
  id: string;
  name: string;
  visibility: string;
  instance_status: 'active' | 'missing' | 'disabled';
  mapping_status: 'ACTIVE' | 'DRAFT' | 'NONE';
  sync_success_24h: number;
  sync_total_24h: number;
  errors: Array<{ code: string; count: number }>;
}

export function AteniaExternalProviderStatus({ organizationId }: Props) {
  // External provider health
  const { data: extHealth, isLoading: isLoadingHealth } = useQuery({
    queryKey: ['atenia-ext-provider-health', organizationId],
    queryFn: () => evaluateExternalProviderHealth(organizationId),
    staleTime: 1000 * 60 * 2,
    refetchInterval: 60000,
  });

  // Connector statuses for detailed cards
  const { data: connectorStatuses, isLoading: isLoadingConnectors } = useQuery({
    queryKey: ['atenia-ext-connector-statuses', organizationId],
    queryFn: async (): Promise<ConnectorStatus[]> => {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [
        { data: connectors },
        { data: instances },
        { data: mappings },
        { data: traces },
      ] = await Promise.all([
        (supabase.from('provider_connectors') as any)
          .select('id, name, visibility, is_enabled')
          .eq('is_enabled', true),
        (supabase.from('provider_instances') as any)
          .select('connector_id, scope, is_enabled'),
        (supabase.from('provider_mapping_specs') as any)
          .select('provider_connector_id, status')
          .in('status', ['ACTIVE', 'DRAFT']),
        (supabase.from('provider_sync_traces') as any)
          .select('provider_instance_id, ok, result_code')
          .eq('stage', 'TERMINAL')
          .gte('created_at', twentyFourHoursAgo)
          .limit(500),
      ]);

      if (!connectors || connectors.length === 0) return [];

      // Map instances to connectors
      const instanceByConnector = new Map<string, { active: boolean }>();
      for (const inst of (instances || [])) {
        const existing = instanceByConnector.get(inst.connector_id);
        if (!existing || inst.is_enabled) {
          instanceByConnector.set(inst.connector_id, { active: inst.is_enabled });
        }
      }

      // Map instance IDs to connector IDs for trace lookup
      const instanceToConnector = new Map<string, string>();
      for (const inst of (instances || [])) {
        instanceToConnector.set(inst.id, inst.connector_id);
      }

      // Mapping status per connector
      const mappingByConnector = new Map<string, string>();
      for (const m of (mappings || [])) {
        const existing = mappingByConnector.get(m.provider_connector_id);
        if (m.status === 'ACTIVE' || !existing) {
          mappingByConnector.set(m.provider_connector_id, m.status);
        }
      }

      // Trace stats per connector
      const traceStats = new Map<string, { success: number; total: number; errors: Map<string, number> }>();
      for (const t of (traces || [])) {
        const connId = instanceToConnector.get(t.provider_instance_id);
        if (!connId) continue;
        if (!traceStats.has(connId)) traceStats.set(connId, { success: 0, total: 0, errors: new Map() });
        const stats = traceStats.get(connId)!;
        stats.total++;
        if (t.ok) stats.success++;
        else if (t.result_code) {
          stats.errors.set(t.result_code, (stats.errors.get(t.result_code) || 0) + 1);
        }
      }

      return connectors.map((c: any) => {
        const inst = instanceByConnector.get(c.id);
        const stats = traceStats.get(c.id);
        const errors: Array<{ code: string; count: number }> = [];
        if (stats) {
          for (const [code, count] of stats.errors) {
            errors.push({ code, count });
          }
        }

        return {
          id: c.id,
          name: c.name,
          visibility: c.visibility,
          instance_status: inst ? (inst.active ? 'active' : 'disabled') : 'missing',
          mapping_status: (mappingByConnector.get(c.id) as ConnectorStatus['mapping_status']) || 'NONE',
          sync_success_24h: stats?.success || 0,
          sync_total_24h: stats?.total || 0,
          errors,
        } satisfies ConnectorStatus;
      });
    },
    staleTime: 1000 * 60 * 2,
    refetchInterval: 60000,
  });

  const isLoading = isLoadingHealth || isLoadingConnectors;

  // Missing platform routes from health observations
  const missingPlatformObs = extHealth?.observations.find(
    (o) => o.type === 'ext_missing_platform_instance'
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Proveedores Externos
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !connectorStatuses || connectorStatuses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay proveedores externos configurados.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Summary line */}
            <div className="text-sm text-muted-foreground">
              {extHealth?.connectors_checked || 0} conectores activos ·{' '}
              {extHealth?.issues_found === 0 ? (
                <span className="text-green-600">Sin problemas detectados</span>
              ) : (
                <span className="text-amber-600">
                  {extHealth?.issues_found} problema(s)
                </span>
              )}
            </div>

            {/* Per-connector cards */}
            {connectorStatuses.map((connector) => (
              <div key={connector.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusDot status={connector.instance_status} />
                    <span className="text-sm font-medium">{connector.name}</span>
                    <Badge variant={connector.visibility === 'PLATFORM' ? 'default' : 'secondary'}>
                      {connector.visibility}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {connector.sync_success_24h}/{connector.sync_total_24h} exitosos
                  </span>
                </div>

                {/* Instance + mapping status */}
                <div className="text-xs text-muted-foreground pl-5">
                  Instancia:{' '}
                  {connector.instance_status === 'active'
                    ? '🟢 Activa'
                    : connector.instance_status === 'missing'
                    ? '🔴 Sin instancia'
                    : '🟡 Deshabilitada'}{' '}
                  · Mapping:{' '}
                  {connector.mapping_status === 'ACTIVE'
                    ? '🟢 Activo'
                    : connector.mapping_status === 'DRAFT'
                    ? '🟡 Borrador'
                    : '⚪ No configurado'}
                </div>

                {/* Error breakdown */}
                {connector.errors.length > 0 && (
                  <div className="pl-5 space-y-1">
                    {connector.errors.map((err, i) => (
                      <div key={i} className="text-xs text-destructive">
                        ⚠️ {err.code}: {err.count} ocurrencia(s)
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Missing platform instance alert */}
            {missingPlatformObs && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
                <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  ⚠️ {missingPlatformObs.detail}
                </div>
                <div className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  Estas rutas están configuradas pero no pueden ejecutarse porque no existe una
                  instancia de plataforma activa. Un Super Admin debe crearla desde el wizard.
                </div>
                {missingPlatformObs.affected_workflows && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Workflows afectados: {missingPlatformObs.affected_workflows.join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* Other observations */}
            {extHealth?.observations
              .filter((o) => o.type !== 'ext_missing_platform_instance')
              .map((obs, i) => (
                <ObservationCard key={i} observation={obs} />
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === 'active') return <span className="inline-block w-3 h-3 rounded-full bg-green-500" />;
  if (status === 'missing') return <span className="inline-block w-3 h-3 rounded-full bg-red-500" />;
  return <span className="inline-block w-3 h-3 rounded-full bg-yellow-500" />;
}

function ObservationCard({ observation }: { observation: ExternalProviderObservation }) {
  const title = getExternalObservationTitle(observation);
  const isError = observation.severity === 'critical';
  const isWarning = observation.severity === 'warning';

  return (
    <div
      className={`rounded-lg border p-3 ${
        isError
          ? 'border-destructive/30 bg-destructive/5'
          : isWarning
          ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800'
          : 'border-muted'
      }`}
    >
      <div className="flex items-center gap-2">
        {isError ? (
          <AlertTriangle className="h-4 w-4 text-destructive" />
        ) : isWarning ? (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">{title}</span>
        {observation.count && (
          <Badge variant="outline" className="text-[10px]">
            {observation.count}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1 pl-6">{observation.detail}</p>
    </div>
  );
}
