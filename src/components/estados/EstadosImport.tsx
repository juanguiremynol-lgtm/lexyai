import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseEstadosExcel, type EstadosExcelRow, type EstadosParseResult } from "@/lib/estados-excel-parser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Link2,
  Link2Off,
} from "lucide-react";
import { toast } from "sonner";

type ImportStep = "upload" | "preview" | "importing" | "done";

export function EstadosImport() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<ImportStep>("upload");
  const [parseResult, setParseResult] = useState<EstadosParseResult | null>(null);
  const [matchedRows, setMatchedRows] = useState<(EstadosExcelRow & { matched_process_id: string | null })[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importStats, setImportStats] = useState({ matched: 0, unmatched: 0, total: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback(async (file: File) => {
    try {
      const result = await parseEstadosExcel(file);
      setParseResult(result);
      
      // Match rows with existing processes
      await matchWithProcesses(result.rows);
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

  const matchWithProcesses = async (rows: EstadosExcelRow[]) => {
    const { data: processes } = await supabase
      .from("monitored_processes")
      .select("id, radicado");

    const processMap = new Map<string, string>();
    processes?.forEach((p) => {
      const normRadicado = p.radicado.replace(/\D/g, "");
      processMap.set(normRadicado, p.id);
    });

    const matched = rows.map((row) => ({
      ...row,
      matched_process_id: processMap.get(row.radicado_norm) || null,
    }));

    setMatchedRows(matched);
    const matchedCount = matched.filter((r) => r.matched_process_id).length;
    setImportStats({
      matched: matchedCount,
      unmatched: matched.length - matchedCount,
      total: matched.length,
    });
  };

  const handleImport = async () => {
    if (!parseResult) return;

    setImporting(true);
    setStep("importing");
    setProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Create import run
      const { data: importRun, error: runError } = await supabase
        .from("estados_import_runs")
        .insert({
          owner_id: user.id,
          file_name: parseResult.file_name,
          file_hash: parseResult.file_hash,
          rows_total: importStats.total,
          rows_matched: importStats.matched,
          rows_unmatched: importStats.unmatched,
          status: "PROCESSING",
        })
        .select()
        .single();

      if (runError) throw runError;

      // Insert matched estados
      const matchedToInsert = matchedRows.filter((r) => r.matched_process_id);
      let inserted = 0;

      for (const row of matchedToInsert) {
        const { error } = await supabase.from("process_estados").insert({
          owner_id: user.id,
          monitored_process_id: row.matched_process_id,
          radicado: row.radicado_norm,
          distrito: row.distrito,
          despacho: row.despacho,
          juez_ponente: row.juez_ponente,
          demandantes: row.demandantes,
          demandados: row.demandados,
          fecha_ultima_actuacion: row.fecha_ultima_actuacion,
          fecha_ultima_actuacion_raw: row.fecha_ultima_actuacion_raw,
          import_run_id: importRun.id,
          source_payload: {
            ...row,
            all_columns: row.all_columns,
          } as unknown as Record<string, unknown>,
        } as never);

        if (!error) inserted++;
        setProgress(Math.round((inserted / matchedToInsert.length) * 100));
      }

      // Update import run status
      await supabase
        .from("estados_import_runs")
        .update({ status: "COMPLETED" })
        .eq("id", importRun.id);

      // Update profile last_estados_import_at
      await supabase
        .from("profiles")
        .update({ last_estados_import_at: new Date().toISOString() })
        .eq("id", user.id);

      queryClient.invalidateQueries({ queryKey: ["process-estados"] });
      queryClient.invalidateQueries({ queryKey: ["estados-import-runs"] });

      setStep("done");
      toast.success(`Se importaron ${inserted} estados de ${importStats.total} registros`);
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
    setImportStats({ matched: 0, unmatched: 0, total: 0 });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-green-600">{importStats.matched}</div>
                  <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                    <Link2 className="h-3 w-3" />
                    Vinculados
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-orange-500">{importStats.unmatched}</div>
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
                  {matchedRows.slice(0, 50).map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        {row.matched_process_id ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                        )}
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
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>

            {matchedRows.length > 50 && (
              <p className="text-sm text-muted-foreground text-center">
                Mostrando 50 de {matchedRows.length} registros
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetImport}>
                Cancelar
              </Button>
              <Button onClick={handleImport} disabled={importStats.matched === 0}>
                Importar {importStats.matched} Estados
              </Button>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="space-y-4 py-8">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Importando estados...</span>
            </div>
            <Progress value={progress} className="max-w-md mx-auto" />
            <p className="text-center text-sm text-muted-foreground">{progress}%</p>
          </div>
        )}

        {step === "done" && (
          <div className="text-center py-8">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium">Importación Completada</h3>
            <p className="text-muted-foreground mb-4">
              Se importaron {importStats.matched} estados correctamente
            </p>
            <Button onClick={resetImport}>Importar Otro Archivo</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
