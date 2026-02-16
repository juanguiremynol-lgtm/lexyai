/**
 * PlatformDailyOpsReportsTab — Lists daily ops reports and lets Super Admin download TXT
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Download, FileText, RefreshCw, Play, CheckCircle, XCircle, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface DailyReport {
  id: string;
  report_date: string;
  run_id: string;
  status: string;
  txt_storage_path: string | null;
  txt_sha256: string | null;
  summary_json: Record<string, unknown> | null;
  raw_run_metadata_json: Record<string, unknown> | null;
  txt_content: string | null;
  created_at: string;
  updated_at: string;
}

export default function PlatformDailyOpsReportsTab() {
  const queryClient = useQueryClient();
  const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);

  const { data: reports, isLoading } = useQuery({
    queryKey: ["daily-ops-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atenia_daily_ops_reports" as any)
        .select("*")
        .order("report_date", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data || []) as unknown as DailyReport[];
    },
  });

  const triggerReport = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await supabase.functions.invoke("atenia-daily-report", {
        body: { force: true },
      });
      if (resp.error) throw resp.error;
      return resp.data;
    },
    onSuccess: (data) => {
      toast.success(`Reporte generado: ${data.summary?.tools_ok}/${data.summary?.tools_run} herramientas OK`);
      queryClient.invalidateQueries({ queryKey: ["daily-ops-reports"] });
    },
    onError: (err: Error) => {
      toast.error(`Error generando reporte: ${err.message}`);
    },
  });

  const handleDownload = (report: DailyReport) => {
    if (!report.txt_content) {
      toast.error("No hay contenido TXT disponible");
      return;
    }
    const blob = new Blob([report.txt_content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atenia-daily-ops-report-${report.report_date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "SUCCESS": return <CheckCircle className="h-4 w-4 text-primary" />;
      case "RUNNING": return <Loader2 className="h-4 w-4 text-secondary-foreground animate-spin" />;
      case "FAILED": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      SUCCESS: "default",
      RUNNING: "secondary",
      FAILED: "destructive",
      PENDING: "outline",
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Reportes Diarios de Operaciones
          </h2>
          <p className="text-sm text-muted-foreground">
            Informes automatizados diarios con KPIs, diagnósticos y evidencia de todas las herramientas de Atenia AI.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["daily-ops-reports"] })}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Actualizar
          </Button>
          <Button
            size="sm"
            onClick={() => triggerReport.mutate()}
            disabled={triggerReport.isPending}
          >
            {triggerReport.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Generar Ahora
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Report list */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Historial</CardTitle>
            <CardDescription>{reports?.length ?? 0} reportes</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (reports || []).length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No hay reportes todavía. Usa "Generar Ahora" o espera al cron diario.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {(reports || []).map((report) => {
                    const summary = report.summary_json as any;
                    return (
                      <button
                        key={report.id}
                        onClick={() => setSelectedReport(report)}
                        className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                          selectedReport?.id === report.id ? "bg-muted" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {statusIcon(report.status)}
                            <span className="font-medium text-sm text-foreground">
                              {report.report_date}
                            </span>
                          </div>
                          {statusBadge(report.status)}
                        </div>
                        {summary && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {summary.tools_ok}/{summary.tools_run} herramientas OK
                            {summary.tools_failed > 0 && ` • ${summary.tools_failed} fallidas`}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground/70">
                          {format(new Date(report.created_at), "HH:mm:ss")} UTC
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Report detail */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {selectedReport ? `Reporte: ${selectedReport.report_date}` : "Selecciona un reporte"}
                </CardTitle>
                {selectedReport && (
                  <CardDescription>
                    Run ID: {selectedReport.run_id.slice(0, 8)}...
                    {selectedReport.txt_sha256 && ` • SHA256: ${selectedReport.txt_sha256.slice(0, 12)}...`}
                  </CardDescription>
                )}
              </div>
              {selectedReport?.status === "SUCCESS" && selectedReport.txt_content && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(selectedReport)}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Descargar TXT
                </Button>
              )}
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="p-0">
            {selectedReport ? (
              <div className="space-y-4 p-4">
                {/* Summary cards */}
                {selectedReport.summary_json && (
                  <div className="grid grid-cols-4 gap-3">
                    <div className="rounded-lg border border-border p-3 text-center">
                      <div className="text-2xl font-bold text-foreground">
                        {(selectedReport.summary_json as any).tools_run}
                      </div>
                      <div className="text-xs text-muted-foreground">Herramientas</div>
                    </div>
                    <div className="rounded-lg border border-border p-3 text-center">
                      <div className="text-2xl font-bold text-primary">
                        {(selectedReport.summary_json as any).tools_ok}
                      </div>
                      <div className="text-xs text-muted-foreground">OK</div>
                    </div>
                    <div className="rounded-lg border border-border p-3 text-center">
                      <div className="text-2xl font-bold text-destructive">
                        {(selectedReport.summary_json as any).tools_failed}
                      </div>
                      <div className="text-xs text-muted-foreground">Fallidas</div>
                    </div>
                    <div className="rounded-lg border border-border p-3 text-center">
                      <div className="text-2xl font-bold text-foreground">
                        {((selectedReport.summary_json as any).total_duration_ms / 1000).toFixed(1)}s
                      </div>
                      <div className="text-xs text-muted-foreground">Duración</div>
                    </div>
                  </div>
                )}

                {/* Tool manifest */}
                {selectedReport.raw_run_metadata_json && (
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2">Herramientas Ejecutadas</h4>
                    <div className="space-y-1">
                      {((selectedReport.raw_run_metadata_json as any).tool_manifest || []).map((t: any) => (
                        <div key={t.name} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-md bg-muted/30">
                          <div className="flex items-center gap-2">
                            {t.status === "OK" ? (
                              <CheckCircle className="h-3 w-3 text-primary" />
                            ) : (
                              <XCircle className="h-3 w-3 text-destructive" />
                            )}
                            <span className="font-medium text-foreground">{t.label}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">{t.duration_ms}ms</span>
                            {t.action_id && (
                              <span className="text-muted-foreground/50 font-mono text-[10px]">
                                {t.action_id.slice(0, 8)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TXT content preview */}
                {selectedReport.txt_content && (
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2">Contenido del Reporte</h4>
                    <ScrollArea className="h-[350px] rounded-md border border-border bg-muted/20">
                      <pre className="p-4 text-xs font-mono text-foreground whitespace-pre-wrap break-words">
                        {selectedReport.txt_content}
                      </pre>
                    </ScrollArea>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
                <FileText className="h-8 w-8 mr-3 opacity-30" />
                Selecciona un reporte del historial para ver los detalles
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
