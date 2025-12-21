import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type DocumentKind = Database["public"]["Enums"]["document_kind"];

const DOCUMENT_KINDS: { value: DocumentKind; label: string }[] = [
  { value: "DEMANDA", label: "Demanda" },
  { value: "ACTA_REPARTO", label: "Acta de Reparto" },
  { value: "AUTO_RECEIPT", label: "Auto de Recibo" },
  { value: "COURT_RESPONSE", label: "Respuesta del Juzgado" },
  { value: "OTHER", label: "Otro" },
];

interface DocumentUploadProps {
  filingId: string;
}

export function DocumentUpload({ filingId }: DocumentUploadProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentKind, setDocumentKind] = useState<DocumentKind>("DEMANDA");
  const [uploadProgress, setUploadProgress] = useState(0);

  const uploadDocument = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("Seleccione un archivo");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      setUploadProgress(10);

      // Generate unique file path: userId/filingId/timestamp_filename
      const timestamp = Date.now();
      const sanitizedFilename = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${user.id}/${filingId}/${timestamp}_${sanitizedFilename}`;

      setUploadProgress(30);

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from("lexdocket")
        .upload(filePath, selectedFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      setUploadProgress(70);

      // Create document record
      const { error: dbError } = await supabase.from("documents").insert({
        filing_id: filingId,
        owner_id: user.id,
        file_path: filePath,
        original_filename: selectedFile.name,
        kind: documentKind,
      });

      if (dbError) {
        // Cleanup uploaded file if db insert fails
        await supabase.storage.from("lexdocket").remove([filePath]);
        throw dbError;
      }

      setUploadProgress(100);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filing", filingId] });
      toast.success("Documento cargado exitosamente");
      setSelectedFile(null);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (error) => {
      toast.error("Error al cargar: " + error.message);
      setUploadProgress(0);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast.error("Solo se permiten archivos PDF");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo no puede superar 10MB");
      return;
    }

    setSelectedFile(file);
  };

  const clearSelection = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileSelect}
        className="hidden"
      />

      {!selectedFile ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
        >
          <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">Haga clic para seleccionar un PDF</p>
          <p className="text-sm text-muted-foreground mt-1">
            Máximo 10MB • Solo archivos PDF
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{selectedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearSelection}
              disabled={uploadDocument.isPending}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex gap-3">
            <Select
              value={documentKind}
              onValueChange={(v) => setDocumentKind(v as DocumentKind)}
              disabled={uploadDocument.isPending}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_KINDS.map((kind) => (
                  <SelectItem key={kind.value} value={kind.value}>
                    {kind.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={() => uploadDocument.mutate()}
              disabled={uploadDocument.isPending}
              className="flex-1"
            >
              {uploadDocument.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cargando...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Cargar Documento
                </>
              )}
            </Button>
          </div>

          {uploadDocument.isPending && (
            <Progress value={uploadProgress} className="h-2" />
          )}
        </div>
      )}
    </div>
  );
}
