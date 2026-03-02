/**
 * Never-Synced Items Panel — Shows work items with monitoring_enabled but last_synced_at IS NULL.
 * Allows admins to trigger on-demand sync attempts.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, RefreshCw, Play, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

interface NeverSyncedItem {
  id: string;
  radicado: string | null;
  title: string | null;
  workflow_type: string | null;
  created_at: string;
  last_error_code: string | null;
  last_error_at: string | null;
  organization_id: string | null;
  monitoring_enabled: boolean;
}

export function NeverSyncedItemsPanel() {
  const queryClient = useQueryClient();
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());

  const { data: items, isLoading, refetch } = useQuery({
    queryKey: ["never-synced-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select("id, radicado, title, workflow_type, created_at, last_error_code, last_error_at, organization_id, monitoring_enabled")
        .eq("monitoring_enabled", true)
        .is("last_synced_at", null)
        .is("deleted_at", null)
        .not("radicado", "is", null)
        .order("created_at", { ascending: true })
        .limit(50);

      if (error) throw error;
      return data as NeverSyncedItem[];
    },
    refetchInterval: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: async (item: NeverSyncedItem) => {
      setSyncingIds(prev => new Set(prev).add(item.id));
      try {
        const { data, error } = await supabase.functions.invoke("sync-by-work-item", {
          body: { work_item_id: item.id, force_refresh: true, _scheduled: false },
        });
        if (error) throw error;
        return { item, result: data };
      } finally {
        setSyncingIds(prev => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    onSuccess: ({ item, result }) => {
      const ok = result?.ok === true;
      if (ok) {
        toast.success(`✅ Sync exitoso para ${item.radicado}`);
      } else {
        toast.warning(`⚠️ Sync parcial para ${item.radicado}: ${result?.code || result?.message || "sin datos"}`);
      }
      queryClient.invalidateQueries({ queryKey: ["never-synced-items"] });
    },
    onError: (err, item) => {
      toast.error(`❌ Error al sincronizar ${item.radicado}: ${String(err)}`);
    },
  });

  const syncAll = async () => {
    if (!items || items.length === 0) return;
    toast.info(`Iniciando sync de ${items.length} items...`);
    for (const item of items.slice(0, 10)) {
      syncMutation.mutate(item);
      await new Promise(r => setTimeout(r, 1000)); // Rate limit
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Items Sin Sincronizar ({items?.length ?? 0})
            </CardTitle>
            <CardDescription>
              Work items con monitoreo activo que nunca han sido sincronizados
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Actualizar
            </Button>
            {items && items.length > 0 && (
              <Button size="sm" onClick={syncAll} disabled={syncingIds.size > 0}>
                <Play className="h-4 w-4 mr-1" /> Sync Todos (máx 10)
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando...</div>
        ) : !items || items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            ✅ No hay items sin sincronizar
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {items.map(item => (
              <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium truncate">{item.radicado || "—"}</span>
                    <Badge variant="outline" className="text-xs">{item.workflow_type || "?"}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Creado {formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: es })}
                    {item.last_error_code && (
                      <span className="ml-2 text-destructive">
                        Error: {item.last_error_code}
                        {item.last_error_at && ` (${formatDistanceToNow(new Date(item.last_error_at), { addSuffix: true, locale: es })})`}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncMutation.mutate(item)}
                  disabled={syncingIds.has(item.id)}
                >
                  {syncingIds.has(item.id) ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
