import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { parseIcarusExcel, type ParseResult, type IcarusExcelRow } from "@/lib/icarus-excel-parser";
import { IcarusExcelPreview } from "./IcarusExcelPreview";

interface ImportResult {
  run_id: string;
  status: string;
  rows_total: number;
  rows_valid: number;
  rows_imported: number;
  rows_updated: number;
  rows_skipped: number;
  errors: { row_index: number; message: string }[];
}

export function IcarusExcelImport() {
  const queryClient = useQueryClient();
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
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Error al parsear el archivo");
    }
  };

  const importMutation = useMutation({
    mutationFn: async (rows: IcarusExcelRow[]) => {
      const { data, error } = await supabase.functions.invoke("icarus-import-excel", {
        body: {
          file_name: file?.name || "unknown.xlsx",
          file_hash: parseResult?.file_hash || "",
          rows: rows.map(row => ({
            radicado_raw: row.radicado_raw,
            radicado_norm: row.radicado_norm,
            despacho: row.despacho,
            distrito: row.distrito,
            juez_ponente: row.juez_ponente,
            demandantes: row.demandantes,
            demandados: row.demandados,
            last_action_date_raw: row.last_action_date_raw,
            last_action_date_iso: row.last_action_date_iso,
          })),
        },
      });

      if (error) throw new Error(error.message);
      if (data && !data.ok) throw new Error(data.message || "Error en importación");
      return data as ImportResult;
    },
    onSuccess: (data) => {
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      queryClient.invalidateQueries({ queryKey: ["icarus-import-runs"] });
      toast.success(
        `Importación completada: ${data.rows_imported} nuevos, ${data.rows_updated} actualizados`
      );
    },
    onError: (error) => {
      toast.error("Error en importación: " + error.message);
    },
  });

  const handleImport = () => {
    if (!parseResult) return;

    const rowsToImport = parseResult.rows.filter((_, index) => selectedRows.has(index));
    if (rowsToImport.length === 0) {
      toast.error("Selecciona al menos un proceso para importar");
      return;
    }

    importMutation.mutate(rowsToImport);
  };

  const resetImport = () => {
    setFile(null);
    setParseResult(null);
    setSelectedRows(new Set());
    setImportResult(null);
    setParseError(null);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Importar procesos desde Excel (ICARUS)
        </CardTitle>
        <CardDescription>
          Sube el archivo Excel exportado desde ICARUS para importar tus procesos
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Import Complete State */}
        {importResult && (
          <div className="space-y-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Importación completada</AlertTitle>
              <AlertDescription>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2">
                  <div>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    <strong>{importResult.rows_total}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Válidos:</span>{" "}
                    <strong>{importResult.rows_valid}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Nuevos:</span>{" "}
                    <strong className="text-green-600">{importResult.rows_imported}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Actualizados:</span>{" "}
                    <strong className="text-blue-600">{importResult.rows_updated}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Omitidos:</span>{" "}
                    <strong className="text-yellow-600">{importResult.rows_skipped}</strong>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            <div className="flex gap-2 flex-wrap">
              <Link to="/process-status">
                <Button>
                  Ver Procesos Importados
                  <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
              </Link>
              <Button variant="outline" onClick={resetImport}>
                Importar otro archivo
              </Button>
            </div>
          </div>
        )}

        {/* Upload Zone */}
        {!importResult && !parseResult && (
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
            <label htmlFor="excel-file-input">
              <Button variant="secondary" asChild>
                <span>Seleccionar archivo</span>
              </Button>
            </label>
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
        {file && !importResult && (
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

        {/* Preview Table */}
        {parseResult && !importResult && (
          <>
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
                  onClick={handleImport}
                  disabled={selectedRows.size === 0 || importMutation.isPending}
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importando...
                    </>
                  ) : (
                    <>
                      Importar a Lex Docket
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {importMutation.isPending && (
              <div className="space-y-2">
                <Progress value={50} className="animate-pulse" />
                <p className="text-sm text-muted-foreground text-center">
                  Procesando {selectedRows.size} procesos...
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
