/**
 * Integration Tab - Secrets status, provider connectivity, quick stats
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Loader2, 
  RefreshCw,
  Wifi,
  WifiOff,
  Shield,
  Database,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ProviderHealthCheck {
  connectivity: {
    ok: boolean;
    status?: number;
    latencyMs?: number;
    error?: string;
  };
  auth?: {
    ok: boolean;
    status?: number;
    latencyMs?: number;
    error?: string;
    error_code?: string;
    api_key_source: string;
    api_key_present: boolean;
    api_key_fingerprint: string | null;
  };
}

interface IntegrationHealthResult {
  ok: boolean;
  env: Record<string, boolean>;
  optional_keys?: Record<string, boolean>;
  email_gateway?: {
    configured: boolean;
    base_url_set: boolean;
    api_key_set: boolean;
    from_address_set: boolean;
  };
  provider_health?: Record<string, ProviderHealthCheck>;
  test_identifiers?: {
    cpnu_test_radicado_set: boolean;
    samai_test_radicado_set: boolean;
  };
  timestamp: string;
}

export function IntegrationTab() {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Fetch integration health
  const { data: healthData, isLoading, refetch, error } = useQuery({
    queryKey: ['super-debug-integration-health'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<IntegrationHealthResult>(
        'integration-health',
        { body: {} }
      );
      if (error) throw error;
      setLastRefresh(new Date());
      return data;
    },
    staleTime: 60000,
  });

  // Fetch quick stats
  const { data: statsData } = useQuery({
    queryKey: ['super-debug-quick-stats'],
    queryFn: async () => {
      // Cast to any to avoid TypeScript deep instantiation issues with Supabase types
      const workItemsRes = await (supabase.from('work_items') as any).select('*', { count: 'exact', head: true }).eq('is_archived', false);
      const actuacionesRes = await (supabase.from('work_item_acts') as any).select('*', { count: 'exact', head: true }).eq('is_archived', false);
      const publicacionesRes = await (supabase.from('work_item_publicaciones') as any).select('*', { count: 'exact', head: true }).eq('is_archived', false);
      
      const syncAuditRes = await (supabase.from('sync_audit_log') as any)
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const failedRes = await (supabase.from('sync_audit_log') as any)
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ERROR')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      return {
        workItems: workItemsRes.count || 0,
        actuaciones: actuacionesRes.count || 0,
        publicaciones: publicacionesRes.count || 0,
        syncsToday: syncAuditRes.count || 0,
        failedToday: failedRes.count || 0,
      };
    },
  });

  const allSecretsPresent = healthData?.env && Object.values(healthData.env).every(Boolean);

  const handleRefresh = () => {
    refetch();
    toast.success('Actualizando estado de integración...');
  };

  return (
    <div className="space-y-6">
      {/* Secrets Status */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Secrets Configurados
          </h3>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Actualizar
          </Button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            Error: {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        )}

        {healthData?.env && (
          <div className="grid gap-2">
            {Object.entries(healthData.env).map(([name, present]) => (
              <div 
                key={name} 
                className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded text-sm"
              >
                <span className="font-mono">{name}</span>
                {present ? (
                  <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Present
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" />
                    Missing
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}

        {lastRefresh && (
          <p className="text-xs text-muted-foreground">
            Última verificación: {lastRefresh.toLocaleTimeString()}
          </p>
        )}
      </div>

      <Separator />

      {/* Provider Connectivity Matrix */}
      <div className="space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Wifi className="h-4 w-4" />
          Estado de Proveedores
        </h3>

        {healthData?.provider_health && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Provider</th>
                  <th className="text-left py-2 px-3 font-medium">Health</th>
                  <th className="text-left py-2 px-3 font-medium">Auth</th>
                  <th className="text-left py-2 px-3 font-medium">Latency</th>
                  <th className="text-left py-2 px-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(healthData.provider_health).map(([name, health]) => (
                  <tr key={name} className="border-b border-border/50">
                    <td className="py-2 px-3 font-medium uppercase">{name}</td>
                    <td className="py-2 px-3">
                      {health.connectivity.ok ? (
                        <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700">
                          ✅ {health.connectivity.status}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          ❌ {health.connectivity.status || 'Error'}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {health.auth?.ok ? (
                        <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700">
                          ✅ OK
                        </Badge>
                      ) : health.auth?.error_code === 'SKIPPED' ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          ⏭️ Skipped
                        </Badge>
                      ) : health.auth?.error_code === 'UPSTREAM_ROUTE_MISSING' ? (
                        <Badge variant="destructive">
                          🔌 Route Missing
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          ❌ {health.auth?.status || 'Error'}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {health.connectivity.latencyMs || health.auth?.latencyMs || '-'}ms
                    </td>
                    <td className="py-2 px-3">
                      {health.connectivity.ok && (health.auth?.ok || health.auth?.error_code === 'SKIPPED') ? (
                        <span className="text-emerald-600">Operativo</span>
                      ) : health.connectivity.ok ? (
                        <span className="text-amber-600">Auth Issue</span>
                      ) : (
                        <span className="text-destructive">Offline</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Separator />

      {/* Quick Stats */}
      <div className="space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Database className="h-4 w-4" />
          Estadísticas del Sistema
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-2xl font-bold text-primary">{statsData?.workItems || '-'}</div>
            <div className="text-xs text-muted-foreground">Work Items</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-2xl font-bold text-blue-600">{statsData?.actuaciones?.toLocaleString() || '-'}</div>
            <div className="text-xs text-muted-foreground">Actuaciones</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-2xl font-bold text-purple-600">{statsData?.publicaciones || '-'}</div>
            <div className="text-xs text-muted-foreground">Publicaciones</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-2xl font-bold text-emerald-600">{statsData?.syncsToday || '-'}</div>
            <div className="text-xs text-muted-foreground">Syncs Hoy</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-2xl font-bold text-destructive">{statsData?.failedToday || '-'}</div>
            <div className="text-xs text-muted-foreground">Fallidos Hoy</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-2xl font-bold text-amber-600">0</div>
            <div className="text-xs text-muted-foreground">Anomalías</div>
          </div>
        </div>
      </div>
    </div>
  );
}
