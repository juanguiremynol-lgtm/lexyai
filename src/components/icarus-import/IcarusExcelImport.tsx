import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  ExternalLink,
  Scale,
  Landmark,
  Gavel,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { parseIcarusExcel, type ParseResult } from "@/lib/icarus-excel-parser";
import { IcarusExcelPreview } from "./IcarusExcelPreview";
import { IcarusImportReview, type ReviewedRow } from "./IcarusImportReview";
import { getDefaultStage, type WorkflowType } from "@/lib/workflow-constants";

// Result for a single row
interface RowImportResult {
  rowIndex: number;
  radicado: string;
  status: 'CREATED' | 'UPDATED' | 'SKIPPED' | 'ERROR';
  reason: string | null;
  workItemId: string | null;
}

interface ImportResult {
  run_id: string;
  status: 'SUCCESS' | 'PARTIAL' | 'ERROR';
  rows_total: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  rows_failed: number;
  by_type: Record<string, { created: number; updated: number }>;
  row_results: RowImportResult[];
}

type ImportStep = 'upload' | 'preview' | 'review' | 'complete';

export function IcarusExcelImport() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<ImportStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, []);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setParseResult(null);
    setImportResult(null);
    setParseError(null);
    setSelectedRows(new Set());
    setStep('upload');

    // Validate file type
    const validExtensions = [".xls", ".xlsx"];
    const extension = selectedFile.name.substring(selectedFile.name.lastIndexOf(".")).toLowerCase();
    if (!validExtensions.includes(extension)) {
      setParseError("Formato no válido. Solo se aceptan archivos .xls o .xlsx");
      return;
    }

    // Validate file size (20MB max)
    const maxSize = 20 * 1024 * 1024;
    if (selectedFile.size > maxSize) {
      setParseError("El archivo excede el límite de 20MB");
      return;
    }

    try {
      const result = await parseIcarusExcel(selectedFile);
      setParseResult(result);
      // Select all valid rows by default
      const validIndices = new Set(
        result.rows
          .map((row, index) => (row.is_valid ? index : -1))
          .filter(i => i >= 0)
      );
      setSelectedRows(validIndices);
      setStep('preview');
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Error al parsear el archivo");
    }
  };

  // Import mutation that creates work_items with per-row classification AND client
  const importMutation = useMutation({
    mutationFn: async (reviewedRows: ReviewedRow[]): Promise<ImportResult> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Create import run record first
      const { data: importRun, error: runError } = await supabase
        .from("icarus_import_runs")
        .insert({
          owner_id: user.id,
          file_name: file?.name || 'unknown',
          file_hash: parseResult?.file_hash || null,
          status: 'PROCESSING',
          rows_total: reviewedRows.length,
          rows_valid: reviewedRows.length,
        })
        .select()
        .single();

      if (runError) {
        console.error("Failed to create import run:", runError);
        throw new Error("Error al crear registro de importación: " + runError.message);
      }

      const runId = importRun.id;
      const rowResults: RowImportResult[] = [];
      const byType: Record<string, { created: number; updated: number }> = {};

      let created = 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;

      // Process each row
      for (const row of reviewedRows) {
        const workflowType = row.selectedType as WorkflowType;
        
        if (!workflowType) {
          rowResults.push({
            rowIndex: row.rowIndex,
            radicado: row.radicado_norm,
            status: 'SKIPPED',
            reason: 'Tipo de proceso no seleccionado',
            workItemId: null,
          });
          skipped++;
          continue;
        }

        // Initialize type stats
        if (!byType[workflowType]) {
          byType[workflowType] = { created: 0, updated: 0 };
        }
        
        try {
          // Check if work_item with this radicado already exists for this user
          const { data: existing, error: checkError } = await supabase
            .from("work_items")
            .select("id")
            .eq("owner_id", user.id)
            .eq("radicado", row.radicado_norm)
            .maybeSingle();

          if (checkError) {
            console.error(`Check error for radicado ${row.radicado_norm}:`, checkError);
            rowResults.push({
              rowIndex: row.rowIndex,
              radicado: row.radicado_norm,
              status: 'ERROR',
              reason: 'Error al verificar duplicados: ' + checkError.message,
              workItemId: null,
            });
            failed++;
            continue;
          }

          // Get default stage for this workflow type
          const defaultStage = getDefaultStage(workflowType, workflowType === 'CGP' ? 'PROCESS' : undefined);

          if (existing) {
            // Update existing work_item
            const { error: updateError } = await supabase
              .from("work_items")
              .update({
                workflow_type: workflowType,
                authority_name: row.despacho || null,
                authority_department: row.distrito || null,
                demandantes: row.demandantes || null,
                demandados: row.demandados || null,
                last_action_date: row.last_action_date_iso || null,
                // Update client only if one is provided and not already set
                ...(row.selectedClientId ? { client_id: row.selectedClientId } : {}),
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);

            if (updateError) {
              console.error(`Update error for ${row.radicado_norm}:`, updateError);
              rowResults.push({
                rowIndex: row.rowIndex,
                radicado: row.radicado_norm,
                status: 'ERROR',
                reason: updateError.message,
                workItemId: existing.id,
              });
              failed++;
            } else {
              rowResults.push({
                rowIndex: row.rowIndex,
                radicado: row.radicado_norm,
                status: 'UPDATED',
                reason: null,
                workItemId: existing.id,
              });
              updated++;
              byType[workflowType].updated++;
            }
          } else {
            // Insert new work_item
            const insertData = {
              owner_id: user.id,
              workflow_type: workflowType,
              stage: defaultStage,
              cgp_phase: workflowType === 'CGP' ? 'PROCESS' as const : null,
              cgp_phase_source: workflowType === 'CGP' ? 'MANUAL' as const : null,
              status: 'ACTIVE' as const,
              source: 'ICARUS_IMPORT' as const,
              source_reference: runId,
              radicado: row.radicado_norm,
              authority_name: row.despacho || null,
              authority_department: row.distrito || null,
              demandantes: row.demandantes || null,
              demandados: row.demandados || null,
              last_action_date: row.last_action_date_iso || null,
              client_id: row.selectedClientId || null,
              is_flagged: false,
              monitoring_enabled: true,
              email_linking_enabled: true,
              radicado_verified: false,
            };

            const { data: inserted, error: insertError } = await supabase
              .from("work_items")
              .insert(insertData)
              .select("id")
              .single();

            if (insertError) {
              console.error(`Insert error for ${row.radicado_norm}:`, insertError);
              rowResults.push({
                rowIndex: row.rowIndex,
                radicado: row.radicado_norm,
                status: 'ERROR',
                reason: insertError.message,
                workItemId: null,
              });
              failed++;
            } else {
              rowResults.push({
                rowIndex: row.rowIndex,
                radicado: row.radicado_norm,
                status: 'CREATED',
                reason: null,
                workItemId: inserted?.id || null,
              });
              created++;
              byType[workflowType].created++;
            }
          }

          // Log row import result (fire and forget)
          supabase.from("icarus_import_rows").insert({
            run_id: runId,
            owner_id: user.id,
            row_index: row.rowIndex,
            radicado_raw: row.radicado_raw,
            radicado_norm: row.radicado_norm,
            suggested_workflow_type: row.suggestedType,
            selected_workflow_type: workflowType,
            was_overridden: row.wasTypeOverridden,
            status: rowResults[rowResults.length - 1].status,
            reason: rowResults[rowResults.length - 1].reason,
          }).then(({ error }) => { if (error) console.error("Failed to log row:", error); });

        } catch (error) {
          console.error(`Unexpected error for ${row.radicado_norm}:`, error);
          rowResults.push({
            rowIndex: row.rowIndex,
            radicado: row.radicado_norm,
            status: 'ERROR',
            reason: error instanceof Error ? error.message : "Error desconocido",
            workItemId: null,
          });
          failed++;
        }
      }

      // Determine final status
      let finalStatus: 'SUCCESS' | 'PARTIAL' | 'ERROR' = 'SUCCESS';
      if (failed === reviewedRows.length) {
        finalStatus = 'ERROR';
      } else if (failed > 0 || skipped > 0) {
        finalStatus = 'PARTIAL';
      }

      // Update import run with final stats
      await supabase
        .from("icarus_import_runs")
        .update({
          status: finalStatus,
          rows_imported: created,
          rows_updated: updated,
          rows_skipped: skipped + failed,
        })
        .eq("id", runId);

      return {
        run_id: runId,
        status: finalStatus,
        rows_total: reviewedRows.length,
        rows_created: created,
        rows_updated: updated,
        rows_skipped: skipped,
        rows_failed: failed,
        by_type: byType,
        row_results: rowResults,
      };
    },
    onSuccess: (data) => {
      setImportResult(data);
      setStep('complete');
      
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items-list"] });
      queryClient.invalidateQueries({ queryKey: ["cgp-items"] });
      queryClient.invalidateQueries({ queryKey: ["cpaca-processes"] });
      queryClient.invalidateQueries({ queryKey: ["tutelas"] });
      queryClient.invalidateQueries({ queryKey: ["icarus-import-runs"] });
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      
      if (data.rows_created > 0 || data.rows_updated > 0) {
        toast.success(
          `Importación completada: ${data.rows_created} nuevos, ${data.rows_updated} actualizados`
        );
      } else if (data.rows_failed > 0) {
        toast.error(`Importación fallida: ${data.rows_failed} errores`);
      }
    },
    onError: (error) => {
      toast.error("Error en importación: " + error.message);
    },
  });

  // Handle rows reviewed and proceed to import
  const handleRowsReviewed = (reviewedRows: ReviewedRow[]) => {
    importMutation.mutate(reviewedRows);
  };

  const handleProceedToReview = () => {
    if (selectedRows.size === 0) {
      toast.error("Selecciona al menos un proceso para importar");
      return;
    }
    setStep('review');
  };

  const resetImport = () => {
    setFile(null);
    setParseResult(null);
    setSelectedRows(new Set());
    setImportResult(null);
    setParseError(null);
    setStep('upload');
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'CGP': return <Scale className="h-4 w-4" />;
      case 'CPACA': return <Landmark className="h-4 w-4" />;
      case 'TUTELA': return <Gavel className="h-4 w-4" />;
      default: return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Importar procesos desde Excel (ICARUS)
        </CardTitle>
        <CardDescription>
          Sube el archivo Excel exportado desde ICARUS para importar tus procesos.
          Podrás clasificar cada proceso como CGP, CPACA o Tutela, y vincularlo a un cliente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step: Complete */}
        {step === 'complete' && importResult && (
          <div className="space-y-4">
            <Alert variant={importResult.status === 'ERROR' ? 'destructive' : 'default'}>
              {importResult.status === 'ERROR' ? (
                <AlertCircle className="h-4 w-4" />
              ) : importResult.status === 'PARTIAL' ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <AlertTitle>
                {importResult.status === 'SUCCESS' 
                  ? 'Importación completada exitosamente'
                  : importResult.status === 'PARTIAL'
                    ? 'Importación completada con advertencias'
                    : 'Error en la importación'
                }
              </AlertTitle>
              <AlertDescription>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2">
                  <div>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    <strong>{importResult.rows_total}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Nuevos:</span>{" "}
                    <strong className="text-green-600">{importResult.rows_created}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Actualizados:</span>{" "}
                    <strong className="text-blue-600">{importResult.rows_updated}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Omitidos:</span>{" "}
                    <strong className="text-amber-600">{importResult.rows_skipped}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Errores:</span>{" "}
                    <strong className="text-destructive">{importResult.rows_failed}</strong>
                  </div>
                </div>
                
                {/* By-type breakdown */}
                {Object.keys(importResult.by_type).length > 0 && (
                  <div className="mt-4 pt-3 border-t">
                    <p className="text-sm font-medium mb-2">Por tipo de proceso:</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(importResult.by_type).map(([type, counts]) => (
                        <Badge key={type} variant="outline" className="flex items-center gap-1">
                          {getTypeIcon(type)}
                          {type}: {counts.created} nuevos, {counts.updated} actualizados
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Show errors if any */}
                {importResult.rows_failed > 0 && (
                  <div className="mt-4 pt-3 border-t">
                    <p className="text-sm font-medium text-destructive mb-2">Errores:</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {importResult.row_results
                        .filter(r => r.status === 'ERROR')
                        .slice(0, 10)
                        .map((r, i) => (
                          <div key={i} className="text-xs flex items-start gap-2">
                            <X className="h-3 w-3 text-destructive flex-shrink-0 mt-0.5" />
                            <span className="font-mono">{r.radicado}</span>
                            <span className="text-muted-foreground">{r.reason}</span>
                          </div>
                        ))
                      }
                      {importResult.row_results.filter(r => r.status === 'ERROR').length > 10 && (
                        <p className="text-xs text-muted-foreground">
                          ... y {importResult.row_results.filter(r => r.status === 'ERROR').length - 10} errores más
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </AlertDescription>
            </Alert>

            <div className="flex gap-2 flex-wrap">
              <Link to="/">
                <Button>
                  Ver en Dashboard
                  <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
              </Link>
              <Button variant="outline" onClick={resetImport}>
                Importar otro archivo
              </Button>
            </div>
          </div>
        )}

        {/* Step: Upload */}
        {step === 'upload' && !parseResult && (
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
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">
              Arrastra tu archivo Excel aquí
            </p>
            <p className="text-muted-foreground text-sm mb-4">
              o haz clic para seleccionar
            </p>
            <input
              type="file"
              accept=".xls,.xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
              className="hidden"
              id="excel-file-input"
            />
            <Button 
              variant="secondary" 
              type="button"
              onClick={() => {
                const input = document.getElementById('excel-file-input') as HTMLInputElement;
                input?.click();
              }}
            >
              Seleccionar archivo
            </Button>
            <p className="text-xs text-muted-foreground mt-4">
              Formatos: .xls, .xlsx • Máximo: 20MB
            </p>
          </div>
        )}

        {/* Parse Error */}
        {parseError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error al leer archivo</AlertTitle>
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}

        {/* File Info */}
        {file && step !== 'complete' && (
          <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
            <FileSpreadsheet className="h-8 w-8 text-green-600" />
            <div className="flex-1">
              <p className="font-medium">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {formatFileSize(file.size)}
                {file.lastModified && (
                  <> • Modificado: {new Date(file.lastModified).toLocaleDateString("es-CO")}</>
                )}
              </p>
            </div>
            {parseResult && (
              <div className="flex gap-2">
                <Badge variant="outline">{parseResult.total_rows} filas</Badge>
                <Badge variant={parseResult.valid_rows > 0 ? "default" : "destructive"}>
                  {parseResult.valid_rows} válidas
                </Badge>
              </div>
            )}
          </div>
        )}

        {/* Step: Preview */}
        {step === 'preview' && parseResult && (
          <>
            {/* Preview Table */}
            <IcarusExcelPreview
              rows={parseResult.rows}
              selectedRows={selectedRows}
              onSelectionChange={setSelectedRows}
            />

            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                {selectedRows.size} de {parseResult.rows.length} procesos seleccionados
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={resetImport}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleProceedToReview}
                  disabled={selectedRows.size === 0}
                >
                  Continuar a Clasificación
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Step: Review (Classification + Client Linking) */}
        {step === 'review' && parseResult && (
          <>
            <IcarusImportReview
              rows={parseResult.rows}
              selectedRowIndices={selectedRows}
              onRowsReviewed={handleRowsReviewed}
              onCancel={() => setStep('preview')}
              isImporting={importMutation.isPending}
            />

            {importMutation.isPending && (
              <div className="space-y-2">
                <Progress value={50} className="h-2" />
                <p className="text-sm text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 inline mr-2 animate-spin" />
                  Procesando importación...
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
