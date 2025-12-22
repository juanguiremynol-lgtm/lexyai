import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
  Copy,
  ExternalLink,
  RefreshCw,
  Globe,
} from "lucide-react";
import { toast } from "sonner";

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

const STATUS_COLORS: Record<string, string> = {
  'SUCCESS': 'bg-green-500',
  'EMPTY': 'bg-yellow-500',
  'ERROR': 'bg-destructive',
  'RUNNING': 'bg-blue-500',
};

const CLASSIFICATION_COLORS: Record<string, string> = {
  'SUCCESS': 'bg-green-500 text-white',
  'NO_RESULTS_CONFIRMED': 'bg-yellow-500 text-black',
  'ENDPOINT_404': 'bg-red-600 text-white',
  'ENDPOINT_CHANGED': 'bg-red-500 text-white',
  'BLOCKED_403_429': 'bg-orange-500 text-white',
  'NON_JSON_RESPONSE': 'bg-purple-500 text-white',
  'PARSE_BROKE': 'bg-amber-500 text-black',
  'INTERACTION_REQUIRED': 'bg-blue-500 text-white',
  'INTERACTION_FAILED_SELECTOR_CHANGED': 'bg-rose-500 text-white',
  'UNKNOWN': 'bg-muted text-muted-foreground',
};

export default function CrawlerDiagnostics() {
  const { runId } = useParams<{ runId: string }>();

  const { data: run, isLoading: runLoading, refetch } = useQuery({
    queryKey: ["crawler-run", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crawler_runs")
        .select("*")
        .eq("id", runId)
        .maybeSingle();

      if (error) throw error;
      return data as CrawlerRun | null;
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
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
      <div className="space-y-6 p-4 md:p-6">
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

  const responseMeta = run.response_meta as Record<string, any>;
  const classification = responseMeta?.classification;
  const attemptsCount = responseMeta?.attempts_count || 0;
  const whyEmpty = responseMeta?.why_empty;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/process-status/test">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-serif font-bold">Diagnóstico de Crawler</h1>
            <p className="text-muted-foreground font-mono text-sm">{run.id}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => copyToClipboard(run.id)}>
            <Copy className="h-4 w-4 mr-1" />
            Copy ID
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => copyToClipboard(JSON.stringify(run, null, 2))}>
            <Copy className="h-4 w-4 mr-1" />
            Copy JSON
          </Button>
        </div>
      </div>

      {/* Summary Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>Resumen de Ejecución</CardTitle>
            <div className="flex gap-2">
              <Badge className={STATUS_COLORS[run.status] || 'bg-muted'}>
                {run.status}
              </Badge>
              {classification && (
                <Badge className={CLASSIFICATION_COLORS[classification] || 'bg-muted'}>
                  {classification}
                </Badge>
              )}
            </div>
          </div>
          {whyEmpty && (
            <CardDescription className="text-amber-600 dark:text-amber-400 font-medium">
              Razón vacío: {whyEmpty}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">Adapter</p>
              <p className="font-semibold">{run.adapter}</p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">Radicado</p>
              <p className="font-mono text-sm break-all">{run.radicado}</p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">HTTP Status</p>
              <p className="font-medium">
                {run.http_status ? (
                  <Badge variant={run.http_status >= 400 ? "destructive" : "secondary"}>
                    {run.http_status}
                  </Badge>
                ) : (
                  "N/A"
                )}
              </p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">Duración</p>
              <p className="font-medium">
                {run.duration_ms ? `${run.duration_ms}ms` : "En progreso..."}
              </p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">Intentos</p>
              <p className="font-medium">{attemptsCount}</p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">Resultados</p>
              <p className="font-medium">{responseMeta?.results_count || 0}</p>
            </div>
          </div>

          {run.error_message && (
            <div className="mt-4 p-3 bg-destructive/10 rounded-md border border-destructive/20">
              <p className="text-sm font-medium text-destructive">
                {run.error_code && <span className="font-mono mr-2">[{run.error_code}]</span>}
                {run.error_message}
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

      {/* Tabs for different views */}
      <Tabs defaultValue="steps" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="steps">Pasos ({steps?.length || 0})</TabsTrigger>
          <TabsTrigger value="request">Request</TabsTrigger>
          <TabsTrigger value="response">Response</TabsTrigger>
          <TabsTrigger value="debug">Debug Excerpt</TabsTrigger>
        </TabsList>

        {/* Steps Timeline */}
        <TabsContent value="steps">
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
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {steps.map((step, index) => (
                      <div
                        key={step.id}
                        className={`p-4 rounded-lg border ${step.ok ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col items-center">
                            {getStepIcon(step.ok)}
                            {index < steps.length - 1 && (
                              <div className="w-px h-full bg-border mt-1 min-h-[20px]" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="font-mono">
                                {step.step_name}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {new Date(step.created_at).toLocaleTimeString("es-CO")}
                              </span>
                            </div>
                            {step.detail && (
                              <p className="text-sm mt-1 text-muted-foreground break-all">
                                {step.detail}
                              </p>
                            )}
                            {step.meta && Object.keys(step.meta).length > 0 && (
                              <details className="mt-2">
                                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                  Ver metadata
                                </summary>
                                <pre className="text-xs mt-1 p-2 bg-background rounded overflow-x-auto">
                                  {JSON.stringify(step.meta, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-muted-foreground text-center py-4">
                  No hay pasos registrados
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Request Meta */}
        <TabsContent value="request">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Request Metadata
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64 rounded border">
                <pre className="text-xs p-4">
                  {JSON.stringify(run.request_meta, null, 2)}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Response Meta */}
        <TabsContent value="response">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Response Metadata
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64 rounded border">
                <pre className="text-xs p-4">
                  {JSON.stringify(run.response_meta, null, 2)}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Debug Excerpt */}
        <TabsContent value="debug">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Debug Excerpt (primeros 10KB)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {run.debug_excerpt ? (
                <ScrollArea className="h-[400px] rounded border">
                  <pre className="text-xs p-4 whitespace-pre-wrap break-all">
                    {run.debug_excerpt}
                  </pre>
                </ScrollArea>
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No hay debug excerpt disponible
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
