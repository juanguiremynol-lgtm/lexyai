/**
 * SyncTimelineTab
 * --------------
 * Per-work-item sync history showing which deployed code version
 * (deploy_sha) ran each sync attempt. Lets you quickly spot
 * repo-vs-production drift (e.g. "main is at abc123 but the last 5
 * runs were still on def456").
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertCircle, CheckCircle2, Clock, GitCommit, MinusCircle, XCircle } from "lucide-react";

interface Props {
  workItemId: string;
}

interface TimelineRow {
  id: string;
  finished_at: string;
  started_at: string | null;
  provider: string;
  workflow_type: string | null;
  operation: string;
  function_name: string | null;
  adapter_version: string | null;
  deploy_sha: string | null;
  status: "success" | "error" | "empty" | "skipped" | "partial";
  error_code: string | null;
  error_message: string | null;
  records_inserted: number;
  records_skipped: number;
  latency_ms: number | null;
  metadata: Record<string, unknown> | null;
}

const STATUS_META: Record<TimelineRow["status"], { label: string; variant: "default" | "destructive" | "secondary" | "outline"; Icon: typeof CheckCircle2 }> = {
  success: { label: "Éxito", variant: "default", Icon: CheckCircle2 },
  error: { label: "Error", variant: "destructive", Icon: XCircle },
  empty: { label: "Vacío", variant: "secondary", Icon: MinusCircle },
  skipped: { label: "Omitido", variant: "outline", Icon: Clock },
  partial: { label: "Parcial", variant: "secondary", Icon: AlertCircle },
};

function shortSha(sha: string | null): string {
  if (!sha || sha === "unset") return "sin versión";
  return sha.length > 8 ? sha.slice(0, 8) : sha;
}

export function SyncTimelineTab({ workItemId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sync-timeline", workItemId],
    queryFn: async () => {
      console.info("[SyncTimelineTab] fetch", { workItemId });
      const { data, error } = await supabase
        .from("work_item_sync_timeline")
        .select("*")
        .eq("work_item_id", workItemId)
        .order("finished_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as TimelineRow[];
    },
    enabled: !!workItemId,
    refetchInterval: 30_000,
  });

  // Detect drift: if more than one distinct deploy_sha appeared in the last
  // 10 runs, we likely have a propagation issue (old + new code both running).
  const drift = (() => {
    if (!data || data.length === 0) return null;
    const recent = data.slice(0, 10).map((r) => r.deploy_sha).filter(Boolean);
    const unique = [...new Set(recent)];
    if (unique.length <= 1) return null;
    return unique as string[];
  })();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error cargando línea de tiempo</AlertTitle>
        <AlertDescription>{(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Todavía no se registró ninguna corrida de sincronización para este expediente.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {drift && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Posible desfase repo vs producción</AlertTitle>
          <AlertDescription>
            En las últimas corridas convivieron <b>{drift.length}</b> versiones de código:{" "}
            {drift.map((s) => shortSha(s)).join(", ")}.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Línea de tiempo de sincronización</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.map((row) => {
            const meta = STATUS_META[row.status] ?? STATUS_META.empty;
            const Icon = meta.Icon;
            return (
              <div key={row.id} className="border rounded-md p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={meta.variant} className="gap-1">
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                    <Badge variant="outline">{row.provider}</Badge>
                    <Badge variant="outline">{row.operation}</Badge>
                    {row.workflow_type && (
                      <Badge variant="secondary">{row.workflow_type}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(row.finished_at), "d MMM yyyy HH:mm:ss", { locale: es })}
                    {row.latency_ms != null && <> · {row.latency_ms} ms</>}
                    {row.function_name && <> · {row.function_name}</>}
                  </div>
                  {row.status === "error" && (row.error_message || row.error_code) && (
                    <div className="text-xs text-destructive break-words">
                      <b>{row.error_code ?? "ERROR"}</b>
                      {row.error_message ? ` — ${row.error_message}` : ""}
                    </div>
                  )}
                  {(row.records_inserted > 0 || row.records_skipped > 0) && (
                    <div className="text-xs text-muted-foreground">
                      +{row.records_inserted} nuevas · {row.records_skipped} omitidas
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground">
                    <GitCommit className="h-3 w-3" />
                    {shortSha(row.deploy_sha)}
                  </div>
                  {row.adapter_version && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      adapter: {row.adapter_version}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}