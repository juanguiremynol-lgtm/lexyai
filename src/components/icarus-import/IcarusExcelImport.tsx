import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  ExternalLink,
  Users,
  UserPlus,
  Link as LinkIcon,
  Scale,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { parseIcarusExcel, type ParseResult, type IcarusExcelRow } from "@/lib/icarus-excel-parser";
import { IcarusExcelPreview } from "./IcarusExcelPreview";
import { WorkflowClassificationDialog } from "@/components/workflow/WorkflowClassificationDialog";
import type { WorkflowClassification } from "@/types/work-item";
import { WORKFLOW_TYPES } from "@/lib/workflow-constants";

interface ImportResult {
  run_id: string;
  status: string;
  rows_total: number;
  rows_valid: number;
  rows_imported: number;
  rows_updated: number;
  rows_skipped: number;
  errors: { row_index: number; message: string }[];
  imported_process_ids?: string[];
}

export function IcarusExcelImport() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Client selection state
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [clientTab, setClientTab] = useState<"existing" | "new">("existing");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState("");
  const [newClientIdNumber, setNewClientIdNumber] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");

  // Post-import linking state
  const [postImportDialogOpen, setPostImportDialogOpen] = useState(false);

  // Workflow classification state
  const [classificationDialogOpen, setClassificationDialogOpen] = useState(false);
  const [selectedClassification, setSelectedClassification] = useState<WorkflowClassification | null>(null);

  // Fetch clients
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, id_number")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const selectedClient = clients.find(c => c.id === selectedClientId);

  // Create new client mutation
  const createClientMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const { data, error } = await supabase
        .from("clients")
        .insert({
          owner_id: user.id,
          name: newClientName.trim(),
          id_number: newClientIdNumber.trim() || null,
          email: newClientEmail.trim() || null,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setSelectedClientId(data.id);
      setClientTab("existing");
      setNewClientName("");
      setNewClientIdNumber("");
      setNewClientEmail("");
      toast.success("Cliente creado exitosamente");
    },
    onError: (error) => {
      toast.error("Error al crear cliente: " + error.message);
    },
  });

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
    setSelectedClassification(null);

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

  // Import mutation that creates work_items instead of monitored_processes
  const importMutation = useMutation({
    mutationFn: async ({ rows, classification }: { rows: IcarusExcelRow[]; classification: WorkflowClassification }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const results = {
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [] as { row_index: number; message: string }[],
        imported_ids: [] as string[],
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
          // Check if work_item with this radicado already exists
          const { data: existing } = await supabase
            .from("work_items")
            .select("id")
            .eq("owner_id", user.id)
            .eq("radicado", row.radicado_norm)
            .maybeSingle();

          if (existing) {
            // Update existing
            const { error: updateError } = await supabase
              .from("work_items")
              .update({
                authority_name: row.despacho || null,
                authority_department: row.distrito || null,
                demandantes: row.demandantes || null,
                demandados: row.demandados || null,
                last_action_date: row.last_action_date_iso || null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);

            if (updateError) {
              results.errors.push({ row_index: i, message: updateError.message });
              results.skipped++;
            } else {
              results.updated++;
            }
          } else {
            // Insert new
            const { data: inserted, error: insertError } = await supabase
              .from("work_items")
              .insert({
                owner_id: user.id,
                workflow_type: classification.workflow_type,
                stage: classification.stage,
                cgp_phase: classification.cgp_phase || null,
                cgp_phase_source: classification.cgp_phase ? 'MANUAL' : null,
                status: 'ACTIVE',
                source: 'ICARUS_IMPORT',
                radicado: row.radicado_norm,
                authority_name: row.despacho || null,
                authority_department: row.distrito || null,
                demandantes: row.demandantes || null,
                demandados: row.demandados || null,
                last_action_date: row.last_action_date_iso || null,
                client_id: selectedClientId || null,
                is_flagged: false,
                monitoring_enabled: true,
                email_linking_enabled: true,
                radicado_verified: false,
              })
              .insert(workItemData)
              .select("id")
              .single();

            if (insertError) {
              results.errors.push({ row_index: i, message: insertError.message });
              results.skipped++;
            } else {
              results.imported++;
              if (inserted?.id) {
                results.imported_ids.push(inserted.id);
              }
            }
          }
        } catch (error) {
          results.errors.push({ 
            row_index: i, 
            message: error instanceof Error ? error.message : "Error desconocido" 
          });
          results.skipped++;
        }
      }

      return {
        run_id: crypto.randomUUID(),
        status: results.skipped === rows.length ? "ERROR" : results.skipped > 0 ? "PARTIAL" : "SUCCESS",
        rows_total: rows.length,
        rows_valid: rows.length,
        rows_imported: results.imported,
        rows_updated: results.updated,
        rows_skipped: results.skipped,
        errors: results.errors,
        imported_process_ids: results.imported_ids,
      } as ImportResult;
    },
    onSuccess: (data) => {
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["icarus-import-runs"] });
      
      // If no client was selected and processes were imported, prompt for linking
      if (!selectedClientId && data.rows_imported > 0) {
        setPostImportDialogOpen(true);
      }
      
      toast.success(
        `Importación completada: ${data.rows_imported} nuevos, ${data.rows_updated} actualizados`
      );
    },
    onError: (error) => {
      toast.error("Error en importación: " + error.message);
    },
  });

  // Handle classification and then import
  const handleClassificationComplete = (classification: WorkflowClassification) => {
    setSelectedClassification(classification);
    setClassificationDialogOpen(false);
    // Now proceed with import
    if (!parseResult) return;
    const rowsToImport = parseResult.rows.filter((_, index) => selectedRows.has(index));
    importMutation.mutate({ rows: rowsToImport, classification });
  };

  const handleImport = () => {
    if (!parseResult) return;

    const rowsToImport = parseResult.rows.filter((_, index) => selectedRows.has(index));
    if (rowsToImport.length === 0) {
      toast.error("Selecciona al menos un proceso para importar");
      return;
    }

    // Open classification dialog first
    setClassificationDialogOpen(true);
  };

  const resetImport = () => {
    setFile(null);
    setParseResult(null);
    setSelectedRows(new Set());
    setImportResult(null);
    setParseError(null);
    setSelectedClientId(null);
    setNewClientName("");
    setNewClientIdNumber("");
    setNewClientEmail("");
    setSelectedClassification(null);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleCreateClientAndSelect = () => {
    if (!newClientName.trim()) {
      toast.error("Ingrese el nombre del cliente");
      return;
    }
    createClientMutation.mutate();
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
        {/* Workflow Classification Dialog */}
        <WorkflowClassificationDialog
          open={classificationDialogOpen}
          onOpenChange={setClassificationDialogOpen}
          onClassify={handleClassificationComplete}
          title="Clasificar Procesos Importados"
          description={`Selecciona el tipo de proceso para los ${selectedRows.size} asuntos que vas a importar. Todos se crearán con la misma clasificación.`}
        />

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
                {selectedClient && (
                  <div className="mt-3 flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    <span>Vinculados a: <strong>{selectedClient.name}</strong></span>
                  </div>
                )}
                {selectedClassification && (
                  <div className="mt-2 flex items-center gap-2">
                    <Scale className="h-4 w-4" />
                    <span>
                      Clasificados como: <strong>{WORKFLOW_TYPES[selectedClassification.workflow_type].label}</strong>
                      {selectedClassification.cgp_phase && (
                        <Badge variant="secondary" className="ml-2">
                          {selectedClassification.cgp_phase === 'FILING' ? 'Radicación' : 'Proceso'}
                        </Badge>
                      )}
                    </span>
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

        {/* Client Selection Section - Show before import */}
        {parseResult && !importResult && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <LinkIcon className="h-4 w-4" />
                Vincular a Cliente (Opcional)
              </CardTitle>
              <CardDescription>
                Asocie todos los procesos importados a un cliente para mejor organización
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                {selectedClient ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {selectedClient.name}
                      {selectedClient.id_number && ` (${selectedClient.id_number})`}
                    </Badge>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setClientDialogOpen(true)}
                    >
                      Cambiar
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setSelectedClientId(null)}
                    >
                      Quitar
                    </Button>
                  </div>
                ) : (
                  <Button 
                    variant="outline" 
                    onClick={() => setClientDialogOpen(true)}
                    className="flex-1"
                  >
                    <Users className="h-4 w-4 mr-2" />
                    Seleccionar Cliente
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
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
                {selectedClient && (
                  <span className="ml-2">
                    → <strong>{selectedClient.name}</strong>
                  </span>
                )}
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
                      Clasificar e Importar
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {importMutation.isPending && (
              <div className="space-y-2">
                <Progress value={50} className="h-2" />
                <p className="text-sm text-center text-muted-foreground">
                  Procesando importación...
                </p>
              </div>
            )}
          </>
        )}

        {/* Client Selection Dialog */}
        <Dialog open={clientDialogOpen} onOpenChange={setClientDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Seleccionar Cliente
              </DialogTitle>
              <DialogDescription>
                Vincule los procesos importados a un cliente existente o cree uno nuevo
              </DialogDescription>
            </DialogHeader>
            
            <Tabs value={clientTab} onValueChange={(v) => setClientTab(v as "existing" | "new")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="existing">Cliente Existente</TabsTrigger>
                <TabsTrigger value="new">Nuevo Cliente</TabsTrigger>
              </TabsList>
              
              <TabsContent value="existing" className="space-y-4 mt-4">
                {clients.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hay clientes registrados. Cree uno nuevo.
                  </p>
                ) : (
                  <Select value={selectedClientId || ""} onValueChange={setSelectedClientId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione un cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name} {client.id_number && `(${client.id_number})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </TabsContent>
              
              <TabsContent value="new" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Nombre del Cliente *</Label>
                  <Input
                    placeholder="Nombre completo o razón social"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cédula / NIT (opcional)</Label>
                  <Input
                    placeholder="Número de identificación"
                    value={newClientIdNumber}
                    onChange={(e) => setNewClientIdNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Correo electrónico (opcional)</Label>
                  <Input
                    type="email"
                    placeholder="correo@ejemplo.com"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                  />
                </div>
                <Button 
                  onClick={handleCreateClientAndSelect} 
                  disabled={!newClientName.trim() || createClientMutation.isPending}
                  className="w-full"
                >
                  {createClientMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4 mr-2" />
                  )}
                  Crear Cliente
                </Button>
              </TabsContent>
            </Tabs>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setClientDialogOpen(false)}>
                Cancelar
              </Button>
              <Button 
                onClick={() => setClientDialogOpen(false)}
                disabled={clientTab === "existing" && !selectedClientId}
              >
                Confirmar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Post-import linking prompt */}
        <Dialog open={postImportDialogOpen} onOpenChange={setPostImportDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Procesos importados sin cliente</DialogTitle>
              <DialogDescription>
                Los procesos fueron importados exitosamente pero no están vinculados a ningún cliente. 
                ¿Desea vincularlos ahora?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPostImportDialogOpen(false)}>
                Más tarde
              </Button>
              <Link to="/clients">
                <Button>
                  Ir a Clientes
                </Button>
              </Link>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
