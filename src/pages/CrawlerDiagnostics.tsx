import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
} from "lucide-react";

interface CrawlerRun {
  id: string;
  radicado: string;
  adapter: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  request_meta: Record<string, unknown>;
  response_meta: Record<string, unknown>;
  debug_excerpt: string | null;
}

interface CrawlerStep {
  id: string;
  step_name: string;
  ok: boolean;
  detail: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export default function CrawlerDiagnostics() {
  const { runId } = useParams<{ runId: string }>();

  const { data: run, isLoading: runLoading } = useQuery({
    queryKey: ["crawler-run", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crawler_runs")
        .select("*")
        .eq("id", runId)
        .single();

      if (error) throw error;
      return data as CrawlerRun;
    },
    enabled: !!runId,
  });

  const { data: steps, isLoading: stepsLoading } = useQuery({
    queryKey: ["crawler-run-steps", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crawler_run_steps")
        .select("*")
        .eq("run_id", runId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as CrawlerStep[];
    },
    enabled: !!runId,
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return "bg-green-500";
      case "EMPTY":
        return "bg-yellow-500";
      case "ERROR":
        return "bg-destructive";
      case "RUNNING":
        return "bg-blue-500";
      default:
        return "bg-muted";
    }
  };

  const getStepIcon = (ok: boolean) => {
    return ok ? (
      <CheckCircle2 className="h-4 w-4 text-green-500" />
    ) : (
      <XCircle className="h-4 w-4 text-destructive" />
    );
  };

  if (runLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">Run no encontrado</h2>
        <p className="text-muted-foreground mt-2">
          El diagnóstico solicitado no existe o no tienes acceso.
        </p>
        <Button asChild className="mt-4">
          <Link to="/process-status">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/process-status">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-serif font-bold">Diagnóstico de Crawler</h1>
          <p className="text-muted-foreground font-mono text-sm">{run.id}</p>
        </div>
      </div>

      {/* Summary Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Resumen de Ejecución</CardTitle>
            <Badge className={getStatusColor(run.status)}>{run.status}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Adapter</p>
              <p className="font-medium">{run.adapter}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Radicado</p>
              <p className="font-mono text-sm">{run.radicado}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">HTTP Status</p>
              <p className="font-medium">
                {run.http_status ? (
                  <Badge
                    variant={run.http_status >= 400 ? "destructive" : "secondary"}
                  >
                    {run.http_status}
                  </Badge>
                ) : (
                  "N/A"
                )}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Duración</p>
              <p className="font-medium">
                {run.duration_ms ? `${run.duration_ms}ms` : "En progreso..."}
              </p>
            </div>
          </div>

          {run.error_message && (
            <div className="mt-4 p-3 bg-destructive/10 rounded-md border border-destructive/20">
              <p className="text-sm font-medium text-destructive">
                {run.error_code}: {run.error_message}
              </p>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Inicio</p>
              <p>{new Date(run.started_at).toLocaleString("es-CO")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Fin</p>
              <p>
                {run.finished_at
                  ? new Date(run.finished_at).toLocaleString("es-CO")
                  : "En progreso..."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Steps Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Pasos de Ejecución
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stepsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : steps && steps.length > 0 ? (
            <div className="space-y-3">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex flex-col items-center">
                    {getStepIcon(step.ok)}
                    {index < steps.length - 1 && (
                      <div className="w-px h-full bg-border mt-1" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{step.step_name}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(step.created_at).toLocaleTimeString("es-CO")}
                      </span>
                    </div>
                    {step.detail && (
                      <p className="text-sm mt-1 text-muted-foreground">
                        {step.detail}
                      </p>
                    )}
                    {step.meta && Object.keys(step.meta).length > 0 && (
                      <pre className="text-xs mt-1 p-2 bg-background rounded overflow-x-auto">
                        {JSON.stringify(step.meta, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              No hay pasos registrados
            </p>
          )}
        </CardContent>
      </Card>

      {/* Request/Response Meta */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48">
              <pre className="text-xs">
                {JSON.stringify(run.request_meta, null, 2)}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Response Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48">
              <pre className="text-xs">
                {JSON.stringify(run.response_meta, null, 2)}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Debug Excerpt */}
      {run.debug_excerpt && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Debug Excerpt (primeros 10KB)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64 rounded border">
              <pre className="text-xs p-4 whitespace-pre-wrap">
                {run.debug_excerpt}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
