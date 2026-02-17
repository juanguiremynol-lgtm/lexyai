/**
 * ActuacionDiffView — Shows "what changed" between actuaciones snapshots
 * Highlights new and removed actuaciones compared to the previous sync.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ensureValidSession } from "@/lib/supabase-query-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  GitCompare, Plus, Minus, Copy, Check, ChevronDown, ChevronUp 
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { toast } from "sonner";

interface DiffViewProps {
  workItemId: string;
  dataKind: "actuaciones" | "estados";
}

interface DiffEntry {
  id: string;
  description: string;
  date: string | null;
  source: string | null;
  changeType: "added" | "removed" | "unchanged";
  created_at: string;
}

export function ActuacionDiffView({ workItemId, dataKind }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: allRecords, isLoading } = useQuery({
    queryKey: [`diff-view-${dataKind}`, workItemId],
    queryFn: async () => {
      await ensureValidSession();

      if (dataKind === "actuaciones") {
        const { data, error } = await supabase
          .from("work_item_acts")
          .select("id, description, created_at, source, act_date")
          .eq("work_item_id", workItemId)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        return (data || []).map((r) => ({
          id: r.id,
          description: r.description,
          date: r.act_date,
          source: r.source,
          created_at: r.created_at,
        }));
      } else {
        const { data, error } = await supabase
          .from("work_item_publicaciones")
          .select("id, title, created_at, source, fecha_fijacion")
          .eq("work_item_id", workItemId)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        return (data || []).map((r) => ({
          id: r.id,
          description: r.title,
          date: r.fecha_fijacion,
          source: r.source,
          created_at: r.created_at,
        }));
      }
    },
    enabled: !!workItemId,
  });

  const diffEntries = useMemo<DiffEntry[]>(() => {
    if (!allRecords || allRecords.length === 0) return [];

    // Find the most recent sync batch by looking at created_at gaps
    // Records created within 5 minutes of each other are considered same batch
    const sorted = [...allRecords].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    if (sorted.length <= 1) return [];

    // Find the batch boundary: first significant gap (>5 min) in created_at
    const BATCH_GAP_MS = 5 * 60 * 1000; // 5 minutes
    let batchBoundary = 1;
    for (let i = 1; i < sorted.length; i++) {
      const gap = new Date(sorted[i - 1].created_at).getTime() - new Date(sorted[i].created_at).getTime();
      if (gap > BATCH_GAP_MS) {
        batchBoundary = i;
        break;
      }
    }

    if (batchBoundary === sorted.length) return []; // All same batch, no diff

    const latestBatch = new Set(sorted.slice(0, batchBoundary).map(r => r.description?.trim().toLowerCase()));
    const previousBatch = new Set(sorted.slice(batchBoundary).map(r => r.description?.trim().toLowerCase()));

    const entries: DiffEntry[] = [];

    // New entries (in latest but not in previous)
    for (const record of sorted.slice(0, batchBoundary)) {
      const key = record.description?.trim().toLowerCase();
      entries.push({
        id: record.id,
        description: record.description || "",
        date: record.date,
        source: record.source || null,
        changeType: previousBatch.has(key) ? "unchanged" : "added",
        created_at: record.created_at,
      });
    }

    // Removed entries (in previous but not in latest) — rare but possible
    for (const record of sorted.slice(batchBoundary)) {
      const key = record.description?.trim().toLowerCase();
      if (!latestBatch.has(key)) {
        entries.push({
          id: record.id,
          description: record.description || "",
          date: record.date,
          source: record.source || null,
          changeType: "removed",
          created_at: record.created_at,
        });
      }
    }

    return entries.filter(e => e.changeType !== "unchanged");
  }, [allRecords, dataKind]);

  const handleOpen = () => {
    setExpanded(!expanded);
    if (!expanded) {
      track(ANALYTICS_EVENTS.DIFF_VIEW_OPENED, { data_kind: dataKind });
    }
  };

  const handleCopyDiff = () => {
    const text = diffEntries
      .map(e => `${e.changeType === "added" ? "+" : "-"} ${e.description}${e.date ? ` (${e.date})` : ""}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      track(ANALYTICS_EVENTS.DIFF_VIEW_COPIED, { data_kind: dataKind, entries_count: diffEntries.length });
      toast.success("Cambios copiados al portapapeles");
    });
  };

  if (isLoading || diffEntries.length === 0) return null;

  const addedCount = diffEntries.filter(e => e.changeType === "added").length;
  const removedCount = diffEntries.filter(e => e.changeType === "removed").length;

  return (
    <Card className="border-dashed border-primary/30">
      <CardHeader className="pb-2 cursor-pointer" onClick={handleOpen}>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitCompare className="h-4 w-4 text-primary" />
            Cambios recientes
            {addedCount > 0 && (
              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
                +{addedCount} nuevo{addedCount > 1 ? "s" : ""}
              </Badge>
            )}
            {removedCount > 0 && (
              <Badge className="bg-red-500/10 text-red-600 border-red-500/30 text-xs">
                -{removedCount} eliminado{removedCount > 1 ? "s" : ""}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {expanded && (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleCopyDiff(); }}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            )}
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          <div className="space-y-1.5 font-mono text-sm">
            {diffEntries.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "flex items-start gap-2 px-3 py-1.5 rounded-md",
                  entry.changeType === "added"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-red-500/10 text-red-700 dark:text-red-400 line-through opacity-70"
                )}
              >
                {entry.changeType === "added" ? (
                  <Plus className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                ) : (
                  <Minus className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-relaxed break-words">{entry.description}</p>
                  {entry.date && (
                    <p className="text-[10px] opacity-70 mt-0.5">
                      {entry.date}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
