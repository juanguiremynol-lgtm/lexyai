import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseEstadosExcel, type EstadosParseResult } from "@/lib/estados-excel-parser";
import { matchEstadosToWorkItems, type MatchedEstadosRow } from "@/lib/estados-matching";
import { processEstadosBatch, type EstadosImportResult } from "@/lib/ingestion/estados-ingestion-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Link2,
  Link2Off,
  Milestone,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

type ImportStep = "upload" | "preview" | "importing" | "done";

export function EstadosImport() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<ImportStep>("upload");
  const [parseResult, setParseResult] = useState<EstadosParseResult | null>(null);
  const [matchedRows, setMatchedRows] = useState<MatchedEstadosRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importStats, setImportStats] = useState({ 
    linked: 0, 
    unlinked: 0, 
    total: 0 
  });
  const [importResult, setImportResult] = useState<EstadosImportResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewTab, setPreviewTab] = useState<"linked" | "unlinked">("linked");

  const processFile = useCallback(async (file: File) => {
    try {
      const result = await parseEstadosExcel(file);
      setParseResult(result);
      
      // Match rows with existing work_items (canonical entity)
      const matchResult = await matchEstadosToWorkItems(result.rows);
      setMatchedRows(matchResult.rows);
      setImportStats({
        linked: matchResult.linked_count,
        unlinked: matchResult.unlinked_count,
        total: matchResult.total_count,
      });
      setStep("preview");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al parsear el archivo");
    }
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  }, [processFile]);

  const handleImport = async () => {
    if (!parseResult || importStats.linked === 0) return;

    setImporting(true);
    setStep("importing");
    setProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const runId = crypto.randomUUID();

      // Create import run record
      const { error: runError } = await supabase
        .from("estados_import_runs")
        .insert({
          id: runId,
          owner_id: user.id,
          file_name: parseResult.file_name,
          file_hash: parseResult.file_hash,
          rows_total: importStats.total,
          rows_matched: importStats.linked,
          rows_unmatched: importStats.unlinked,
          status: "PROCESSING",
        });

      if (runError) throw runError;

      // Process linked estados using the new ingestion service
      const linkedRows = matchedRows.filter(r => r.match_status === 'LINKED');
      
      // Simulate progress for UX (actual processing is fast)
      setProgress(10);
      
      const result = await processEstadosBatch(linkedRows, runId, user.id);
      
      setProgress(90);
      
      // Update import run with final stats
      await supabase
        .from("estados_import_runs")
        .update({ 
          status: result.failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
          rows_matched: result.imported + result.skipped_duplicate,
        })
        .eq("id", runId);

      // Update profile last_estados_import_at
      await supabase
        .from("profiles")
        .update({ last_estados_import_at: new Date().toISOString() })
        .eq("id", user.id);

      setProgress(100);
      setImportResult(result);

      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["process-estados"] });
      queryClient.invalidateQueries({ queryKey: ["estados-import-runs"] });
      queryClient.invalidateQueries({ queryKey: ["process-events"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items-list"] });
      queryClient.invalidateQueries({ queryKey: ["work-item-acts"] });
      queryClient.invalidateQueries({ queryKey: ["cgp-terms"] });
      queryClient.invalidateQueries({ queryKey: ["cgp-milestones"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["processes"] });

      setStep("done");
      
      if (result.imported > 0) {
        toast.success(
          `Se importaron ${result.imported} estados` +
          (result.milestones_detected > 0 ? ` (${result.milestones_detected} hitos detectados)` : '') +
          (result.phase_updates > 0 ? ` (${result.phase_updates} cambios de fase)` : '')
        );
      } else if (result.skipped_duplicate > 0) {
        toast.info(`Todos los estados ya estaban importados (${result.skipped_duplicate} duplicados)`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al importar");
      setStep("preview");
    } finally {
      setImporting(false);
    }
  };

  const resetImport = () => {
    setStep("upload");
    setParseResult(null);
    setMatchedRows([]);
    setProgress(0);
    setImportStats({ linked: 0, unlinked: 0, total: 0 });
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const linkedRows = matchedRows.filter(r => r.match_status === 'LINKED');
  const unlinkedRows = matchedRows.filter(r => r.match_status === 'UNLINKED');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Importar Estados desde Excel
        </CardTitle>
        <CardDescription>
          Cargue el archivo Excel exportado de ICARUS con los estados de los procesos
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "upload" && (
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onDrop={handleFileDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
          >
            <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium mb-2">
              Arrastra tu archivo Excel aquí
            </p>
            <p className="text-muted-foreground text-sm mb-4">
              o haz clic para seleccionar
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx"
              onChange={handleFileSelect}
              className="hidden"
              id="estados-file-input"
            />
            <Button 
              variant="secondary" 
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              Seleccionar archivo
            </Button>
            <p className="text-xs text-muted-foreground mt-4">
              Formatos: .xls, .xlsx
            </p>
          </div>
        )}

        {step === "preview" && parseResult && (
          <div className="space-y-4">
            <Alert>
              <FileSpreadsheet className="h-4 w-4" />
              <AlertDescription>
                <strong>{parseResult.file_name}</strong> - {importStats.total} registros encontrados
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-3 gap-4">
              <Card className="border-primary/50">
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-primary">{importStats.linked}</div>
                  <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                    <Link2 className="h-3 w-3" />
                    Vinculados
                  </div>
                </CardContent>
              </Card>
              <Card className="border-destructive/50">
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-destructive">{importStats.unlinked}</div>
                  <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                    <Link2Off className="h-3 w-3" />
                    Sin proceso
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold">{importStats.total}</div>
                  <div className="text-sm text-muted-foreground">Total</div>
                </CardContent>
              </Card>
            </div>

            {importStats.unlinked > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {importStats.unlinked} estados sin proceso vinculado
                </AlertTitle>
                <AlertDescription>
                  Estos estados serán omitidos. Para importarlos, primero cree los procesos 
                  correspondientes en "Importar Lista de Procesos" o manualmente.
                </AlertDescription>
              </Alert>
            )}

            <Tabs value={previewTab} onValueChange={(v) => setPreviewTab(v as typeof previewTab)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="linked" className="gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Vinculados ({linkedRows.length})
                </TabsTrigger>
                <TabsTrigger value="unlinked" className="gap-2">
                  <AlertCircle className="h-4 w-4" />
                  Sin proceso ({unlinkedRows.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="linked">
                <ScrollArea className="h-[300px] border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">Estado</TableHead>
                        <TableHead>Radicado</TableHead>
                        <TableHead>Despacho</TableHead>
                        <TableHead>Última Actuación</TableHead>
                        <TableHead>Workflow</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkedRows.slice(0, 50).map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.radicado_norm}
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">
                            {row.despacho}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.fecha_ultima_actuacion_raw}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {row.matched_work_item?.workflow_type || '-'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                {linkedRows.length > 50 && (
                  <p className="text-sm text-muted-foreground text-center mt-2">
                    Mostrando 50 de {linkedRows.length} registros vinculados
                  </p>
                )}
              </TabsContent>

              <TabsContent value="unlinked">
                <ScrollArea className="h-[300px] border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">Estado</TableHead>
                        <TableHead>Radicado</TableHead>
                        <TableHead>Despacho</TableHead>
                        <TableHead>Última Actuación</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unlinkedRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                            Todos los estados están vinculados a un proceso existente
                          </TableCell>
                        </TableRow>
                      ) : (
                        unlinkedRows.slice(0, 50).map((row, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <AlertCircle className="h-4 w-4 text-destructive" />
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {row.radicado_norm}
                            </TableCell>
                            <TableCell className="text-sm max-w-[200px] truncate">
                              {row.despacho}
                            </TableCell>
                            <TableCell className="text-sm">
                              {row.fecha_ultima_actuacion_raw}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
                {unlinkedRows.length > 50 && (
                  <p className="text-sm text-muted-foreground text-center mt-2">
                    Mostrando 50 de {unlinkedRows.length} registros sin vinculación
                  </p>
                )}
              </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetImport}>
                Cancelar
              </Button>
              <Button 
                onClick={handleImport} 
                disabled={importStats.linked === 0}
                className="gap-2"
              >
                <ArrowRight className="h-4 w-4" />
                Importar {importStats.linked} Estados
              </Button>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="space-y-4 py-8">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Importando estados y detectando hitos...</span>
            </div>
            <Progress value={progress} className="max-w-md mx-auto" />
            <p className="text-center text-sm text-muted-foreground">{progress}%</p>
          </div>
        )}

        {step === "done" && importResult && (
          <div className="space-y-6 py-4">
            <div className="text-center">
              <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-4" />
              <h3 className="text-lg font-medium">Importación Completada</h3>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="border-primary/50">
                <CardContent className="pt-4 text-center">
                  <div className="text-xl font-bold text-primary">{importResult.imported}</div>
                  <div className="text-xs text-muted-foreground">Importados</div>
                </CardContent>
              </Card>
              <Card className="border-muted/50">
                <CardContent className="pt-4 text-center">
                  <div className="text-xl font-bold text-muted-foreground">{importResult.skipped_duplicate}</div>
                  <div className="text-xs text-muted-foreground">Duplicados</div>
                </CardContent>
              </Card>
              <Card className="border-secondary/50">
                <CardContent className="pt-4 text-center">
                  <div className="text-xl font-bold text-secondary-foreground">{importResult.skipped_unlinked}</div>
                  <div className="text-xs text-muted-foreground">Sin proceso</div>
                </CardContent>
              </Card>
              <Card className="border-destructive/50">
                <CardContent className="pt-4 text-center">
                  <div className="text-xl font-bold text-destructive">{importResult.failed}</div>
                  <div className="text-xs text-muted-foreground">Fallidos</div>
                </CardContent>
              </Card>
            </div>

            {/* Milestones & Phase Updates */}
            {(importResult.milestones_detected > 0 || importResult.phase_updates > 0) && (
              <Alert className="border-primary/50 bg-primary/5">
                <Milestone className="h-4 w-4" />
                <AlertTitle>Hitos detectados</AlertTitle>
                <AlertDescription>
                  Se detectaron <strong>{importResult.milestones_detected}</strong> hitos procesales
                  {importResult.phase_updates > 0 && (
                    <> y se actualizó la fase de <strong>{importResult.phase_updates}</strong> proceso(s)</>
                  )}.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-center">
              <Button onClick={resetImport}>Importar Otro Archivo</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
