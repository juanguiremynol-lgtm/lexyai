/**
 * Global Master Sync — Platform Console button that syncs ALL work items
 * across ALL organizations. Exclusive to super admin as manual override.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, Loader2, AlertTriangle, CheckCircle, XCircle, Globe } from "lucide-react";
import { toast } from "sonner";

const SYNC_WORKFLOWS: string[] = ['CGP', 'LABORAL', 'CPACA', 'TUTELA', 'PENAL_906'];
const TERMINAL_STAGES = [
  'ARCHIVADO', 'FINALIZADO', 'EJECUTORIADO',
  'PRECLUIDO_ARCHIVADO', 'FINALIZADO_ABSUELTO', 'FINALIZADO_CONDENADO'
];

interface SyncProgress {
  phase: 'idle' | 'loading' | 'syncing' | 'done';
  totalOrgs: number;
  currentOrg: number;
  currentOrgName: string;
  totalItems: number;
  completedItems: number;
  successItems: number;
  errorItems: number;
  skippedItems: number;
}

export function GlobalMasterSyncButton() {
  const [progress, setProgress] = useState<SyncProgress>({
    phase: 'idle', totalOrgs: 0, currentOrg: 0, currentOrgName: '',
    totalItems: 0, completedItems: 0, successItems: 0, errorItems: 0, skippedItems: 0,
  });

  const runGlobalSync = useCallback(async () => {
    if (progress.phase === 'syncing' || progress.phase === 'loading') return;

    setProgress(p => ({ ...p, phase: 'loading' }));

    try {
      // 1. Get ALL organizations
      const { data: orgs, error: orgError } = await supabase
        .from("organizations")
        .select("id, name")
        .order("name");

      if (orgError) throw orgError;
      if (!orgs || orgs.length === 0) {
        toast.info("No hay organizaciones para sincronizar");
        setProgress(p => ({ ...p, phase: 'idle' }));
        return;
      }

      // 2. Get ALL eligible work items across all orgs
      const { data: allItems, error: itemsError } = await (supabase
        .from("work_items") as any)
        .select("id, workflow_type, radicado, stage, total_actuaciones, organization_id")
        .eq("monitoring_enabled", true)
        .in("workflow_type", SYNC_WORKFLOWS)
        .not("radicado", "is", null)
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .limit(5000);

      if (itemsError) throw itemsError;

      const eligible = (allItems || []).filter(item =>
        item.radicado &&
        item.radicado.replace(/\D/g, '').length === 23 &&
        !TERMINAL_STAGES.includes(item.stage)
      );

      if (eligible.length === 0) {
        toast.info("No hay asuntos elegibles para sincronización global");
        setProgress(p => ({ ...p, phase: 'idle' }));
        return;
      }

      // Group by org
      const byOrg = new Map<string, typeof eligible>();
      for (const item of eligible) {
        const orgId = item.organization_id;
        if (!byOrg.has(orgId)) byOrg.set(orgId, []);
        byOrg.get(orgId)!.push(item);
      }

      const orgEntries = Array.from(byOrg.entries());
      const orgNameMap = new Map(orgs.map(o => [o.id, o.name]));

      setProgress({
        phase: 'syncing',
        totalOrgs: orgEntries.length,
        currentOrg: 0,
        currentOrgName: '',
        totalItems: eligible.length,
        completedItems: 0,
        successItems: 0,
        errorItems: 0,
        skippedItems: 0,
      });

      toast.info(`Sincronización global iniciada: ${eligible.length} asuntos en ${orgEntries.length} organizaciones`);

      let globalSuccess = 0;
      let globalErrors = 0;

      for (let orgIdx = 0; orgIdx < orgEntries.length; orgIdx++) {
        const [orgId, items] = orgEntries[orgIdx];
        const orgName = orgNameMap.get(orgId) || orgId.slice(0, 8);

        setProgress(p => ({
          ...p,
          currentOrg: orgIdx + 1,
          currentOrgName: orgName,
        }));

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          try {
            const [actsResult, pubsResult] = await Promise.allSettled([
              supabase.functions.invoke("sync-by-work-item", {
                body: { work_item_id: item.id, _scheduled: true },
              }),
              supabase.functions.invoke("sync-publicaciones-by-work-item", {
                body: { work_item_id: item.id, _scheduled: true },
              }),
            ]);

            const actOk = actsResult.status === "fulfilled" && actsResult.value.data?.ok;
            const pubOk = pubsResult.status === "fulfilled" && pubsResult.value.data?.ok;

            if (actOk || pubOk) globalSuccess++;
            else globalErrors++;
          } catch {
            globalErrors++;
          }

          setProgress(p => ({
            ...p,
            completedItems: p.completedItems + 1,
            successItems: globalSuccess,
            errorItems: globalErrors,
          }));

          // Rate limiting
          if (i < items.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      setProgress(p => ({ ...p, phase: 'done' }));

      toast.success(`Sincronización global completada: ${globalSuccess} exitosos, ${globalErrors} errores de ${eligible.length} asuntos`);
    } catch (err: any) {
      console.error("[GlobalMasterSync] Error:", err);
      setProgress(p => ({ ...p, phase: 'idle' }));
      toast.error("Error en sincronización global: " + (err?.message || "desconocido"));
    }
  }, [progress.phase]);

  const pct = progress.totalItems > 0 ? Math.round((progress.completedItems / progress.totalItems) * 100) : 0;

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-destructive" />
          <div>
            <CardTitle className="text-base">Sincronización Global (Override Manual)</CardTitle>
            <CardDescription className="text-xs">
              Sincroniza TODOS los asuntos de TODAS las organizaciones via proveedores API externos. Solo super admin.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {progress.phase === 'idle' && (
          <div className="space-y-3">
            <div className="p-3 rounded-md border border-destructive/20 bg-destructive/5 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                Acción de alto impacto
              </div>
              <p className="text-muted-foreground">
                Esto sincronizará todos los asuntos de todos los usuarios y organizaciones 
                usando los proveedores API externos (CPNU, SAMAI, Publicaciones Procesales, etc.). 
                Use solo como override manual cuando el cron diario o la autonomía no sean suficientes.
              </p>
            </div>
            <Button onClick={runGlobalSync} variant="destructive" size="sm">
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Ejecutar Sincronización Global
            </Button>
          </div>
        )}

        {progress.phase === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando organizaciones y asuntos...
          </div>
        )}

        {progress.phase === 'syncing' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-destructive" />
                Org {progress.currentOrg}/{progress.totalOrgs}: {progress.currentOrgName}
              </span>
              <span className="tabular-nums">{progress.completedItems}/{progress.totalItems} ({pct}%)</span>
            </div>
            <Progress value={pct} className="h-2" />
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-500" /> {progress.successItems}
              </span>
              <span className="flex items-center gap-1">
                <XCircle className="h-3 w-3 text-destructive" /> {progress.errorItems}
              </span>
            </div>
          </div>
        )}

        {progress.phase === 'done' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Sincronización global completada</span>
            </div>
            <div className="flex gap-3 text-xs">
              <Badge variant="outline" className="text-green-600">✓ {progress.successItems} exitosos</Badge>
              {progress.errorItems > 0 && (
                <Badge variant="destructive">✗ {progress.errorItems} errores</Badge>
              )}
              <Badge variant="secondary">{progress.totalItems} total</Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setProgress(p => ({ ...p, phase: 'idle', completedItems: 0, successItems: 0, errorItems: 0 }))}
            >
              Reiniciar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}