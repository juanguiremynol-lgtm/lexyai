/**
 * SkippedItemsDetail — Expandable table showing skipped items from daily sync,
 * with individual and bulk retry capabilities.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface SkippedItem {
  work_item_id: string;
  radicado: string;
  skip_reason: string;
  timeout_count: number;
  last_attempted_at: string;
  chain_id: string;
  is_persistent: boolean; // skipped 3+ times across last 3 days
}

interface SkippedItemsDetailProps {
  organizationId: string;
  runDate: string;
}

export function SkippedItemsDetail({ organizationId, runDate }: SkippedItemsDetailProps) {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  // Fetch skipped items from ledger error_summary + metadata
  const { data: skippedItems = [], isLoading } = useQuery({
    queryKey: ["skipped-items-detail", organizationId, runDate],
    queryFn: async () => {
      // Get all ledger entries for this org and date
      const { data: ledgerRows, error } = await (supabase.from("auto_sync_daily_ledger") as any)
        .select("id, chain_id, error_summary, metadata, created_at")
        .eq("organization_id", organizationId)
        .eq("run_date", runDate)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error || !ledgerRows) return [];

      // Collect all skipped items from error summaries
      const skippedMap = new Map<string, SkippedItem>();

      for (const row of ledgerRows) {
        const errors = (row.error_summary || []) as any[];
        const metadata = (row.metadata || {}) as any;
        const timeoutItemsSet = new Set<string>(metadata.timeout_items || []);

        for (const err of errors) {
          if (!err.work_item_id) continue;
          const existing = skippedMap.get(err.work_item_id);
          if (!existing) {
            skippedMap.set(err.work_item_id, {
              work_item_id: err.work_item_id,
              radicado: err.radicado || err.work_item_id.slice(0, 8),
              skip_reason: err.skip_reason || (err.is_timeout ? "TIMEOUT" : "API_ERROR"),
              timeout_count: err.is_timeout ? 1 : 0,
              last_attempted_at: err.ts || row.created_at,
              chain_id: row.chain_id || row.id,
              is_persistent: false,
            });
          } else if (err.is_timeout) {
            existing.timeout_count++;
          }
        }
      }

      // Check for persistent skips (3+ times across last 3 days)
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (skippedMap.size > 0) {
        const workItemIds = [...skippedMap.keys()];
        const { data: historicalLedgers } = await (supabase.from("auto_sync_daily_ledger") as any)
          .select("error_summary")
          .eq("organization_id", organizationId)
          .gte("run_date", threeDaysAgo)
          .lt("run_date", runDate)
          .limit(30);

        if (historicalLedgers) {
          const historicalSkipCounts = new Map<string, number>();
          for (const hl of historicalLedgers) {
            for (const err of (hl.error_summary || []) as any[]) {
              if (err.work_item_id && workItemIds.includes(err.work_item_id)) {
                historicalSkipCounts.set(
                  err.work_item_id,
                  (historicalSkipCounts.get(err.work_item_id) || 0) + 1
                );
              }
            }
          }
          for (const [wid, count] of historicalSkipCounts) {
            const item = skippedMap.get(wid);
            if (item && count >= 2) { // 2 historical + current = 3+
              item.is_persistent = true;
            }
          }
        }
      }

      return [...skippedMap.values()].sort((a, b) => {
        // Persistent items first, then by timeout count desc
        if (a.is_persistent !== b.is_persistent) return a.is_persistent ? -1 : 1;
        return b.timeout_count - a.timeout_count;
      });
    },
    enabled: isOpen,
    staleTime: 60_000,
  });

  // Retry single item
  const retryItem = useMutation({
    mutationFn: async (workItemId: string) => {
      const { data, error } = await supabase.functions.invoke("sync-by-work-item", {
        body: { work_item_id: workItemId, force: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, workItemId) => {
      toast.success(`Sync iniciado para ${workItemId.slice(0, 8)}…`);
      queryClient.invalidateQueries({ queryKey: ["skipped-items-detail"] });
    },
    onError: (err: any) => {
      toast.error(`Error al reintentar: ${err.message}`);
    },
  });

  // Retry all skipped items
  const retryAll = useMutation({
    mutationFn: async (items: SkippedItem[]) => {
      const results = [];
      for (const item of items.slice(0, 20)) { // Cap at 20 to avoid hammering
        try {
          const { data, error } = await supabase.functions.invoke("sync-by-work-item", {
            body: { work_item_id: item.work_item_id, force: true },
          });
          results.push({ id: item.work_item_id, ok: !error });
        } catch {
          results.push({ id: item.work_item_id, ok: false });
        }
        // Small delay between items
        await new Promise(r => setTimeout(r, 2000));
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter(r => r.ok).length;
      toast.success(`Reinicio masivo: ${ok}/${results.length} exitosos`);
      queryClient.invalidateQueries({ queryKey: ["skipped-items-detail"] });
    },
    onError: (err: any) => {
      toast.error(`Error en reinicio masivo: ${err.message}`);
    },
  });

  if (isLoading && isOpen) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Cargando items…
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
        <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        Detalle Items Omitidos
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        {skippedItems.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Sin items omitidos en esta fecha.</p>
        ) : (
          <div className="space-y-2">
            {/* Bulk retry */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{skippedItems.length} items omitidos</span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                disabled={retryAll.isPending}
                onClick={() => retryAll.mutate(skippedItems)}
              >
                {retryAll.isPending ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Reintentar Todos
              </Button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1 px-1 font-medium">Radicado</th>
                    <th className="text-center py-1 px-1 font-medium">Razón</th>
                    <th className="text-center py-1 px-1 font-medium">Timeouts</th>
                    <th className="text-left py-1 px-1 font-medium">Último Intento</th>
                    <th className="text-center py-1 px-1 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {skippedItems.map((item) => (
                    <tr
                      key={item.work_item_id}
                      className={`border-b hover:bg-muted/50 ${item.is_persistent ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}
                    >
                      <td className="py-1 px-1 font-mono">
                        <div className="flex items-center gap-1">
                          {item.is_persistent && (
                            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                          )}
                          <span className="truncate max-w-[140px]">{item.radicado}</span>
                        </div>
                      </td>
                      <td className="py-1 px-1 text-center">
                        <Badge
                          variant={item.skip_reason === "TIMEOUT_EXHAUSTED" ? "destructive" : "outline"}
                          className="text-[9px]"
                        >
                          {item.skip_reason}
                        </Badge>
                      </td>
                      <td className="py-1 px-1 text-center">
                        {item.timeout_count > 0 ? (
                          <span className="text-amber-600 font-medium">{item.timeout_count}⏱️</span>
                        ) : "—"}
                      </td>
                      <td className="py-1 px-1 text-muted-foreground">
                        {formatDistanceToNow(new Date(item.last_attempted_at), { addSuffix: true, locale: es })}
                      </td>
                      <td className="py-1 px-1 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 text-[9px] px-1.5"
                          disabled={retryItem.isPending}
                          onClick={() => retryItem.mutate(item.work_item_id)}
                        >
                          <RefreshCw className="h-2.5 w-2.5 mr-0.5" />
                          Retry
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
