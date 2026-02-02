/**
 * Email Tab - Email gateway status and queue
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Loader2,
  Mail,
  Send,
  Clock,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

export function EmailTab() {
  // Fetch integration health for email gateway
  const { data: healthData, isLoading: healthLoading, refetch } = useQuery({
    queryKey: ['super-debug-email-health'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('integration-health', { body: {} });
      if (error) throw error;
      return data;
    },
  });

  // Fetch email outbox stats
  const { data: emailStats, isLoading: statsLoading } = useQuery({
    queryKey: ['super-debug-email-stats'],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [pending, sent, failed, total] = await Promise.all([
        supabase.from('email_outbox').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
        supabase.from('email_outbox').select('id', { count: 'exact', head: true })
          .eq('status', 'SENT')
          .gte('sent_at', today.toISOString()),
        supabase.from('email_outbox').select('id', { count: 'exact', head: true })
          .eq('status', 'FAILED')
          .gte('created_at', today.toISOString()),
        supabase.from('email_outbox').select('id', { count: 'exact', head: true }),
      ]);

      return {
        pending: pending.count || 0,
        sentToday: sent.count || 0,
        failedToday: failed.count || 0,
        total: total.count || 0,
      };
    },
  });

  // Fetch recent emails
  const { data: recentEmails, isLoading: emailsLoading } = useQuery({
    queryKey: ['super-debug-recent-emails'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_outbox')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data;
    },
  });

  const emailGateway = healthData?.email_gateway;
  const isConfigured = emailGateway?.configured;

  const getStatusIcon = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'SENT':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'FAILED':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'PENDING':
        return <Clock className="h-4 w-4 text-amber-500" />;
      default:
        return <Mail className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'SENT':
        return <Badge className="bg-emerald-500/20 text-emerald-700">Sent</Badge>;
      case 'FAILED':
        return <Badge variant="destructive">Failed</Badge>;
      case 'PENDING':
        return <Badge className="bg-amber-500/20 text-amber-700">Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Gateway Status */}
      <div className={cn(
        "rounded-lg border p-4",
        isConfigured ? "bg-emerald-500/5 border-emerald-500/30" : "bg-amber-500/5 border-amber-500/30"
      )}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {isConfigured ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-6 w-6 text-amber-600" />
            )}
            <div>
              <h3 className="font-medium">Email Gateway (Cloud Run)</h3>
              <p className="text-sm text-muted-foreground">
                {isConfigured 
                  ? "Gateway configurado y listo para enviar" 
                  : "⚠️ Gateway no configurado (emails no se enviarán)"}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Actualizar
          </Button>
        </div>

        {healthLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verificando configuración...
          </div>
        ) : emailGateway && (
          <div className="grid gap-2">
            <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded text-sm">
              <span className="font-mono">EMAIL_GATEWAY_BASE_URL</span>
              {emailGateway.base_url_set ? (
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
            <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded text-sm">
              <span className="font-mono">EMAIL_GATEWAY_API_KEY</span>
              {emailGateway.api_key_set ? (
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
            <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded text-sm">
              <span className="font-mono">EMAIL_FROM_ADDRESS</span>
              {emailGateway.from_address_set ? (
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
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1">
          <FileText className="h-3 w-3" />
          Documentación: <code className="bg-muted px-1 rounded">docs/runbook-email-gateway.md</code>
        </p>
      </div>

      <Separator />

      {/* Email Stats */}
      <div className="space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Send className="h-4 w-4" />
          Estado de Cola de Emails
        </h3>

        {statsLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando estadísticas...
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <div className="text-2xl font-bold text-amber-600">{emailStats?.pending || 0}</div>
              <div className="text-xs text-muted-foreground">Pendientes</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <div className="text-2xl font-bold text-emerald-600">{emailStats?.sentToday || 0}</div>
              <div className="text-xs text-muted-foreground">Enviados Hoy</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <div className="text-2xl font-bold text-destructive">{emailStats?.failedToday || 0}</div>
              <div className="text-xs text-muted-foreground">Fallidos Hoy</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <div className="text-2xl font-bold text-primary">{emailStats?.total || 0}</div>
              <div className="text-xs text-muted-foreground">Total en Cola</div>
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Recent Emails */}
      <div className="space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Emails Recientes
        </h3>

        <ScrollArea className="h-64 border rounded-lg">
          {emailsLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : recentEmails?.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Sin emails en cola</p>
          ) : (
            <div className="p-2 space-y-2">
              {recentEmails?.map((email) => (
                <div 
                  key={email.id} 
                  className="p-3 bg-muted/50 rounded text-sm space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(email.status)}
                      <span className="font-medium truncate max-w-[200px]">
                        {email.subject || 'Sin asunto'}
                      </span>
                      {getStatusBadge(email.status)}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(email.created_at), { addSuffix: true, locale: es })}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ID: {email.id.slice(0, 8)}...
                  </div>
                  {email.error && (
                    <p className="text-xs text-destructive truncate">{email.error}</p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Attempts: {email.attempts || 0}</span>
                    {email.sent_at && (
                      <span>Sent: {new Date(email.sent_at).toLocaleString()}</span>
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
