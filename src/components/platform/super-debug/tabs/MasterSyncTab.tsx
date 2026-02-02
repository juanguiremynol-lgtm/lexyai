/**
 * Master Sync Tab - Super Admin only, sync all work items for a user
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  Zap, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Search,
  User,
  Building,
  Clock,
  Download,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface UserInfo {
  id: string;
  email: string;
  full_name?: string;
  organization_id: string;
  organization_name?: string;
  work_item_count: number;
}

interface MasterSyncResult {
  ok: boolean;
  run_id: string;
  target_user_id: string;
  target_organization_id: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  work_items_total: number;
  work_items_processed: number;
  work_items_success: number;
  work_items_error: number;
  actuaciones_found: number;
  actuaciones_inserted: number;
  actuaciones_skipped: number;
  publicaciones_found: number;
  publicaciones_inserted: number;
  publicaciones_skipped: number;
  alerts_created: number;
  errors: Array<{
    work_item_id: string;
    radicado: string;
    provider: string;
    error: string;
  }>;
}

export function MasterSyncTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [includeCpnu, setIncludeCpnu] = useState(true);
  const [includeSamai, setIncludeSamai] = useState(true);
  const [includePublicaciones, setIncludePublicaciones] = useState(true);
  const [includeTutelas, setIncludeTutelas] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [syncResult, setSyncResult] = useState<MasterSyncResult | null>(null);

  // Fetch users for selection
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['super-debug-users', searchQuery],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, full_name, organization_id')
        .not('organization_id', 'is', null)
        .limit(20);

      if (error) throw error;

      const userInfos: UserInfo[] = [];
      for (const profile of profiles || []) {
        const { data: org } = await supabase
          .from('organizations')
          .select('name')
          .eq('id', profile.organization_id!)
          .single();

        // Cast to any to avoid TypeScript deep instantiation issues with Supabase types
        const { count } = await (supabase.from('work_items') as any)
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', profile.organization_id!)
          .eq('is_archived', false);

        userInfos.push({
          id: profile.id,
          email: profile.full_name || profile.id.slice(0, 8),
          full_name: profile.full_name || undefined,
          organization_id: profile.organization_id!,
          organization_name: org?.name,
          work_item_count: count || 0,
        });
      }

      return userInfos;
    },
  });

  // Master sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error('No user selected');

      const { data, error } = await supabase.functions.invoke<MasterSyncResult>(
        'master-sync',
        {
          body: {
            target_user_id: selectedUser.id,
            target_organization_id: selectedUser.organization_id,
            include_cpnu: includeCpnu,
            include_samai: includeSamai,
            include_publicaciones: includePublicaciones,
            include_tutelas: includeTutelas,
          },
        }
      );

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setSyncResult(data);
      setShowConfirmDialog(false);
      if (data?.work_items_error === 0) {
        toast.success(`Master Sync completado: ${data.work_items_success} work items sincronizados`);
      } else {
        toast.warning(`Master Sync completado con ${data?.work_items_error} errores`);
      }
    },
    onError: (err) => {
      setShowConfirmDialog(false);
      toast.error(err instanceof Error ? err.message : 'Error ejecutando Master Sync');
    },
  });

  const handleConfirmSync = () => {
    syncMutation.mutate();
  };

  const downloadReport = () => {
    if (syncResult) {
      const blob = new Blob([JSON.stringify(syncResult, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `master-sync-${syncResult.run_id}.json`;
      a.click();
    }
  };

  const estimatedTime = selectedUser 
    ? Math.ceil((selectedUser.work_item_count * 3 * 5) / 60) // ~5 seconds per API call, 3 APIs per item
    : 0;

  return (
    <div className="space-y-6">
      {/* Warning Banner */}
      <Alert className="border-amber-500/50 bg-amber-500/10">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-700">Solo Super Administradores</AlertTitle>
        <AlertDescription className="text-amber-600">
          Esta función sincroniza TODOS los work items de un usuario contra TODAS las APIs externas.
          Úsela con precaución.
        </AlertDescription>
      </Alert>

      {/* User Selection */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar usuario por email o nombre..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md"
          />
        </div>

        <ScrollArea className="h-48 border rounded-lg">
          {usersLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : users?.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No se encontraron usuarios
            </p>
          ) : (
            <div className="p-2 space-y-1">
              {users?.map((user) => (
                <div
                  key={user.id}
                  onClick={() => setSelectedUser(user)}
                  className={cn(
                    "p-3 rounded-lg cursor-pointer transition-colors",
                    selectedUser?.id === user.id
                      ? "bg-primary/10 border border-primary/30"
                      : "bg-muted/50 hover:bg-muted"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-4 h-4 rounded-full border-2",
                        selectedUser?.id === user.id
                          ? "border-primary bg-primary"
                          : "border-muted-foreground"
                      )} />
                      <div>
                        <div className="flex items-center gap-2">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">
                            {user.full_name || user.email}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Building className="h-3 w-3" />
                          <span>{user.organization_name || 'Sin organización'}</span>
                          <span>•</span>
                          <span>{user.work_item_count} work items</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Selected User Info */}
      {selectedUser && (
        <div className="p-4 rounded-lg border bg-muted/30 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-muted-foreground">Usuario seleccionado</Label>
              <p className="font-medium">{selectedUser.full_name || selectedUser.email}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Organización</Label>
              <p className="font-medium">{selectedUser.organization_name}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Work Items</Label>
              <p className="font-medium">{selectedUser.work_item_count}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Tiempo estimado</Label>
              <p className="font-medium">{estimatedTime}-{estimatedTime * 2} minutos</p>
            </div>
          </div>

          {/* API Selection */}
          <div className="space-y-2">
            <Label>APIs a sincronizar</Label>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="cpnu" 
                  checked={includeCpnu} 
                  onCheckedChange={(c) => setIncludeCpnu(!!c)} 
                />
                <label htmlFor="cpnu" className="text-sm">CPNU (CGP, Penal, Laboral, Tutela)</label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="samai" 
                  checked={includeSamai} 
                  onCheckedChange={(c) => setIncludeSamai(!!c)} 
                />
                <label htmlFor="samai" className="text-sm">SAMAI (CPACA)</label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="publicaciones" 
                  checked={includePublicaciones} 
                  onCheckedChange={(c) => setIncludePublicaciones(!!c)} 
                />
                <label htmlFor="publicaciones" className="text-sm">Publicaciones Procesales</label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="tutelas" 
                  checked={includeTutelas} 
                  onCheckedChange={(c) => setIncludeTutelas(!!c)} 
                />
                <label htmlFor="tutelas" className="text-sm text-muted-foreground">
                  Tutelas (opcional - muy lento)
                </label>
              </div>
            </div>
          </div>

          <Button
            onClick={() => setShowConfirmDialog(true)}
            disabled={syncMutation.isPending || selectedUser.work_item_count === 0}
            className="w-full"
          >
            {syncMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            Ejecutar Master Sync
          </Button>
        </div>
      )}

      {/* Progress/Results */}
      {syncMutation.isPending && (
        <div className="p-4 rounded-lg border bg-primary/5 space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="font-medium">Master Sync en Progreso</p>
              <p className="text-sm text-muted-foreground">
                Sincronizando {selectedUser?.work_item_count} work items...
              </p>
            </div>
          </div>
          <Progress value={50} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            Esto puede tomar varios minutos. No cierre esta página.
          </p>
        </div>
      )}

      {/* Results */}
      {syncResult && !syncMutation.isPending && (
        <div className={cn(
          "rounded-lg border p-4 space-y-4",
          syncResult.work_items_error === 0 
            ? "bg-emerald-500/5 border-emerald-500/30" 
            : "bg-amber-500/5 border-amber-500/30"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {syncResult.work_items_error === 0 ? (
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-amber-600" />
              )}
              <div>
                <p className="font-medium">Master Sync Completado</p>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Duración: {Math.round((syncResult.duration_ms || 0) / 1000 / 60)}m {Math.round((syncResult.duration_ms || 0) / 1000 % 60)}s
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={downloadReport}>
              <Download className="h-4 w-4 mr-1" />
              Descargar Reporte
            </Button>
          </div>

          {/* Summary Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <div className="text-xl font-bold text-primary">
                {syncResult.work_items_processed}/{syncResult.work_items_total}
              </div>
              <div className="text-xs text-muted-foreground">Work Items</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <div className="text-xl font-bold text-emerald-600">{syncResult.work_items_success}</div>
              <div className="text-xs text-muted-foreground">Exitosos</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <div className="text-xl font-bold text-destructive">{syncResult.work_items_error}</div>
              <div className="text-xs text-muted-foreground">Con Errores</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <div className="text-xl font-bold text-blue-600">{syncResult.alerts_created}</div>
              <div className="text-xs text-muted-foreground">Alertas</div>
            </div>
          </div>

          {/* Actuaciones/Publicaciones breakdown */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="p-3 rounded-lg bg-muted/30">
              <h4 className="font-medium mb-2">Actuaciones (CPNU + SAMAI)</h4>
              <div className="space-y-1 text-muted-foreground">
                <p>Total encontradas: {syncResult.actuaciones_found}</p>
                <p className="text-emerald-600">Nuevas: {syncResult.actuaciones_inserted}</p>
                <p>Ya existentes: {syncResult.actuaciones_skipped}</p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <h4 className="font-medium mb-2">Publicaciones</h4>
              <div className="space-y-1 text-muted-foreground">
                <p>Total encontradas: {syncResult.publicaciones_found}</p>
                <p className="text-emerald-600">Nuevas: {syncResult.publicaciones_inserted}</p>
                <p>Ya existentes: {syncResult.publicaciones_skipped}</p>
              </div>
            </div>
          </div>

          {/* Errors */}
          {syncResult.errors.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-destructive">
                Errores ({syncResult.errors.length})
              </h4>
              <ScrollArea className="h-32 border border-destructive/30 rounded-lg">
                <div className="p-2 space-y-1">
                  {syncResult.errors.map((err, i) => (
                    <div key={i} className="p-2 bg-destructive/10 rounded text-sm">
                      <span className="font-mono">{err.radicado}</span>
                      <span className="text-muted-foreground"> ({err.provider})</span>
                      <p className="text-destructive text-xs">{err.error}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <Button 
            variant="outline" 
            onClick={() => {
              setSyncResult(null);
              setSelectedUser(null);
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Ejecutar Otro Master Sync
          </Button>
        </div>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Master Sync</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Está a punto de sincronizar:</p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Usuario:</strong> {selectedUser?.full_name || selectedUser?.email}</li>
                <li><strong>Work Items:</strong> {selectedUser?.work_item_count}</li>
                <li><strong>APIs:</strong> {[
                  includeCpnu && 'CPNU',
                  includeSamai && 'SAMAI',
                  includePublicaciones && 'Publicaciones',
                  includeTutelas && 'Tutelas',
                ].filter(Boolean).join(', ')}</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-4">
                Esto ejecutará hasta {selectedUser?.work_item_count ? selectedUser.work_item_count * 3 : 0} llamadas a APIs externas.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSync}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Confirmar y Ejecutar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
