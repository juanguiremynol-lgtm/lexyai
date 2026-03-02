/**
 * Dead-Letter Queue Panel — Shows permanently failed retry tasks with re-enqueue capability.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skull, RefreshCw, RotateCcw } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

interface DeadLetteredTask {
  id: string;
  work_item_id: string;
  radicado: string | null;
  kind: string;
  attempt: number;
  max_attempts: number;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  next_run_at: string | null;
  organization_id: string | null;
}

export function DeadLetterQueuePanel() {
  const queryClient = useQueryClient();

  const { data: tasks, isLoading, refetch } = useQuery({
    queryKey: ["dead-letter-tasks"],
    queryFn: async () => {
      // Dead-lettered = attempt >= max_attempts
      const { data, error } = await (supabase.from("sync_retry_queue") as any)
        .select("id, work_item_id, radicado, kind, attempt, max_attempts, last_error_code, last_error_message, created_at, next_run_at, organization_id")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      // Filter to dead-lettered client-side since we can't do gte on computed cols
      return (data as DeadLetteredTask[]).filter(t => t.attempt >= t.max_attempts);
    },
    refetchInterval: 30_000,
  });

  // Also check work_items with scrape_status = FAILED and SCRAPING_STUCK
  const { data: failedItems } = useQuery({
    queryKey: ["dead-letter-work-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select("id, radicado, workflow_type, last_error_code, last_error_at, scrape_status")
        .eq("monitoring_enabled", true)
        .is("deleted_at", null)
        .in("scrape_status", ["FAILED"] as any)
        .order("last_error_at", { ascending: false, nullsFirst: false })
        .limit(30);

      if (error) throw error;
      return data;
    },
  });

  const reenqueueMutation = useMutation({
    mutationFn: async (task: DeadLetteredTask) => {
      const { error } = await (supabase.from("sync_retry_queue") as any)
        .update({
          attempt: 0,
          next_run_at: new Date().toISOString(),
          claimed_at: null,
          last_error_code: "RE_ENQUEUED_BY_ADMIN",
          last_error_message: `Manually re-enqueued at ${new Date().toISOString()}`,
        })
        .eq("id", task.id);

      if (error) throw error;
    },
    onSuccess: (_, task) => {
      toast.success(`✅ Task ${task.radicado} re-encolado para reintento`);
      queryClient.invalidateQueries({ queryKey: ["dead-letter-tasks"] });
    },
    onError: (err) => {
      toast.error(`❌ Error al re-encolar: ${String(err)}`);
    },
  });

  const reenqueueWorkItem = useMutation({
    mutationFn: async (item: { id: string; radicado: string | null }) => {
      // Reset the work item status and trigger a sync
      await supabase
        .from("work_items")
        .update({
          scrape_status: "PENDING",
          last_error_code: null,
          consecutive_failures: 0,
          consecutive_404_count: 0,
        } as any)
        .eq("id", item.id);

      const { error } = await supabase.functions.invoke("sync-by-work-item", {
        body: { work_item_id: item.id, force_refresh: true, _scheduled: false },
      });
      if (error) throw error;
    },
    onSuccess: (_, item) => {
      toast.success(`✅ Re-sync iniciado para ${item.radicado}`);
      queryClient.invalidateQueries({ queryKey: ["dead-letter-work-items"] });
    },
    onError: (err) => {
      toast.error(`❌ Error: ${String(err)}`);
    },
  });

  const totalDead = (tasks?.length ?? 0) + (failedItems?.length ?? 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Skull className="h-5 w-5 text-destructive" />
              Dead-Letter Queue ({totalDead})
            </CardTitle>
            <CardDescription>
              Tareas de retry agotadas y work items con sync permanentemente fallido
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Actualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando...</div>
        ) : totalDead === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            ✅ No hay tareas en dead-letter
          </div>
        ) : (
          <div className="space-y-4">
            {/* Retry Queue Dead Letters */}
            {tasks && tasks.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Cola de Reintentos Agotados</h4>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {tasks.map(task => (
                    <div key={task.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{task.radicado || task.work_item_id.slice(0, 8)}</span>
                          <Badge variant="destructive" className="text-xs">{task.kind}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {task.attempt}/{task.max_attempts} intentos
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {task.last_error_code && <span className="text-destructive mr-2">{task.last_error_code}</span>}
                          Creado {formatDistanceToNow(new Date(task.created_at), { addSuffix: true, locale: es })}
                        </div>
                        {task.last_error_message && (
                          <div className="text-xs text-muted-foreground mt-1 truncate max-w-[400px]">
                            {task.last_error_message}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => reenqueueMutation.mutate(task)}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" /> Re-encolar
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Failed Work Items */}
            {failedItems && failedItems.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Work Items con Sync Fallido</h4>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {failedItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{item.radicado || item.id.slice(0, 8)}</span>
                          <Badge variant="outline" className="text-xs">{item.workflow_type}</Badge>
                          <Badge variant="destructive" className="text-xs">{item.scrape_status}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {item.last_error_code && <span className="text-destructive mr-2">{item.last_error_code}</span>}
                          {item.last_error_at && `Error ${formatDistanceToNow(new Date(item.last_error_at), { addSuffix: true, locale: es })}`}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => reenqueueWorkItem.mutate(item)}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" /> Re-sync
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
