/**
 * ParallelSyncResults Component
 * 
 * Displays results from a parallel multi-source sync operation,
 * showing per-provider breakdown and consolidation stats.
 */

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CheckCircle2, XCircle, AlertTriangle, Clock, Minus } from 'lucide-react';
import { PROVIDER_DISPLAY_NAMES } from '@/lib/parallel-sync';

interface ProviderResultDisplay {
  provider: string;
  status: 'success' | 'error' | 'empty' | 'timeout' | 'not_found' | 'skipped';
  actuaciones_found: number;
  latencyMs: number;
  error?: string;
}

interface ConsolidationStats {
  total_from_sources: number;
  after_dedup: number;
  duplicates_removed: number;
  multi_source_confirmed?: number;
}

interface ParallelSyncResultsProps {
  providerResults: ProviderResultDisplay[];
  consolidated: ConsolidationStats;
  syncStrategy?: 'parallel' | 'fallback';
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-primary" />;
    case 'empty':
      return <Minus className="h-4 w-4 text-muted-foreground" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'timeout':
      return <Clock className="h-4 w-4 text-warning" />;
    case 'not_found':
      return <AlertTriangle className="h-4 w-4 text-warning" />;
    case 'skipped':
      return <Minus className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Minus className="h-4 w-4" />;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'success':
      return <Badge variant="default">✓ OK</Badge>;
    case 'empty':
      return <Badge variant="outline">Vacío</Badge>;
    case 'error':
      return <Badge variant="destructive">Error</Badge>;
    case 'timeout':
      return <Badge variant="secondary">Timeout</Badge>;
    case 'not_found':
      return <Badge variant="secondary">No encontrado</Badge>;
    case 'skipped':
      return <Badge variant="outline">Omitido</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function ParallelSyncResults({
  providerResults,
  consolidated,
  syncStrategy = 'parallel',
}: ParallelSyncResultsProps) {
  const successfulProviders = providerResults.filter(r => r.status === 'success');
  const totalActuaciones = providerResults.reduce((sum, r) => sum + r.actuaciones_found, 0);

  return (
    <div className="space-y-4">
      {/* Strategy indicator */}
      <div className="flex items-center gap-2">
        <Badge variant={syncStrategy === 'parallel' ? 'default' : 'secondary'}>
          {syncStrategy === 'parallel' ? 'PARALLEL' : 'FALLBACK'}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {syncStrategy === 'parallel'
            ? `${providerResults.length} fuentes consultadas simultáneamente`
            : `${successfulProviders.length} fuente(s) exitosa(s)`}
        </span>
      </div>

      {/* Provider breakdown */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fuente</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Encontrados</TableHead>
            <TableHead className="text-right">Tiempo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {providerResults.map(pr => (
            <TableRow key={pr.provider}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {getStatusIcon(pr.status)}
                  {PROVIDER_DISPLAY_NAMES[pr.provider] || pr.provider}
                </div>
              </TableCell>
              <TableCell>{getStatusBadge(pr.status)}</TableCell>
              <TableCell className="text-right">{pr.actuaciones_found}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {pr.latencyMs}ms
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Consolidation stats (only for parallel sync) */}
      {syncStrategy === 'parallel' && totalActuaciones > 0 && (
        <div className="bg-muted rounded-lg p-4">
          <h4 className="font-semibold mb-3">Consolidación Inteligente</h4>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Total de fuentes</p>
              <p className="text-2xl font-bold">{consolidated.total_from_sources}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Duplicados removidos</p>
              <p className="text-2xl font-bold text-warning">
                -{consolidated.duplicates_removed}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Únicos finales</p>
              <p className="text-2xl font-bold text-primary">
                {consolidated.after_dedup}
              </p>
            </div>
          </div>
          {consolidated.multi_source_confirmed !== undefined &&
            consolidated.multi_source_confirmed > 0 && (
              <p className="text-sm text-muted-foreground mt-3">
                <CheckCircle2 className="inline h-4 w-4 mr-1 text-primary" />
                {consolidated.multi_source_confirmed} actuación(es) confirmada(s) por
                múltiples fuentes
              </p>
            )}
        </div>
      )}
    </div>
  );
}
