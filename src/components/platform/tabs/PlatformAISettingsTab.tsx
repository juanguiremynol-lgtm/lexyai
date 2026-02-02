/**
 * Platform AI Settings Tab
 * 
 * Super admin controls for AI-powered features like Daily Welcome Messages.
 * Includes kill switch, observability metrics, and audit log.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Bot, 
  Power, 
  PowerOff, 
  AlertTriangle, 
  Activity,
  Clock,
  Users,
  Shield,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface WelcomeLogEntry {
  id: string;
  user_id: string;
  organization_id: string | null;
  event_type: string;
  event_date: string;
  ai_model_used: string | null;
  activity_count: number | null;
  latency_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface WelcomeMetrics {
  total_generated: number;
  total_suppressed_already_sent: number;
  total_suppressed_kill_switch: number;
  total_suppressed_non_business_day: number;
  unique_users: number;
  avg_latency_ms: number | null;
}

export function PlatformAISettingsTab() {
  const queryClient = useQueryClient();
  const [isToggling, setIsToggling] = useState(false);

  // Fetch platform settings
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['platform-settings-ai'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('daily_welcome_enabled, updated_at')
        .eq('id', 'singleton')
        .single();
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch recent welcome logs (last 7 days)
  const { data: recentLogs, isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ['daily-welcome-logs'],
    queryFn: async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const { data, error } = await supabase
        .from('daily_welcome_log')
        .select('*')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return (data || []) as WelcomeLogEntry[];
    },
  });

  // Calculate metrics from logs
  const metrics: WelcomeMetrics = {
    total_generated: recentLogs?.filter(l => l.event_type === 'GENERATED').length || 0,
    total_suppressed_already_sent: recentLogs?.filter(l => l.event_type === 'SUPPRESSED_ALREADY_SENT').length || 0,
    total_suppressed_kill_switch: recentLogs?.filter(l => l.event_type === 'SUPPRESSED_KILL_SWITCH').length || 0,
    total_suppressed_non_business_day: recentLogs?.filter(l => l.event_type === 'SUPPRESSED_NON_BUSINESS_DAY').length || 0,
    unique_users: new Set(recentLogs?.filter(l => l.event_type === 'GENERATED').map(l => l.user_id) || []).size,
    avg_latency_ms: (() => {
      const latencies = recentLogs?.filter(l => l.latency_ms != null).map(l => l.latency_ms!) || [];
      return latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
    })(),
  };

  // Toggle mutation
  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('platform_settings')
        .update({ 
          daily_welcome_enabled: enabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'singleton');

      if (error) throw error;

      // Log to audit_logs
      await supabase.from('audit_logs').insert({
        organization_id: '00000000-0000-0000-0000-000000000000', // Platform-level action
        actor_user_id: user.id,
        actor_type: 'USER',
        action: enabled ? 'DAILY_WELCOME_ENABLED' : 'DAILY_WELCOME_DISABLED',
        entity_type: 'platform_settings',
        entity_id: 'singleton',
        metadata: {
          new_value: enabled,
          changed_by_email: user.email,
        },
      });

      return enabled;
    },
    onSuccess: (enabled) => {
      queryClient.invalidateQueries({ queryKey: ['platform-settings-ai'] });
      toast.success(
        enabled 
          ? 'Mensajes de bienvenida AI activados' 
          : 'Mensajes de bienvenida AI desactivados'
      );
    },
    onError: (error) => {
      console.error('Toggle error:', error);
      toast.error('Error al cambiar configuración');
    },
  });

  const handleToggle = async (enabled: boolean) => {
    setIsToggling(true);
    try {
      await toggleMutation.mutateAsync(enabled);
    } finally {
      setIsToggling(false);
    }
  };

  const isEnabled = settings?.daily_welcome_enabled === true;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-serif font-bold">Configuración de IA</h2>
          <p className="text-muted-foreground text-sm">
            Control de funciones con inteligencia artificial
          </p>
        </div>
      </div>

      {/* Kill Switch Card */}
      <Card className={isEnabled ? 'border-green-500/50' : 'border-destructive/50'}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isEnabled ? (
                <Power className="h-5 w-5 text-green-500" />
              ) : (
                <PowerOff className="h-5 w-5 text-destructive" />
              )}
              <div>
                <CardTitle className="text-lg">Mensaje de Bienvenida Diario (AI)</CardTitle>
                <CardDescription>
                  Genera un resumen personalizado usando Gemini al inicio de cada sesión
                </CardDescription>
              </div>
            </div>
            <Badge variant={isEnabled ? 'default' : 'destructive'}>
              {isEnabled ? 'ACTIVO' : 'DESACTIVADO'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Toggle */}
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div>
                <Label htmlFor="welcome-toggle" className="font-medium">
                  Habilitar generación de mensajes AI
                </Label>
                <p className="text-sm text-muted-foreground">
                  {isEnabled 
                    ? 'Los usuarios recibirán un mensaje AI al primer login del día' 
                    : 'Ningún usuario recibirá mensajes AI (ahorro de costos)'}
                </p>
              </div>
            </div>
            <Switch
              id="welcome-toggle"
              checked={isEnabled}
              onCheckedChange={handleToggle}
              disabled={settingsLoading || isToggling}
            />
          </div>

          {/* Warning when disabled */}
          {!isEnabled && (
            <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
              <div>
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  Kill Switch Activo
                </p>
                <p className="text-sm text-muted-foreground">
                  No se están realizando llamadas a Gemini. Los usuarios no verán mensajes de bienvenida AI.
                  Esto es útil durante pruebas para controlar costos.
                </p>
              </div>
            </div>
          )}

          {/* Last updated */}
          {settings?.updated_at && (
            <p className="text-xs text-muted-foreground">
              Última modificación: {format(new Date(settings.updated_at), "d 'de' MMMM 'a las' HH:mm", { locale: es })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Metrics Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-lg">Métricas (Últimos 7 días)</CardTitle>
                <CardDescription>
                  Observabilidad de uso y supresiones
                </CardDescription>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetchLogs()}
              disabled={logsLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${logsLoading ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Gemini Calls */}
            <div className="p-4 bg-green-500/10 rounded-lg text-center">
              <p className="text-2xl font-bold text-green-600">{metrics.total_generated}</p>
              <p className="text-sm text-muted-foreground">Mensajes Generados</p>
            </div>
            
            {/* Suppressed - Already Sent */}
            <div className="p-4 bg-blue-500/10 rounded-lg text-center">
              <p className="text-2xl font-bold text-blue-600">{metrics.total_suppressed_already_sent}</p>
              <p className="text-sm text-muted-foreground">Suprimidos (Ya Enviado)</p>
            </div>
            
            {/* Suppressed - Kill Switch */}
            <div className="p-4 bg-amber-500/10 rounded-lg text-center">
              <p className="text-2xl font-bold text-amber-600">{metrics.total_suppressed_kill_switch}</p>
              <p className="text-sm text-muted-foreground">Suprimidos (Kill Switch)</p>
            </div>
            
            {/* Suppressed - Non Business Day */}
            <div className="p-4 bg-gray-500/10 rounded-lg text-center">
              <p className="text-2xl font-bold text-gray-600">{metrics.total_suppressed_non_business_day}</p>
              <p className="text-sm text-muted-foreground">Suprimidos (No Hábil)</p>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="grid grid-cols-2 gap-4">
            {/* Unique Users */}
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">{metrics.unique_users}</p>
                <p className="text-xs text-muted-foreground">Usuarios únicos</p>
              </div>
            </div>
            
            {/* Avg Latency */}
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">
                  {metrics.avg_latency_ms != null ? `${metrics.avg_latency_ms}ms` : 'N/A'}
                </p>
                <p className="text-xs text-muted-foreground">Latencia promedio AI</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Registro de Actividad Reciente</CardTitle>
          <CardDescription>
            Últimos eventos de bienvenida diaria
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <p className="text-muted-foreground text-center py-4">Cargando...</p>
          ) : recentLogs && recentLogs.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {recentLogs.slice(0, 20).map((log) => (
                <div 
                  key={log.id}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg text-sm"
                >
                  <div className="flex items-center gap-3">
                    <Badge 
                      variant={
                        log.event_type === 'GENERATED' ? 'default' :
                        log.event_type === 'SUPPRESSED_KILL_SWITCH' ? 'destructive' :
                        'secondary'
                      }
                      className="text-xs"
                    >
                      {log.event_type === 'GENERATED' && '✓ Generado'}
                      {log.event_type === 'SUPPRESSED_ALREADY_SENT' && '↺ Ya enviado'}
                      {log.event_type === 'SUPPRESSED_KILL_SWITCH' && '⛔ Kill switch'}
                      {log.event_type === 'SUPPRESSED_NON_BUSINESS_DAY' && '📅 No hábil'}
                    </Badge>
                    <span className="text-muted-foreground font-mono text-xs">
                      {log.user_id.slice(0, 8)}...
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    {log.latency_ms && (
                      <span className="text-xs">{log.latency_ms}ms</span>
                    )}
                    <span className="text-xs">
                      {format(new Date(log.created_at), 'dd/MM HH:mm')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              No hay registros en los últimos 7 días
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
