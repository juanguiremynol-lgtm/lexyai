/**
 * History Tab - Sync history, login runs, daily ledger, audit log
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  RefreshCw, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Clock,
  Search,
  Shield,
  Database,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export function HistoryTab() {
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch login sync runs
  const { data: loginRuns, isLoading: loginLoading, refetch: refetchLogin } = useQuery({
    queryKey: ['super-debug-login-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auto_sync_login_runs')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch daily sync ledger
  const { data: dailyLedger, isLoading: dailyLoading, refetch: refetchDaily } = useQuery({
    queryKey: ['super-debug-daily-ledger'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auto_sync_daily_ledger')
        .select('*')
        .order('run_date', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch sync audit log
  const { data: auditLogs, isLoading: auditLoading, refetch: refetchAudit } = useQuery({
    queryKey: ['super-debug-sync-audit', searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('sync_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (searchQuery) {
        query = query.ilike('radicado', `%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'SUCCESS':
      case 'OK':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'ERROR':
      case 'FAILED':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'PARTIAL':
      case 'RUNNING':
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'SUCCESS':
      case 'OK':
        return <Badge className="bg-emerald-500/20 text-emerald-700">Success</Badge>;
      case 'ERROR':
      case 'FAILED':
        return <Badge variant="destructive">Error</Badge>;
      case 'PARTIAL':
        return <Badge className="bg-amber-500/20 text-amber-700">Partial</Badge>;
      case 'RUNNING':
        return <Badge className="bg-blue-500/20 text-blue-700">Running</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleRefreshAll = () => {
    refetchLogin();
    refetchDaily();
    refetchAudit();
  };

  return (
    <div className="space-y-6">
      {/* Refresh button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleRefreshAll}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Actualizar Todo
        </Button>
      </div>

      {/* Login Sync Runs */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="font-medium">Login Sync Runs (auto_sync_login_runs)</h3>
          <Badge variant="outline" className="text-xs">Límite: 3/día</Badge>
        </div>
        
        <ScrollArea className="h-48 border rounded-lg">
          {loginLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : loginRuns?.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Sin registros</p>
          ) : (
            <div className="p-2 space-y-1">
              {loginRuns?.map((run) => (
                <div 
                  key={run.id} 
                  className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{run.run_date}</span>
                    <span className="text-muted-foreground text-xs">
                      user: {run.user_id?.slice(0, 8)}...
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {run.run_count}/3 runs
                    </Badge>
                    {run.last_run_at && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(run.last_run_at).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      <Separator />

      {/* Daily Sync Ledger */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="font-medium">Daily Sync Ledger (auto_sync_daily_ledger)</h3>
          <Badge variant="outline" className="text-xs">7:00 AM COT</Badge>
        </div>
        
        <ScrollArea className="h-48 border rounded-lg">
          {dailyLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : dailyLedger?.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Sin registros</p>
          ) : (
            <div className="p-2 space-y-1">
              {dailyLedger?.map((entry) => (
                <div 
                  key={entry.id} 
                  className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                >
                  <div className="flex items-center gap-2">
                    {getStatusIcon(entry.status)}
                    <span className="font-mono">{entry.run_date}</span>
                    <span className="text-muted-foreground text-xs">
                      org: {entry.organization_id?.slice(0, 8)}...
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(entry.status)}
                    <span className="text-xs text-muted-foreground">
                      {entry.items_succeeded ?? 0}/{entry.items_targeted ?? 0} items
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      <Separator />

      {/* Sync Audit Log */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <h3 className="font-medium">Sync Audit Log</h3>
          </div>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar radicado..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 h-8 text-sm"
            />
          </div>
        </div>
        
        <ScrollArea className="h-64 border rounded-lg">
          {auditLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : auditLogs?.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Sin registros</p>
          ) : (
            <div className="p-2 space-y-2">
              {auditLogs?.map((log) => (
                <div 
                  key={log.id} 
                  className="p-3 bg-muted/50 rounded text-sm space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(log.status)}
                      <span className="font-medium">{log.status}</span>
                      <Badge variant="outline" className="text-xs">
                        {log.edge_function || 'sync'}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {log.workflow_type}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: es })}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {log.radicado}
                  </div>
                  {log.error_message && (
                    <p className="text-xs text-muted-foreground truncate">{log.error_message}</p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {log.acts_count_before !== null && log.acts_count_after !== null && (
                      <span>
                        Acts: {log.acts_count_before} → {log.acts_count_after} 
                        (+{log.acts_inserted || 0})
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
