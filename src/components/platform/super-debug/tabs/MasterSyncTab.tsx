/**
 * Master Sync Tab - Super Admin only, sync all work items for an organization
 * 
 * Uses admin edge functions that bypass RLS for accurate diagnostics.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Zap, 
  Loader2, 
  CheckCircle2, 
  AlertTriangle,
  Search,
  Building,
  Clock,
  Download,
  RefreshCw,
  User,
  Database,
  Wrench,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface TenantSnapshot {
  resolved_user: {
    id: string;
    full_name: string | null;
    email: string | null;
    organization_id: string | null;
  } | null;
  user_memberships: Array<{
    organization_id: string;
    role: string;
    organization_name: string | null;
  }>;
  resolved_organization: {
    id: string;
    name: string;
    metadata: Record<string, unknown> | null;
  } | null;
  counts: {
    work_items_by_owner: number;
    work_items_by_org: number;
    orphaned_work_items: number;
    work_items_distinct_orgs: string[];
  };
  work_items_sample: Array<{
    id: string;
    title: string | null;
    radicado: string | null;
    workflow_type: string | null;
    status: string | null;
    owner_id: string;
    organization_id: string | null;
    created_at: string;
  }>;
  system_hints: string[];
  debug_info: {
    query_user_id: string | null;
    query_org_id: string | null;
    timestamp: string;
  };
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

interface BackfillResult {
  ok: boolean;
  dry_run: boolean;
  target_user_id: string | null;
  target_org_id: string | null;
  rows_matched: number;
  rows_updated: number;
  sample_updated_ids: string[];
  error?: string;
}

export function MasterSyncTab() {
  const queryClient = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [includeCpnu, setIncludeCpnu] = useState(true);
  const [includeSamai, setIncludeSamai] = useState(true);
  const [includePublicaciones, setIncludePublicaciones] = useState(true);
  const [includeTutelas, setIncludeTutelas] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showBackfillDialog, setShowBackfillDialog] = useState(false);
  const [syncResult, setSyncResult] = useState<MasterSyncResult | null>(null);

  // Fetch all organizations
  const { data: organizations, isLoading: orgsLoading } = useQuery({
    queryKey: ['super-debug-organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, created_by')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch users for selector
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['super-debug-users', userSearchQuery],
    queryFn: async () => {
      let query = supabase
        .from('profiles')
        .select('id, full_name, organization_id')
        .order('full_name');
      
      if (userSearchQuery) {
        query = query.ilike('full_name', `%${userSearchQuery}%`);
      }
      
      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch tenant snapshot using admin edge function
  const { 
    data: tenantSnapshot, 
    isLoading: snapshotLoading,
    refetch: refetchSnapshot,
  } = useQuery({
    queryKey: ['tenant-snapshot', selectedOrgId, selectedUserId],
    queryFn: async () => {
      if (!selectedOrgId && !selectedUserId) return null;

      const { data, error } = await supabase.functions.invoke<TenantSnapshot>(
        'debug-tenant-snapshot',
        {
          body: {
            org_id: selectedOrgId,
            user_id: selectedUserId,
          },
        }
      );

      if (error) throw error;
      return data;
    },
    enabled: !!(selectedOrgId || selectedUserId),
  });

  // Backfill mutation (dry run first)
  const backfillMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      if (!selectedUserId && !selectedOrgId) {
        throw new Error('Select a user or organization first');
      }

      const { data, error } = await supabase.functions.invoke<BackfillResult>(
        'admin-backfill-work-items-org',
        {
          body: {
            user_id: selectedUserId,
            org_id: selectedOrgId,
            dry_run: dryRun,
          },
        }
      );

      if (error) throw error;
      return data;
    },
    onSuccess: (data, dryRun) => {
      if (dryRun) {
        if (data?.rows_matched === 0) {
          toast.info('No orphaned work items found to backfill');
          setShowBackfillDialog(false);
        }
        // If rows found, dialog stays open for confirmation
      } else {
        toast.success(`Backfilled ${data?.rows_updated} work items`);
        setShowBackfillDialog(false);
        refetchSnapshot();
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Backfill failed');
    },
  });

  // Master sync mutation - supports ORG-ONLY mode (user is optional)
  const syncMutation = useMutation({
    mutationFn: async () => {
      // ORG-only mode: only org_id is required
      const orgId = selectedOrgId || tenantSnapshot?.resolved_organization?.id;
      
      if (!orgId) {
        throw new Error('Selecciona una organización para ejecutar Master Sync');
      }

      // User is OPTIONAL - convert "__NONE__" sentinel to null
      const userId = selectedUserId === '__NONE__' ? null : selectedUserId;

      const { data, error } = await supabase.functions.invoke<MasterSyncResult>(
        'master-sync',
        {
          body: {
            target_organization_id: orgId,
            target_user_id: userId, // Can be null for org-wide sync
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

  // Auto-select first org if none selected
  useEffect(() => {
    if (organizations?.length && !selectedOrgId) {
      setSelectedOrgId(organizations[0].id);
    }
  }, [organizations, selectedOrgId]);

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

  const workItemCount = tenantSnapshot?.counts.work_items_by_org || 0;
  const orphanedCount = tenantSnapshot?.counts.orphaned_work_items || 0;
  const estimatedTime = workItemCount 
    ? Math.ceil((workItemCount * 3 * 5) / 60) 
    : 0;

  return (
    <div className="space-y-6">
      {/* Warning Banner */}
      <Alert className="border-amber-500/50 bg-amber-500/10">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-700">Solo Super Administradores</AlertTitle>
        <AlertDescription className="text-amber-600">
          Esta función sincroniza TODOS los work items de una organización contra TODAS las APIs externas.
          Los conteos usan funciones administrativas que bypasean RLS para diagnóstico preciso.
        </AlertDescription>
      </Alert>

      {/* Selectors Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Organization Selector */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Building className="h-4 w-4" />
            Organización
          </Label>
          <Select
            value={selectedOrgId ?? undefined}
            onValueChange={(val) => {
              setSelectedOrgId(val === '__NONE__' ? null : val);
              setSelectedUserId(null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar organización..." />
            </SelectTrigger>
            <SelectContent>
              {orgsLoading ? (
                <div className="p-2 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Cargando...
                </div>
              ) : (
                organizations?.filter(org => org?.id && org.id.trim() !== '').map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* User Selector */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Usuario (opcional)
          </Label>
          <div className="space-y-2">
            <Input
              placeholder="Buscar usuario..."
              value={userSearchQuery}
              onChange={(e) => setUserSearchQuery(e.target.value)}
              className="h-9"
            />
            <Select
              value={selectedUserId ?? undefined}
              onValueChange={(val) => setSelectedUserId(val === '__NONE__' ? null : val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar usuario..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__NONE__">Ninguno (solo org)</SelectItem>
                {usersLoading ? (
                  <div className="p-2 text-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    Cargando...
                  </div>
                ) : (
                  users?.filter(user => user?.id && user.id.trim() !== '').map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name || 'Sin nombre'} 
                      {user.organization_id ? '' : ' (sin org)'}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Tenant Snapshot Panel */}
      {snapshotLoading ? (
        <div className="p-6 border rounded-lg bg-muted/30 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin mr-3" />
          <span>Cargando diagnóstico...</span>
        </div>
      ) : tenantSnapshot ? (
        <div className="space-y-4">
          {/* System Hints (Warnings) */}
          {tenantSnapshot.system_hints.length > 0 && (
            <div className="space-y-2">
              {tenantSnapshot.system_hints.map((hint, i) => (
                <Alert key={i} className="border-amber-500/50 bg-amber-500/10">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-700">{hint}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}

          {/* Counts Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg border bg-muted/30 text-center">
              <div className="text-2xl font-bold text-primary">
                {tenantSnapshot.counts.work_items_by_org}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Building className="h-3 w-3" />
                Work Items (por Org)
              </div>
            </div>
            <div className="p-4 rounded-lg border bg-muted/30 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {tenantSnapshot.counts.work_items_by_owner}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <User className="h-3 w-3" />
                Work Items (por Owner)
              </div>
            </div>
            <div className={cn(
              "p-4 rounded-lg border text-center",
              orphanedCount > 0 ? "bg-red-500/10 border-red-500/50" : "bg-muted/30"
            )}>
              <div className={cn(
                "text-2xl font-bold",
                orphanedCount > 0 ? "text-red-600" : "text-muted-foreground"
              )}>
                {orphanedCount}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Huérfanos (NULL org)
              </div>
            </div>
            <div className="p-4 rounded-lg border bg-muted/30 text-center">
              <div className="text-2xl font-bold text-muted-foreground">
                {tenantSnapshot.counts.work_items_distinct_orgs.length}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Database className="h-3 w-3" />
                Orgs Distintas
              </div>
            </div>
          </div>

          {/* Info Panel */}
          <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              {tenantSnapshot.resolved_organization && (
                <div>
                  <Label className="text-muted-foreground">Organización</Label>
                  <p className="font-medium flex items-center gap-2">
                    <Building className="h-4 w-4" />
                    {tenantSnapshot.resolved_organization.name}
                  </p>
                </div>
              )}
              {tenantSnapshot.resolved_user && (
                <div>
                  <Label className="text-muted-foreground">Usuario</Label>
                  <p className="font-medium flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {tenantSnapshot.resolved_user.full_name || tenantSnapshot.resolved_user.email || 'N/A'}
                  </p>
                </div>
              )}
              <div>
                <Label className="text-muted-foreground">Tiempo estimado sync</Label>
                <p className="font-medium">{estimatedTime}-{estimatedTime * 2} minutos</p>
              </div>
              {tenantSnapshot.user_memberships.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Membresías</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {tenantSnapshot.user_memberships.map((m, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {m.organization_name || m.organization_id.slice(0, 8)} ({m.role})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* API Selection */}
            <div className="space-y-2 pt-2 border-t">
              <Label>APIs a sincronizar</Label>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="cpnu" 
                    checked={includeCpnu} 
                    onCheckedChange={(c) => setIncludeCpnu(!!c)} 
                  />
                  <label htmlFor="cpnu" className="text-sm">CPNU</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="samai" 
                    checked={includeSamai} 
                    onCheckedChange={(c) => setIncludeSamai(!!c)} 
                  />
                  <label htmlFor="samai" className="text-sm">SAMAI</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="publicaciones" 
                    checked={includePublicaciones} 
                    onCheckedChange={(c) => setIncludePublicaciones(!!c)} 
                  />
                  <label htmlFor="publicaciones" className="text-sm">Publicaciones</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="tutelas" 
                    checked={includeTutelas} 
                    onCheckedChange={(c) => setIncludeTutelas(!!c)} 
                  />
                  <label htmlFor="tutelas" className="text-sm text-muted-foreground">
                    Tutelas (lento)
                  </label>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                onClick={() => setShowConfirmDialog(true)}
                disabled={syncMutation.isPending || workItemCount === 0}
                className="flex-1"
              >
                {syncMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                Ejecutar Master Sync ({workItemCount} items)
              </Button>
              
              {orphanedCount > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    backfillMutation.mutate(true); // Start with dry run
                    setShowBackfillDialog(true);
                  }}
                  disabled={backfillMutation.isPending}
                  className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10"
                >
                  <Wrench className="h-4 w-4 mr-2" />
                  Backfill Org ID ({orphanedCount})
                </Button>
              )}
              
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetchSnapshot()}
                disabled={snapshotLoading}
              >
                <RefreshCw className={cn("h-4 w-4", snapshotLoading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Sample Work Items Table */}
          {tenantSnapshot.work_items_sample.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                Muestra de Work Items (últimos 20)
              </Label>
              <div className="border rounded-lg overflow-hidden">
                <ScrollArea className="h-64">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Radicado</TableHead>
                        <TableHead>Título</TableHead>
                        <TableHead className="w-[100px]">Org ID</TableHead>
                        <TableHead className="w-[80px]">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tenantSnapshot.work_items_sample.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-xs">
                            {item.radicado?.slice(-10) || 'N/A'}
                          </TableCell>
                          <TableCell className="text-sm truncate max-w-[200px]">
                            {item.title || 'Sin título'}
                          </TableCell>
                          <TableCell className={cn(
                            "font-mono text-xs",
                            !item.organization_id && "text-red-600"
                          )}>
                            {item.organization_id?.slice(0, 8) || 'NULL'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {item.status || 'N/A'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>
      ) : (selectedOrgId || selectedUserId) ? (
        <div className="p-6 border rounded-lg bg-muted/30 text-center text-muted-foreground">
          <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Selecciona una organización o usuario para ver diagnósticos</p>
        </div>
      ) : null}

      {/* Progress/Results */}
      {syncMutation.isPending && (
        <div className="p-4 rounded-lg border bg-primary/5 space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="font-medium">Master Sync en Progreso</p>
              <p className="text-sm text-muted-foreground">
                Sincronizando {workItemCount} work items...
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
              <h4 className="font-medium mb-2">Actuaciones</h4>
              <div className="space-y-1 text-muted-foreground">
                <p>Encontradas: {syncResult.actuaciones_found}</p>
                <p className="text-emerald-600">Nuevas: {syncResult.actuaciones_inserted}</p>
                <p>Existentes: {syncResult.actuaciones_skipped}</p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <h4 className="font-medium mb-2">Publicaciones</h4>
              <div className="space-y-1 text-muted-foreground">
                <p>Encontradas: {syncResult.publicaciones_found}</p>
                <p className="text-emerald-600">Nuevas: {syncResult.publicaciones_inserted}</p>
                <p>Existentes: {syncResult.publicaciones_skipped}</p>
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
              refetchSnapshot();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Ejecutar Otro Sync
          </Button>
        </div>
      )}

      {/* Sync Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Master Sync</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Está a punto de sincronizar:</p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Organización:</strong> {tenantSnapshot?.resolved_organization?.name || selectedOrgId}</li>
                <li><strong>Work Items:</strong> {workItemCount}</li>
                <li><strong>APIs:</strong> {[
                  includeCpnu && 'CPNU',
                  includeSamai && 'SAMAI',
                  includePublicaciones && 'Publicaciones',
                  includeTutelas && 'Tutelas',
                ].filter(Boolean).join(', ')}</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-4">
                Esto ejecutará hasta {workItemCount * 3} llamadas a APIs externas.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => syncMutation.mutate()}>
              <Zap className="h-4 w-4 mr-1" />
              Confirmar y Ejecutar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Backfill Confirmation Dialog */}
      <AlertDialog open={showBackfillDialog} onOpenChange={setShowBackfillDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Backfill Organization ID</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              {backfillMutation.isPending ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Analizando...</span>
                </div>
              ) : backfillMutation.data ? (
                <>
                  <p>
                    Se encontraron <strong>{backfillMutation.data.rows_matched}</strong> work items 
                    con organization_id = NULL.
                  </p>
                  <p>
                    Se actualizarán para usar organization_id = <code className="text-xs bg-muted px-1 py-0.5 rounded">
                      {backfillMutation.data.target_org_id?.slice(0, 8)}...
                    </code>
                  </p>
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Esta es una operación de migración de datos. Proceda con cuidado.
                    </AlertDescription>
                  </Alert>
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => backfillMutation.mutate(false)}
              disabled={!backfillMutation.data?.rows_matched || backfillMutation.isPending}
            >
              <Wrench className="h-4 w-4 mr-1" />
              Ejecutar Backfill ({backfillMutation.data?.rows_matched || 0} rows)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
